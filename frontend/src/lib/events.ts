// Eventos do backend. Espelho de internal/events: mesmos nomes, mesmos payloads.
import { bridgeWsUrl, inWails, type DebugInfo, type RunInfo, type ToolsStatus } from './api'
import { translateBackend } from '../i18n/backend'

export interface EventMap {
  'git:status': { projectId: string }
  'lsp:state': { projectId: string; state: 'starting' | 'ready' | 'stopped' | 'crashed'; message: string }
  'run:state': RunInfo
  'fs:changed': { projectId: string; paths: string[] }
  notify: { level: 'info' | 'warning' | 'error'; title: string; body: string }
  'tools:status': ToolsStatus
  'app:before-close': Record<string, never>
  'debug:state': DebugInfo
  'debug:breakpoints': { projectId: string }
  'test:update': { runId: string; projectId: string }
  'search:update': { id: string; projectId: string; count: number; done: boolean }
  'term:state': import('./api').TermInfo
  'coverage:ready': { runId: string; projectId: string }
  'clone:progress': { id: string; phase: string; percent: number; line: string; done: boolean; ok: boolean; error?: string; path: string }
}
type Name = keyof EventMap
type Handler<N extends Name> = (data: EventMap[N]) => void

const handlers = new Map<string, Set<(d: unknown) => void>>()

// Textos do backend que chegam por evento e vão para a tela: traduzidos antes de entregar.
function translateEvent(name: string, d: unknown): unknown {
  if (!d || typeof d !== 'object') return d
  const o = d as Record<string, unknown>
  const tr = (...keys: string[]) => Object.fromEntries(keys.filter((k) => typeof o[k] === 'string').map((k) => [k, translateBackend(o[k] as string)]))
  if (name === 'clone:progress') return { ...o, ...tr('phase', 'error') }
  if (name === 'notify') return { ...o, ...tr('title', 'body') }
  if (name === 'lsp:state') return { ...o, ...tr('message') }
  return d
}
const dispatch = (name: string, d: unknown) => {
  const data = translateEvent(name, d)
  handlers.get(name)?.forEach((h) => h(data))
}
let devSocket: WebSocket | null = null

function ensureDevSocket() {
  if (inWails || devSocket) return
  const connect = (delay: number) => {
    const ws = new WebSocket(bridgeWsUrl('/events'))
    devSocket = ws
    ws.onmessage = (m) => {
      const ev = JSON.parse(m.data as string) as { name: string; data: unknown }
      dispatch(ev.name, ev.data)
    }
    ws.onopen = () => (delay = 500)
    ws.onclose = () => {
      devSocket = null
      setTimeout(() => connect(Math.min(delay * 2, 8000)), delay)
    }
  }
  connect(500)
}

/** Assina um evento. Devolve a função que cancela. */
export function on<N extends Name>(name: N, handler: Handler<N>): () => void {
  const h = handler as (d: unknown) => void
  if (!handlers.has(name)) {
    handlers.set(name, new Set())
    if (inWails) window.runtime!.EventsOn(name, (d) => dispatch(name, d))
  }
  handlers.get(name)!.add(h)
  ensureDevSocket()
  return () => handlers.get(name)?.delete(h)
}
