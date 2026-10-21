// Estado da depuração: breakpoints do projeto, sessões e onde o programa está parado.
import { create } from 'zustand'
import { api, type Breakpoint, type DebugInfo, type Frame } from '../lib/api'
import { on } from '../lib/events'
import { toast } from '../design/feedback'
import { t } from '../i18n'
import { useApp } from './app'
import { useDocs } from '../editor/docs'
import { useLayout } from '../shell/layout'

interface DebugStore {
  breakpoints: Breakpoint[]
  muted: boolean // todos silenciados (continuam salvos)
  /** Expressões fixadas: reavaliadas a cada parada e salvas com o projeto. */
  watches: string[]
  addWatch: (expr: string) => void
  removeWatch: (expr: string) => void
  /** S17: diálogo de breakpoints (focus = breakpoint escolhido ao abrir). */
  dialog: { focus: string | null } | null
  sessions: DebugInfo[]
  active: string | null // sessão mostrada na janela Depurar
  frame: Frame | null // quadro selecionado (destaque da linha de execução)

  load: (projectId: string) => Promise<void>
  toggle: (path: string, line: number) => Promise<void>
  update: (bp: Breakpoint) => Promise<void>
  remove: (id: string) => Promise<void>
  setPanic: (enabled: boolean) => Promise<void>
  setMuted: (muted: boolean) => Promise<void>
  openDialog: (focus?: string | null) => void
  closeDialog: () => void
  move: (path: string, moves: Record<string, number>) => Promise<void>
  start: (configId: string) => Promise<void>
  startFile: (path: string, testName?: string) => Promise<void>
  control: (action: 'resume' | 'pause' | 'stepOver' | 'stepInto' | 'stepOut') => Promise<void>
  /** Sessão nova de attach (local ou remoto): vira a ativa e abre a janela Depurar. */
  attached: (info: DebugInfo) => void
  /** Alt+F9: continua até a linha (arquivo do projeto); um breakpoint no caminho para antes. */
  runToCursor: (path: string | null, line: number | undefined) => Promise<void>
  stop: () => Promise<void>
  selectFrame: (f: Frame | null) => void
  current: () => DebugInfo | undefined
}

let offs: Array<() => void> = []

/** A sessão que a chamada devolveu, sem passar por cima de um estado mais novo que já chegou por evento
 * (o programa pode parar no breakpoint antes de a resposta do Start/Attach chegar). */
const withSession = (list: DebugInfo[], info: DebugInfo) => (list.some((s) => s.id === info.id) ? list : [info, ...list])

export const useDebug = create<DebugStore>((set, get) => ({
  breakpoints: [],
  muted: false,
  watches: [],
  addWatch: (expr) => {
    const e = expr.trim()
    if (e && !get().watches.includes(e)) set({ watches: [...get().watches, e] })
  },
  removeWatch: (expr) => set({ watches: get().watches.filter((w) => w !== expr) }),
  dialog: null,
  sessions: [],
  active: null,
  frame: null,

  load: async (projectId) => {
    offs.forEach((o) => o())
    set({ breakpoints: await api.Breakpoints.List(projectId), muted: await api.Breakpoints.Muted(projectId), sessions: [], active: null, frame: null, dialog: null })
    offs = [
      on('debug:breakpoints', async (e) => {
        if (e.projectId === projectId) set({ breakpoints: await api.Breakpoints.List(projectId), muted: await api.Breakpoints.Muted(projectId) })
      }),
      on('debug:state', (info) => {
        if (info.projectId !== projectId) return
        const sessions = [info, ...get().sessions.filter((s) => s.id !== info.id)]
        set({ sessions, active: get().active ?? info.id })
        if (info.state !== 'stopped') {
          if (get().active === info.id) set({ frame: null })
          return
        }
        // Parou: mostra a janela Depurar e leva o editor até a linha.
        set({ active: info.id })
        useLayout.getState().show('debug')
        if (info.file) {
          const key = info.file.startsWith('/') ? 'ext:' + info.file : info.file
          useDocs.getState().open(key, { line: info.line, col: 1, preview: false })
        }
      }),
    ]
  },

  toggle: async (path, line) => {
    const p = useApp.getState().project
    if (!p) return
    set({ breakpoints: await api.Breakpoints.Toggle(p.id, path, line) })
  },

  update: async (bp) => {
    const p = useApp.getState().project
    if (!p) return
    set({ breakpoints: await api.Breakpoints.Update(p.id, bp) })
  },

  remove: async (id) => {
    const p = useApp.getState().project
    if (!p) return
    set({ breakpoints: await api.Breakpoints.Delete(p.id, id) })
  },

  setPanic: async (enabled) => {
    const p = useApp.getState().project
    if (!p) return
    set({ breakpoints: await api.Breakpoints.SetPanic(p.id, enabled) })
  },

  setMuted: async (muted) => {
    const p = useApp.getState().project
    if (!p) return
    await api.Breakpoints.SetMuted(p.id, muted)
    set({ muted })
  },

  openDialog: (focus = null) => set({ dialog: { focus } }),
  closeDialog: () => set({ dialog: null }),

  move: async (path, moves) => {
    const p = useApp.getState().project
    if (!p || Object.keys(moves).length === 0) return
    set({ breakpoints: await api.Breakpoints.Move(p.id, path, moves) })
  },

  start: async (configId) => {
    const p = useApp.getState().project
    if (!p) return
    if (!p.trusted) {
      useApp.setState({ trustAsked: true })
      return
    }
    try {
      await useDocs.getState().autosave()
      const info = await api.Debug.Start(p.id, configId)
      set({ active: info.id, sessions: withSession(get().sessions, info), frame: null })
      useApp.getState().selectConfig(configId)
      useLayout.getState().show('debug')
    } catch (e) {
      toast('danger', t('Não foi possível depurar'), String((e as Error).message))
    }
  },

  startFile: async (path, testName) => {
    const p = useApp.getState().project
    if (!p) return
    const cfg = await api.RunConfigs.FromContext(p.id, path, testName ?? '')
    await useApp.getState().refreshRunConfigs()
    await get().start(cfg.id)
  },

  control: async (action) => {
    const s = get().current()
    if (!s || s.state === 'terminated') return
    try {
      await api.Debug.Control(s.id, action, 0)
    } catch (e) {
      toast('danger', t('O depurador recusou'), String((e as Error).message))
    }
  },

  runToCursor: async (path, line) => {
    const s = get().current()
    if (!s || s.state !== 'stopped') return
    if (!path || !line || path.startsWith('ext:') || !path.endsWith('.go')) return toast('info', t('Rodar até o cursor'), t('Ponha o cursor numa linha de um arquivo Go do projeto.'))
    try {
      await api.Debug.RunToCursor(s.id, path, line)
    } catch (e) {
      toast('danger', t('O depurador recusou'), String((e as Error).message))
    }
  },

  attached: (info) => {
    set({ active: info.id, sessions: withSession(get().sessions, info), frame: null })
    useLayout.getState().show('debug')
  },

  stop: async () => {
    const s = get().current()
    if (s && s.state !== 'terminated') await api.Debug.Stop(s.id).catch(() => {})
  },

  selectFrame: (f) => set({ frame: f }),

  current: () => get().sessions.find((s) => s.id === get().active),
}))

/** Há uma sessão parada (para os atalhos F7/F8/F9). */
export const isPaused = () => useDebug.getState().current()?.state === 'stopped'
export const isDebugging = () => {
  const s = useDebug.getState().current()
  return !!s && s.state !== 'terminated'
}
