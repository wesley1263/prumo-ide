// S18 cobertura no editor: cada linha com código ganha uma faixa no gutter, verde (rodou), vermelha (não rodou)
// ou amarela (parte rodou). Vem da última execução com cobertura do projeto.
import { create } from 'zustand'
import { monaco } from './monaco'
import { useDocs } from './docs'
import { api, type Coverage, type FileCoverage } from '../lib/api'
import { on } from '../lib/events'
import { useLayout } from '../shell/layout'
import { toast } from '../design/feedback'
import { mergeCoverage } from './coverageMerge'
import { t } from '../i18n'

// merge: cada execução nova soma com a anterior em vez de trocar; runs = quantas estão somadas.
export const useCoverage = create<{ data: Coverage | null; visible: boolean; merge: boolean; runs: number }>(() => ({ data: null, visible: true, merge: false, runs: 0 }))

export type LineState = 'full' | 'none' | 'partial'

/** Estado de cada linha: rodou, não rodou, ou só parte (blocos diferentes na mesma linha). */
export function lineStates(f: FileCoverage): Map<number, LineState> {
  const seen = new Map<number, { yes: boolean; no: boolean }>()
  for (const b of f.blocks) {
    for (let l = b.startLine; l <= b.endLine; l++) {
      // A linha do fim de um bloco que termina na coluna 1-2 é só o "}" seguinte: não conta.
      if (l === b.endLine && l !== b.startLine && b.endCol <= 2) continue
      const s = seen.get(l) ?? { yes: false, no: false }
      if (b.covered) s.yes = true
      else s.no = true
      seen.set(l, s)
    }
  }
  const out = new Map<number, LineState>()
  for (const [l, s] of seen) out.set(l, s.yes && s.no ? 'partial' : s.yes ? 'full' : 'none')
  return out
}

export const percent = (covered: number, total: number) => (total ? (100 * covered) / total : 0)

export async function loadCoverage(runId: string) {
  try {
    const fresh = await api.Runs.Coverage(runId)
    const { data: prev, merge, runs } = useCoverage.getState()
    if (prev?.runId === fresh.runId) return
    const data = merge && prev ? mergeCoverage(prev, fresh) : fresh
    useCoverage.setState({ data, visible: true, runs: merge && prev ? runs + 1 : 1 })
    useLayout.getState().show('coverage')
  } catch (e) {
    toast('warning', t('Sem cobertura'), String((e as Error).message))
  }
}

const decos = new Map<string, string[]>()

function keyOf(m: monaco.editor.ITextModel) {
  return Object.values(useDocs.getState().docs).find((d) => d.uri === m.uri.toString())?.key
}

function paint(m: monaco.editor.ITextModel) {
  const { data, visible } = useCoverage.getState()
  const key = keyOf(m)
  const f = visible && key ? data?.files.find((x) => x.path === key) : undefined
  const next = f
    ? [...lineStates(f).entries()]
        .filter(([l]) => l <= m.getLineCount())
        .map(([l, s]) => ({
          range: new monaco.Range(l, 1, l, 1),
          options: {
            description: 'goide-coverage',
            linesDecorationsClassName: `goide-cov goide-cov-${s}`,
            linesDecorationsTooltip: s === 'full' ? t('Coberto pelos testes') : s === 'none' ? t('Não coberto') : t('Coberto em parte'),
          },
        }))
    : []
  decos.set(m.uri.toString(), m.deltaDecorations(decos.get(m.uri.toString()) ?? [], next))
}

/** Liga a cobertura no editor; devolve o desligamento. */
export function installCoverage(projectId: string): () => void {
  useCoverage.setState({ data: null, runs: 0 })
  const repaint = () => monaco.editor.getModels().forEach((m) => m.uri.scheme === 'file' && !m.isDisposed() && paint(m))
  const offStore = useCoverage.subscribe(repaint)
  // O documento é registrado logo depois do modelo.
  const sub = monaco.editor.onDidCreateModel((m) => m.uri.scheme === 'file' && setTimeout(() => !m.isDisposed() && paint(m), 0))
  const offEvent = on('coverage:ready', (e) => e.projectId === projectId && void loadCoverage(e.runId))
  return () => {
    offStore()
    sub.dispose()
    offEvent()
    for (const m of monaco.editor.getModels()) if (decos.has(m.uri.toString())) m.deltaDecorations(decos.get(m.uri.toString())!, [])
    decos.clear()
  }
}
