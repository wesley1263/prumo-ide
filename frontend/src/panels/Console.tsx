// Console de saída (execução e depuração): recebe pelo WebSocket /run/{id}, renderiza uma vez por
// quadro, em blocos memoizados, com links arquivo:linha que abrem o editor. Entende cores ANSI e "\r".
import { memo, useCallback, useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { create } from 'zustand'
import { bridgeWsUrl } from '../lib/api'
import { useDocs } from '../editor/docs'
import { translateBackend } from '../i18n/backend'
import { collapseCR, hasAnsi, parseAnsi, type Style } from './ansi'
import { t } from '../i18n'

type Chunk = { t: 'out' | 'err' | 'sys' | 'in'; d: string }
type Block = Chunk & { id: number }

/** Limites do console: blocos de até 64 KB, histórico visível de até 2 MB (o resto vira um aviso). */
const BLOCK_MAX = 64 * 1024
const KEEP_MAX = 2 * 1024 * 1024

interface RunOutput {
  blocks: Block[]
  size: number
  dropped: number // caracteres descartados do início
}

/** Saída das execuções, acumulada a partir do WebSocket /run/{id}. */
export const useOutput = create<{ byRun: Record<string, RunOutput>; closedTabs: Set<string> }>(() => ({ byRun: {}, closedTabs: new Set() }))
const sockets = new Map<string, WebSocket>()
const pending = new Map<string, Chunk[]>()
let blockSeq = 0
let frame = 0

/** Junta o que chegou desde o último quadro e aplica de uma vez (uma renderização por quadro). */
function flush() {
  frame = 0
  if (pending.size === 0) return
  const byRun = { ...useOutput.getState().byRun }
  for (const [runId, chunks] of pending) {
    const cur = byRun[runId] ?? { blocks: [], size: 0, dropped: 0 }
    const blocks = [...cur.blocks]
    let { size, dropped } = cur
    for (const c of chunks) {
      const last = blocks[blocks.length - 1]
      if (last && last.t === c.t && last.d.length + c.d.length <= BLOCK_MAX) {
        const d = collapseCR(last.d + c.d)
        size += d.length - last.d.length
        blocks[blocks.length - 1] = { ...last, d }
      } else {
        const d = collapseCR(c.d)
        size += d.length
        blocks.push({ ...c, d, id: ++blockSeq })
      }
    }
    while (size > KEEP_MAX && blocks.length > 1) {
      const gone = blocks.shift()!
      size -= gone.d.length
      dropped += gone.d.length
    }
    byRun[runId] = { blocks, size, dropped }
  }
  pending.clear()
  useOutput.setState({ byRun })
}

export function follow(runId: string) {
  if (sockets.has(runId)) return
  const ws = new WebSocket(bridgeWsUrl(`/run/${runId}`))
  sockets.set(runId, ws)
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data as string) as Chunk | Chunk[] | { t: 'end' }
    if (!Array.isArray(msg) && msg.t === 'end') return
    const add = Array.isArray(msg) ? msg : [msg as Chunk]
    pending.set(runId, [...(pending.get(runId) ?? []), ...add])
    if (!frame) frame = requestAnimationFrame(flush)
  }
}

const fileRef = /((?:\.\/)?[\w\-./]+\.go):(\d+)(?::(\d+))?/g

type Open = (path: string, line: number, col: number) => void

/** Texto com os arquivo:linha virando links. */
function linked(text: string, onOpen: Open, key: string): ReactNode[] {
  const parts: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(fileRef)) {
    parts.push(text.slice(last, m.index))
    const [path, line, col] = [m[1].replace(/^\.\//, ''), Number(m[2]), Number(m[3] ?? 1)]
    parts.push(
      <button key={`${key}-${m.index}`} onClick={() => onOpen(path, line, col)} className="text-accent-text underline underline-offset-2 hover:text-text">
        {m[0]}
      </button>,
    )
    last = m.index! + m[0].length
  }
  parts.push(text.slice(last))
  return parts
}

const css = (s: Style): CSSProperties | undefined => {
  if (!s.fg && !s.bg && !s.bold && !s.dim && !s.italic && !s.underline && !s.inverse) return undefined
  const [fg, bg] = s.inverse ? [s.bg ?? 'var(--color-bg)', s.fg ?? 'var(--color-text)'] : [s.fg, s.bg]
  return { color: fg, backgroundColor: bg, fontWeight: s.bold ? 600 : undefined, opacity: s.dim ? 0.7 : undefined, fontStyle: s.italic ? 'italic' : undefined, textDecoration: s.underline ? 'underline' : undefined }
}

const Line = memo(function Line({ chunk, onOpen }: { chunk: Chunk; onOpen: Open }) {
  // Linhas de sistema vêm do backend em português ("Processo encerrado com código 0."): traduz para o idioma da tela.
  if (chunk.t === 'sys') chunk = { ...chunk, d: translateBackend(chunk.d) }
  const cls = chunk.t === 'err' ? 'text-danger' : chunk.t === 'sys' ? 'italic text-text-muted' : chunk.t === 'in' ? 'text-accent-text' : 'text-text'
  if (!hasAnsi(chunk.d)) return <span className={cls}>{linked(chunk.d.replace(/\r$/, ''), onOpen, 'p')}</span>
  return (
    <span className={cls}>
      {parseAnsi(chunk.d).map((seg, i) => (
        <span key={i} style={css(seg.style)}>
          {linked(seg.text, onOpen, String(i))}
        </span>
      ))}
    </span>
  )
})

/** Limpa o que já foi mostrado de uma saída. */
export function clearOutput(id: string) {
  useOutput.setState((s) => ({ byRun: { ...s.byRun, [id]: { blocks: [], size: 0, dropped: 0 } } }))
}

/** Para de acompanhar e esconde a aba de uma saída. */
export function closeOutput(id: string) {
  sockets.get(id)?.close()
  sockets.delete(id)
  useOutput.setState((s) => ({ closedTabs: new Set(s.closedTabs).add(id) }))
}

export function Console({ id, label, autoscroll, onAutoscroll }: { id: string; label: string; autoscroll: boolean; onAutoscroll: (on: boolean) => void }) {
  const open = useDocs((s) => s.open)
  const output = useOutput((s) => s.byRun[id])
  const ref = useRef<HTMLPreElement>(null)
  const openAt = useCallback((path: string, line: number, col: number) => open(path, { line, col, preview: false }), [open])
  useEffect(() => follow(id), [id])
  useEffect(() => {
    if (autoscroll && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [output, autoscroll])
  return (
    <pre
      ref={ref}
      role="log"
      aria-label={label}
      tabIndex={0}
      onScroll={(e) => {
        const el = e.currentTarget
        onAutoscroll(el.scrollHeight - el.scrollTop - el.clientHeight < 8)
      }}
      className="selectable min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-bg px-3 py-2 font-mono text-code outline-none"
    >
      {output && output.dropped > 0 && <span className="italic text-text-muted">{t('[{n} KB de saída anterior ocultos]', { n: Math.round(output.dropped / 1024) })}{'\n'}</span>}
      {(output?.blocks ?? []).map((c) => (
        <Line key={c.id} chunk={c} onOpen={openAt} />
      ))}
    </pre>
  )
}
