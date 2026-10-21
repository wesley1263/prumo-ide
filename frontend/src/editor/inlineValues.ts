// Valores das variáveis no editor durante a depuração: com o programa parado, cada linha da função do quadro
// escolhido (do começo dela até a linha atual) ganha, no fim, o valor das variáveis que aparecem nela.
import { monaco } from './monaco'
import { useDocs } from './docs'
import { useDebug } from '../state/debug'
import { api, type Variable } from '../lib/api'

const MAX = 48 // um valor maior que isso é cortado (a árvore Variáveis mostra inteiro)
const decos = new Map<string, string[]>()

const short = (v: string) => (v.length > MAX ? v.slice(0, MAX - 1) + '…' : v)
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function clearAll() {
  for (const m of monaco.editor.getModels()) {
    const ids = decos.get(m.uri.toString())
    if (ids) m.deltaDecorations(ids, [])
  }
  decos.clear()
}

/** Linhas da função que contém `line` (do "func" até `line`). */
function functionLines(m: monaco.editor.ITextModel, line: number): number[] {
  let start = line
  while (start > 1 && !/^func\b/.test(m.getLineContent(start))) start--
  const out: number[] = []
  for (let l = start; l <= line; l++) out.push(l)
  return out
}

async function paint(seq: number) {
  const { frame, sessions, active } = useDebug.getState()
  const s = sessions.find((x) => x.id === active)
  clearAll()
  if (!frame || !s || s.state !== 'stopped' || frame.external) return
  const docs = useDocs.getState()
  const model = await docs.ensureModel(monaco.Uri.file(docs.root + '/' + frame.file).toString())
  if (!model || seq !== current) return
  let vars: Variable[] = []
  try {
    const scopes = await api.Debug.Scopes(s.id, frame.id)
    for (const sc of scopes.slice(0, 2)) vars = vars.concat(await api.Debug.Variables(s.id, sc.ref))
  } catch {
    return
  }
  if (seq !== current || model.isDisposed()) return
  const named = vars.filter((v) => /^[A-Za-z_]\w*$/.test(v.name))
  const next: monaco.editor.IModelDeltaDecoration[] = []
  for (const l of functionLines(model, Math.min(frame.line, model.getLineCount()))) {
    const text = model.getLineContent(l)
    const shown = named.filter((v) => new RegExp(`\\b${escapeRe(v.name)}\\b`).test(text))
    if (!shown.length) continue
    next.push({
      range: new monaco.Range(l, model.getLineMaxColumn(l), l, model.getLineMaxColumn(l)),
      options: {
        showIfCollapsed: true,
        after: { content: '   ' + shown.map((v) => `${v.name} = ${short(v.value)}`).join(', '), inlineClassName: 'prumo-inline-value' },
      },
    })
  }
  decos.set(model.uri.toString(), model.deltaDecorations([], next))
}

let current = 0

/** Liga os valores no editor; devolve o desligamento. */
export function installInlineValues(): () => void {
  const off = useDebug.subscribe((s, prev) => {
    if (s.frame === prev.frame && s.sessions === prev.sessions && s.active === prev.active) return
    void paint(++current)
  })
  return () => {
    off()
    current++
    clearAll()
  }
}
