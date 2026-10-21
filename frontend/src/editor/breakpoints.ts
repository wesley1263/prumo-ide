// Decorações do depurador nos modelos do editor: breakpoints (no número da linha) e a linha de execução.
// As decorações ficam no modelo, então acompanham as edições; ao salvar, as linhas novas vão para o banco.
import { monaco } from './monaco'
import { useDocs } from './docs'
import { useDebug } from '../state/debug'
import type { Breakpoint } from '../lib/api'
import { t } from '../i18n'

type Model = monaco.editor.ITextModel

const bpDecor = new Map<string, { ids: string[]; byDecoration: Map<string, string> }>() // uri → decorações e bp
const execDecor = new Map<string, string[]>()

function keyOf(m: Model): string | null {
  for (const d of Object.values(useDocs.getState().docs)) if (d.uri === m.uri.toString()) return d.key
  return null
}

function applyBreakpoints(m: Model, all: Breakpoint[]) {
  const key = keyOf(m)
  if (!key || key.startsWith('ext:')) return
  const mine = all.filter((b) => b.kind === 'line' && b.filePath === key && b.line)
  const old = bpDecor.get(m.uri.toString())
  // Breakpoint já desenhado fica onde a decoração está: ela acompanhou as edições ainda não salvas,
  // e a linha do banco só é atualizada depois de gravar.
  const live = currentLines(m)
  const muted = useDebug.getState().muted
  const decos = mine.map((b) => ({
    range: new monaco.Range(live[b.id] ?? b.line!, 1, live[b.id] ?? b.line!, 1),
    options: {
      lineNumberClassName: muted || !b.enabled ? 'goide-bp goide-bp-off' : b.condition || b.logMessage ? 'goide-bp goide-bp-cond' : 'goide-bp',
      lineNumberHoverMessage: {
        value: muted
          ? t('Breakpoint (silenciado)')
          : b.logMessage
            ? `Log: \`${b.logMessage}\``
            : b.condition
              ? t('Breakpoint (condição: `{cond}`)', { cond: b.condition })
              : t('Breakpoint · botão direito: editar'),
      },
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
    },
  }))
  const ids = m.deltaDecorations(old?.ids ?? [], decos)
  const byDecoration = new Map<string, string>()
  ids.forEach((id, i) => byDecoration.set(id, mine[i].id))
  bpDecor.set(m.uri.toString(), { ids, byDecoration })
}

function applyExecLine(m: Model) {
  const dbg = useDebug.getState()
  const s = dbg.current()
  const key = keyOf(m)
  let line = 0
  if (s?.state === 'stopped' && key) {
    const f = dbg.frame
    const file = f ? f.file : s.file
    const want = file.startsWith('/') ? 'ext:' + file : file
    if (want === key) line = f ? f.line : s.line
  }
  const old = execDecor.get(m.uri.toString()) ?? []
  execDecor.set(
    m.uri.toString(),
    m.deltaDecorations(
      old,
      line
        ? [{ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'goide-exec-line', linesDecorationsClassName: 'goide-exec-arrow' } }]
        : [],
    ),
  )
}

/** Linhas atuais (depois das edições) dos breakpoints de um modelo, por id. */
function currentLines(m: Model): Record<string, number> {
  const d = bpDecor.get(m.uri.toString())
  const out: Record<string, number> = {}
  if (!d) return out
  for (const id of d.ids) {
    const r = m.getDecorationRange(id)
    const bp = d.byDecoration.get(id)
    if (r && bp) out[bp] = r.startLineNumber
  }
  return out
}

export function installDebugDecorations(): () => void {
  const fileModels = () => monaco.editor.getModels().filter((m) => m.uri.scheme === 'file')
  const all = () => {
    const bps = useDebug.getState().breakpoints
    for (const m of fileModels()) {
      applyBreakpoints(m, bps)
      applyExecLine(m)
    }
  }
  all()
  const created = monaco.editor.onDidCreateModel(() => setTimeout(all, 0)) // o doc é registrado logo depois do modelo
  const offDebug = useDebug.subscribe((s, prev) => {
    if (s.breakpoints !== prev.breakpoints || s.muted !== prev.muted || s.sessions !== prev.sessions || s.frame !== prev.frame || s.active !== prev.active) all()
  })
  const offDocs = useDocs.subscribe((s, prev) => {
    if (s.docs === prev.docs) return
    for (const [key, d] of Object.entries(s.docs)) {
      const before = prev.docs[key]
      if (!before) {
        all()
        continue
      }
      // Gravou: as linhas dos breakpoints desse arquivo podem ter andado.
      if (before.mtime !== d.mtime && !key.startsWith('ext:')) {
        const m = monaco.editor.getModel(monaco.Uri.parse(d.uri))
        if (!m) continue
        const bps = useDebug.getState().breakpoints
        const moves: Record<string, number> = {}
        for (const [id, line] of Object.entries(currentLines(m))) {
          if (bps.find((b) => b.id === id)?.line !== line) moves[id] = line
        }
        void useDebug.getState().move(key, moves)
      }
    }
  })
  return () => {
    created.dispose()
    offDebug()
    offDocs()
    bpDecor.clear()
    execDecor.clear()
  }
}
