// Marcadores de mudança no gutter (adicionado, modificado, apagado) em relação ao último commit,
// calculados no próprio editor enquanto o usuário digita. Clique no marcador: reverter o trecho.
import { monaco } from './monaco'
import { useDocs } from './docs'
import { api } from '../lib/api'
import { on } from '../lib/events'

import { lineDiff, type Hunk } from './lineDiff'

export type { Hunk }

const head = new Map<string, string[] | null>() // uri → linhas no HEAD (null = não versionado)
const hunks = new Map<string, Hunk[]>()
const decos = new Map<string, string[]>()

function keyOf(m: monaco.editor.ITextModel): string | null {
  for (const d of Object.values(useDocs.getState().docs)) if (d.uri === m.uri.toString()) return d.key
  return null
}

function render(m: monaco.editor.ITextModel) {
  const base = head.get(m.uri.toString())
  const lines = m.getLinesContent()
  const hs = base ? (lineDiff(base, lines) ?? []) : []
  hunks.set(m.uri.toString(), hs)
  const next = hs.map((h) => {
    const line = h.kind === 'deleted' ? Math.max(1, Math.min(h.start, m.getLineCount())) : h.start
    const end = h.kind === 'deleted' ? line : h.start + h.count - 1
    return {
      range: new monaco.Range(line, 1, end, 1),
      options: {
        linesDecorationsClassName: `goide-vcs goide-vcs-${h.kind}`,
        overviewRuler: { color: h.kind === 'added' ? 'var(--color-vcs-added)' : h.kind === 'modified' ? 'var(--color-vcs-modified)' : 'var(--color-vcs-deleted)', position: monaco.editor.OverviewRulerLane.Left },
      },
    }
  })
  decos.set(m.uri.toString(), m.deltaDecorations(decos.get(m.uri.toString()) ?? [], next))
}

async function loadHead(m: monaco.editor.ITextModel) {
  const pid = useDocs.getState().projectId
  const key = keyOf(m)
  if (!pid || !key || key.startsWith('ext:')) return
  try {
    const h = await api.Git.HeadContent(pid, key)
    // Mesmas linhas que o modelo: o Monaco não guarda \r, e um arquivo terminado em \n tem uma última linha vazia.
    head.set(m.uri.toString(), h.tracked ? h.content.replace(/\r\n/g, '\n').split('\n') : null)
  } catch {
    head.set(m.uri.toString(), null)
  }
  if (!m.isDisposed()) render(m)
}

/** O trecho alterado que cobre a linha (para o clique no marcador). */
export function hunkAt(m: monaco.editor.ITextModel, line: number): Hunk | null {
  for (const h of hunks.get(m.uri.toString()) ?? []) {
    const from = h.start
    const to = h.kind === 'deleted' ? h.start : h.start + h.count - 1
    if (line >= from && line <= to) return h
  }
  return null
}

/** Volta o trecho ao que estava no commit (como edição: Ctrl+Z desfaz). */
export function revertHunk(m: monaco.editor.ITextModel, h: Hunk) {
  const eol = m.getEOL()
  if (h.kind === 'deleted') {
    const at = Math.min(h.start, m.getLineCount() + 1)
    const range = at > m.getLineCount() ? new monaco.Range(m.getLineCount(), m.getLineMaxColumn(m.getLineCount()), m.getLineCount(), m.getLineMaxColumn(m.getLineCount())) : new monaco.Range(at, 1, at, 1)
    const text = at > m.getLineCount() ? eol + h.old.join(eol) : h.old.join(eol) + eol
    m.pushEditOperations([], [{ range, text }], () => null)
    return
  }
  const last = h.start + h.count - 1
  if (h.kind === 'added') {
    // Apaga as linhas novas, inclusive a quebra de linha.
    const range = last < m.getLineCount() ? new monaco.Range(h.start, 1, last + 1, 1) : new monaco.Range(Math.max(1, h.start - 1), h.start > 1 ? m.getLineMaxColumn(h.start - 1) : 1, last, m.getLineMaxColumn(last))
    m.pushEditOperations([], [{ range, text: '' }], () => null)
    return
  }
  m.pushEditOperations([], [{ range: new monaco.Range(h.start, 1, last, m.getLineMaxColumn(last)), text: h.old.join(eol) }], () => null)
}

export function installVcsGutter(): () => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const subs: Array<{ dispose(): void }> = []
  const watch = (m: monaco.editor.ITextModel) => {
    if (m.uri.scheme !== 'file') return
    setTimeout(() => loadHead(m), 0) // o documento é registrado logo depois do modelo
    subs.push(
      m.onDidChangeContent(() => {
        clearTimeout(timers.get(m.uri.toString()))
        timers.set(
          m.uri.toString(),
          setTimeout(() => !m.isDisposed() && render(m), 250),
        )
      }),
    )
  }
  monaco.editor.getModels().forEach(watch)
  subs.push(monaco.editor.onDidCreateModel(watch))
  subs.push(
    monaco.editor.onWillDisposeModel((m) => {
      head.delete(m.uri.toString())
      hunks.delete(m.uri.toString())
      decos.delete(m.uri.toString())
    }),
  )
  // Commit, troca de branch, update: o "último commit" mudou.
  let refresh: ReturnType<typeof setTimeout> | undefined
  const off = on('git:status', () => {
    clearTimeout(refresh)
    refresh = setTimeout(() => monaco.editor.getModels().filter((m) => m.uri.scheme === 'file').forEach(loadHead), 300)
  })
  return () => {
    subs.forEach((s) => s.dispose())
    timers.forEach(clearTimeout)
    clearTimeout(refresh)
    off()
    head.clear()
    hunks.clear()
    decos.clear()
  }
}
