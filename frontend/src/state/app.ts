// Estado global: bootstrap, projeto aberto, tema, git e execuções.
import { create } from 'zustand'
import { lang, resolveLang, t, storedPref, storePref, type LangPref } from '../i18n'
import { api, setBridge, type Bootstrap, type OpenProject, type RecentProject, type RepoStatus, type RunConfig, type RunInfo } from '../lib/api'
import { on } from '../lib/events'
import { toast } from '../design/feedback'
import { reconnectLsp } from '../editor/lsp/adapter'
import { useDocs } from '../editor/docs'
import { loadPrefs } from './settings'

export type Theme = 'dark' | 'light'

function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t
}

interface AppState {
  boot: Bootstrap | null
  bootError: string | null
  theme: Theme
  recent: RecentProject[]
  project: OpenProject | null
  trustAsked: boolean // o diálogo de confiança está aberto

  git: RepoStatus | null
  gitLoading: boolean
  runConfigs: RunConfig[]
  selectedConfig: string | null
  runs: RunInfo[]
  lsp: { state: string; message: string }

  init: () => Promise<void>
  setTheme: (t: Theme) => void
  refreshRecent: () => Promise<void>
  openProject: (path: string) => Promise<void>
  closeProject: () => Promise<void>
  /** Troca de projeto: grava o que estiver pendente, fecha o atual e abre o outro. */
  switchProject: (path: string) => Promise<void>
  answerTrust: (trusted: boolean) => Promise<void>
  refreshGit: () => Promise<void>
  refreshRunConfigs: () => Promise<void>
  selectConfig: (id: string | null) => void
  runConfig: (configId: string, opts?: { coverage?: boolean }) => Promise<RunInfo | null>
  runFile: (path: string, testName?: string, opts?: { coverage?: boolean }) => Promise<RunInfo | null>
  stopRun: (runId: string) => Promise<void>
}

let gitTimer: ReturnType<typeof setTimeout> | undefined

/** Janela que mostra o resultado de uma config: Testes para Go Test, Executar para o resto. */
export const windowForConfig = (configId: string): 'tests' | 'run' =>
  useApp.getState().runConfigs.find((c) => c.id === configId)?.type === 'go_test' ? 'tests' : 'run'

export const useApp = create<AppState>((set, get) => ({
  boot: null,
  bootError: null,
  theme: 'dark',
  recent: [],
  project: null,
  trustAsked: false,
  git: null,
  gitLoading: false,
  runConfigs: [],
  selectedConfig: null,
  runs: [],
  lsp: { state: 'stopped', message: '' },

  init: async () => {
    try {
      const boot = await api.App.Bootstrap()
      setBridge(boot.bridgePort, boot.bridgeToken)
      const theme = (boot.settings['appearance.theme'] as Theme) ?? 'dark'
      applyTheme(theme)
      // O idioma gravado no backend manda: se o navegador tinha outro (outra máquina, limpou os dados), recarrega uma vez.
      const savedLang = boot.settings['appearance.language'] as LangPref | undefined
      if (savedLang && savedLang !== storedPref()) {
        storePref(savedLang)
        if (resolveLang(savedLang) !== lang) return location.reload()
      }
      loadPrefs(boot.settings)
      set({ boot, theme, recent: boot.recent, bootError: null })
    } catch (e) {
      set({ bootError: String((e as Error).message ?? e) })
      return
    }
    on('git:status', ({ projectId }) => {
      if (projectId !== get().project?.id) return
      clearTimeout(gitTimer)
      gitTimer = setTimeout(() => get().refreshGit(), 250)
    })
    on('run:state', (info) => {
      if (info.projectId !== get().project?.id) return
      const runs = get().runs.filter((r) => r.id !== info.id)
      set({ runs: [info, ...runs].sort((a, b) => b.startedAt - a.startedAt) })
      if (info.state === 'exited' || info.state === 'failed') {
        get().refreshGit()
        // Comando do go (sem config): go.mod, go.sum ou arquivos gerados mudaram.
        if (!info.configId) {
          window.dispatchEvent(new CustomEvent('prumo:refresh-tree'))
          void useDocs.getState().reloadFromDisk()
        }
      }
    })
    on('lsp:state', ({ projectId, state, message }) => {
      if (projectId === get().project?.id) set({ lsp: { state, message } })
    })
    // O barramento descarta avisos de quem lê devagar: com uma execução viva, confere o estado de verdade
    // de tempos em tempos (um run:state de fim perdido deixaria a execução "rodando" para sempre).
    setInterval(() => {
      const p = get().project
      const live = get().runs.filter((r) => r.state === 'building' || r.state === 'running')
      if (!p || live.length === 0) return
      api.Runs.List(p.id).then(
        (list) => {
          const fresh = new Map(list.map((r) => [r.id, r]))
          if (!live.some((r) => fresh.get(r.id) && fresh.get(r.id)!.state !== r.state)) return
          set({ runs: get().runs.map((r) => fresh.get(r.id) ?? r) })
          get().refreshGit() // o que o run:state de fim faria
        },
        () => {},
      )
    }, 2000)
  },

  setTheme: (t) => {
    applyTheme(t)
    set({ theme: t })
    api.Settings.Set('appearance.theme', t).catch(() => {})
  },

  refreshRecent: async () => set({ recent: await api.Projects.ListRecent() }),

  openProject: async (path) => {
    const { project, needsTrust } = await api.Projects.Open(path)
    set({ project, trustAsked: needsTrust, git: null, runs: [], runConfigs: [], selectedConfig: null })
    get().refreshGit()
    get().refreshRunConfigs().catch(() => {}) // o projeto pode fechar antes da resposta
    get().refreshRecent().catch(() => {})
  },

  closeProject: async () => {
    const p = get().project
    if (!p) return
    await useDocs.getState().autosave() // fechar não descarta o que foi digitado
    await api.Projects.Close(p.id).catch(() => {})
    set({ project: null, git: null, runs: [], runConfigs: [] })
    get().refreshRecent().catch(() => {})
  },

  switchProject: async (path) => {
    await get().closeProject()
    try {
      await get().openProject(path)
    } catch (e) {
      toast('danger', t('Não foi possível abrir o projeto'), String((e as Error).message))
    }
  },

  answerTrust: async (trusted) => {
    const p = get().project
    if (!p) return
    if (trusted) {
      const updated = await api.Projects.SetTrusted(p.id, true)
      set({ project: updated, trustAsked: false })
      reconnectLsp() // o hub recusava a conexão enquanto o projeto não era confiável
    } else {
      set({ trustAsked: false })
    }
  },

  refreshGit: async () => {
    const p = get().project
    if (!p) return
    set({ gitLoading: true })
    try {
      set({ git: await api.Git.Status(p.id) })
    } catch (e) {
      toast('danger', t('Não foi possível ler o status do git'), String((e as Error).message))
    } finally {
      set({ gitLoading: false })
    }
  },

  refreshRunConfigs: async () => {
    const p = get().project
    if (!p) return
    const list = await api.RunConfigs.List(p.id)
    const sel = get().selectedConfig
    set({ runConfigs: list, selectedConfig: sel && list.some((c) => c.id === sel) ? sel : (list[0]?.id ?? null) })
  },

  selectConfig: (id) => set({ selectedConfig: id }),

  runConfig: async (configId, opts = {}) => {
    const p = get().project
    if (!p) return null
    if (!p.trusted) {
      set({ trustAsked: true })
      return null
    }
    try {
      await useDocs.getState().autosave() // roda o que está no editor, não a versão antiga do disco
      const info = opts.coverage ? await api.Runs.StartCoverage(p.id, configId) : await api.Runs.Start(p.id, configId)
      set({ runs: [info, ...get().runs.filter((r) => r.id !== info.id)], selectedConfig: configId })
      return info
    } catch (e) {
      toast('danger', t('Não foi possível rodar'), String((e as Error).message))
      return null
    }
  },

  runFile: async (path, testName, opts = {}) => {
    const p = get().project
    if (!p) return null
    const cfg = await api.RunConfigs.FromContext(p.id, path, testName ?? '')
    await get().refreshRunConfigs()
    return get().runConfig(cfg.id, opts)
  },

  stopRun: async (runId) => {
    await api.Runs.Stop(runId).catch((e) => toast('danger', t('Não foi possível parar'), String(e.message)))
  },
}))
