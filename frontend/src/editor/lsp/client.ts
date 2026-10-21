// Cliente JSON-RPC do LSP sobre o WebSocket da ponte (/lsp/{projectId}).
// O hub no backend já inicializou o gopls; aqui o initialize só devolve as capacidades.
import { bridgeWsUrl } from '../../lib/api'
import { t } from '../../i18n'

export type LspState = 'connecting' | 'ready' | 'closed' | 'error'

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; method: string }

export class LspError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message)
  }
}

export class LspClient {
  state: LspState = 'connecting'
  stateMessage = ''
  capabilities: Record<string, unknown> = {}

  private ws: WebSocket | null = null
  private seq = 0
  private pending = new Map<number, Pending>()
  private notifications = new Map<string, Set<(params: any) => void>>()
  private requests = new Map<string, (params: any) => Promise<unknown> | unknown>()
  private stateListeners = new Set<(s: LspState, msg: string) => void>()
  private readyListeners = new Set<() => void>()
  private retry = 500
  private disposed = false

  constructor(private projectId: string) {
    this.connect()
  }

  private setState(s: LspState, msg = '') {
    this.state = s
    this.stateMessage = msg
    this.stateListeners.forEach((l) => l(s, msg))
  }

  private connect() {
    if (this.disposed) return
    this.setState('connecting')
    const ws = new WebSocket(bridgeWsUrl(`/lsp/${encodeURIComponent(this.projectId)}`))
    this.ws = ws
    ws.onopen = async () => {
      this.retry = 500
      try {
        const res = (await this.send('initialize', {}, true)) as { capabilities: Record<string, unknown> }
        this.capabilities = res.capabilities ?? {}
        this.notify('initialized', {})
        this.setState('ready')
        this.readyListeners.forEach((l) => l())
      } catch (e) {
        this.setState('error', String(e))
      }
    }
    ws.onmessage = (ev) => this.receive(JSON.parse(ev.data as string))
    ws.onclose = (ev) => {
      this.ws = null
      for (const p of this.pending.values()) p.reject(new LspError(-32097, t('conexão com o gopls perdida')))
      this.pending.clear()
      if (this.disposed) return
      // 4001: o backend recusou (projeto não confiável, gopls ausente). Tenta de novo bem devagar.
      const refused = ev.code === 4001
      this.setState(refused ? 'error' : 'closed', ev.reason)
      const delay = refused ? 15000 : this.retry
      this.retry = Math.min(this.retry * 2, 10000)
      setTimeout(() => this.connect(), delay)
    }
  }

  /** Reconecta já (ex.: depois que o usuário confiou no projeto). */
  reconnect() {
    this.retry = 500
    if (this.ws) this.ws.close()
    else this.connect()
  }

  private receive(m: { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string } }) {
    if (m.method && m.id !== undefined) {
      // requisição do servidor (applyEdit, showDocument...)
      const h = this.requests.get(m.method)
      Promise.resolve(h ? h(m.params) : null)
        .then((result) => this.raw({ jsonrpc: '2.0', id: m.id, result: result ?? null }))
        .catch((e) => this.raw({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: String(e) } }))
      return
    }
    if (m.method) {
      this.notifications.get(m.method)?.forEach((h) => h(m.params))
      return
    }
    const p = this.pending.get(m.id as number)
    if (!p) return
    this.pending.delete(m.id as number)
    if (m.error) p.reject(new LspError(m.error.code, m.error.message))
    else p.resolve(m.result)
  }

  private raw(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  private send(method: string, params: unknown, force = false): Promise<unknown> {
    if (!force && this.state !== 'ready') return Promise.reject(new LspError(-32002, t('gopls ainda não está pronto')))
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      this.raw({ jsonrpc: '2.0', id, method, params })
    })
  }

  /** Faz uma requisição. Com token cancelado, manda $/cancelRequest. */
  request<T>(method: string, params: unknown, token?: { isCancellationRequested: boolean; onCancellationRequested: (cb: () => void) => unknown }): Promise<T> {
    const id = this.seq + 1
    const p = this.send(method, params) as Promise<T>
    token?.onCancellationRequested(() => {
      if (this.pending.has(id)) this.notify('$/cancelRequest', { id })
    })
    return p
  }

  notify(method: string, params: unknown) {
    if (this.state !== 'ready' && method !== 'initialized') return
    this.raw({ jsonrpc: '2.0', method, params })
  }

  onNotification(method: string, h: (params: any) => void): () => void {
    if (!this.notifications.has(method)) this.notifications.set(method, new Set())
    this.notifications.get(method)!.add(h)
    return () => this.notifications.get(method)?.delete(h)
  }

  onRequest(method: string, h: (params: any) => Promise<unknown> | unknown) {
    this.requests.set(method, h)
  }

  onState(h: (s: LspState, msg: string) => void): () => void {
    this.stateListeners.add(h)
    return () => this.stateListeners.delete(h)
  }

  /** Chamado a cada (re)conexão pronta: reabrir documentos etc. */
  onReady(h: () => void): () => void {
    this.readyListeners.add(h)
    return () => this.readyListeners.delete(h)
  }

  dispose() {
    this.disposed = true
    this.ws?.close()
  }
}
