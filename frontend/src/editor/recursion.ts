// Chamadas recursivas: um ↻ na margem da linha que chama a própria função (como no GoLand).
// O candidato vem do texto (o nome da função dentro do corpo dela) e é confirmado pelo "ir para a definição"
// do gopls, que descarta nomes sombreados, closures com o mesmo nome e métodos de outro tipo.
import { monaco } from './monaco'
import { definitionAt, documentSymbols, useLsp, type DocSymbol } from './lsp/adapter'
import { t } from '../i18n'

const decor = new Map<string, string[]>()

async function scan(m: monaco.editor.ITextModel) {
  const uri = m.uri.toString()
  const version = m.getVersionId()
  const funcs: DocSymbol[] = []
  const walk = (l: DocSymbol[]) => l.forEach((s) => (s.kind === 12 || s.kind === 6 ? funcs.push(s) : walk(s.children ?? [])))
  walk(await documentSymbols(uri))
  // O modelo pode ser descartado no meio (editor de merge, diff fechado): para sem mexer nele.
  const gone = () => m.isDisposed() || m.getVersionId() !== version
  if (gone()) return
  const lines = new Set<number>()
  for (const f of funcs) {
    const name = f.name.replace(/^\(\*?\w+(\[[^\]]*\])?\)\./, '')
    const method = name !== f.name
    const body = new monaco.Range(f.selectionRange.end.line + 1, f.selectionRange.end.character + 1, f.range.end.line + 1, f.range.end.character + 1)
    const re = method ? `\\.${name}\\(` : `(?<![.\\w])${name}\\(`
    if (gone()) return
    for (const hit of m.findMatches(re, body, true, true, null, false)) {
      const at = hit.range.startColumn - 1 + (method ? 1 : 0)
      const defs = await definitionAt(uri, hit.range.startLineNumber - 1, at)
      if (gone()) return
      const d = f.selectionRange.start
      if (defs.some((x) => x.uri === uri && x.range.start.line === d.line && x.range.start.character === d.character)) lines.add(hit.range.startLineNumber)
    }
  }
  if (gone()) return // mudou no meio: a próxima varredura vale
  decor.set(
    uri,
    m.deltaDecorations(
      decor.get(uri) ?? [],
      [...lines].map((l) => ({
        range: new monaco.Range(l, 1, l, 1),
        options: { glyphMarginClassName: 'goide-recursion', glyphMargin: { position: monaco.editor.GlyphMarginLane.Center }, glyphMarginHoverMessage: { value: t('Chamada recursiva') } },
      })),
    ),
  )
}

export function installRecursion(): () => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const subs: monaco.IDisposable[] = []
  const later = (m: monaco.editor.ITextModel, ms = 800) => {
    clearTimeout(timers.get(m.uri.toString()))
    timers.set(
      m.uri.toString(),
      setTimeout(() => !m.isDisposed() && void scan(m).catch(() => {}), ms),
    )
  }
  const watch = (m: monaco.editor.ITextModel) => {
    if (m.getLanguageId() !== 'go' || m.uri.scheme !== 'file') return
    subs.push(m.onDidChangeContent(() => later(m)))
    later(m, 300)
  }
  monaco.editor.getModels().forEach(watch)
  subs.push(monaco.editor.onDidCreateModel(watch))
  const off = useLsp.subscribe((s, prev) => s.state === 'ready' && prev.state !== 'ready' && monaco.editor.getModels().forEach((m) => m.getLanguageId() === 'go' && later(m, 300)))
  return () => {
    subs.forEach((d) => d.dispose())
    timers.forEach((t) => clearTimeout(t))
    off()
    decor.clear()
  }
}
