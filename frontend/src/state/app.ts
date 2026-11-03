// Estado global: bootstrap, projeto aberto, tema, git e execuções.
import { create } from 'zustand'
import { lang, resolveLang, t, storedPref, storePref, type LangPref } from '../i18n'
import { api, setBridge, type Bootstrap, type OpenProject, type RecentProject, type RepoStatus, type RunConfig, type RunInfo } from '../lib/api'
import { on } from '../lib/events'
import { toast } from '../design/feedback'
import { reconnectLsp } from '../editor/lsp/adapter'
import { useDocs } from '../editor/docs'
import { loadPrefs, usePrefs } from './settings'

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
  /** Abrir outro projeto (path) ou a tela inicial (null) com um projeto aberto: nesta janela ou em outra,
   * conforme a preferência (perguntar, por padrão). Se outra janela já tem o projeto, ela vem para a frente. */
  requestOpen: (path: string | null) => Promise<void>
  /** O diálogo "Abrir em: esta janela / nova janela" (o que vai abrir: um projeto ou a tela inicial). */
  openWhere: { path: string | null } | null
  answerOpenWhere: (where: 'same' | 'new' | null, path?: string | null) => Promise<void>
  openInNewWindow: (path: string | null) => Promise<void>
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
  openWhere: null,

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
    // Janela aberta por outra para um projeto: no app vem do --project; no modo dev, de ?project= na URL.
    const initial = get().boot?.initialProject || new URLSearchParams(location.search).get('project')
    if (initial && !get().project) {
      history.replaceState(null, '', location.pathname + location.hash) // recarregar não abre de novo
      // Aberto por linha de comando com o projeto já aberto em outra janela: ela vem para a frente e esta fecha.
      if (get().boot?.multiWindow && (await api.App.FocusProjectWindow(initial).catch(() => false))) return void api.App.Quit()
      get()
        .openProject(initial)
        .catch((e) => toast('danger', t('Não foi possível abrir o projeto'), String((e as Error).message)))
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
    // Já aberto em outra janela: ela vem para a frente (o mesmo projeto não abre duas vezes).
    if (await api.App.FocusProjectWindow(path).catch(() => false)) {
      toast('info', t('O projeto já está aberto em outra janela'), t('Ela foi trazida para a frente.'))
      return
    }
    const { project, needsTrust } = await api.Projects.Open(path)
    set({ project, trustAsked: needsTrust, git: null, runs: [], runConfigs: [], selectedConfig: null })
    get().refreshGit()
    get().refreshRunConfigs()
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

  requestOpen: async (path) => {
    const cur = get().project
    if (path && cur && path === cur.rootPath) return
    if (!cur) {
      if (path) await get().openProject(path).catch((e) => toast('danger', t('Não foi possível abrir o projeto'), String((e as Error).message)))
      return
    }
    if (path && (await api.App.FocusProjectWindow(path).catch(() => false))) {
      toast('info', t('O projeto já está aberto em outra janela'), t('Ela foi trazida para a frente.'))
      return
    }
    const pref = usePrefs.getState()['project.openIn']
    if (pref === 'ask') return set({ openWhere: { path } })
    await get().answerOpenWhere(pref, path)
  },

  answerOpenWhere: async (where, path = get().openWhere?.path ?? null) => {
    set({ openWhere: null })
    if (where === 'new') return get().openInNewWindow(path)
    if (where === 'same') {
      if (path) await get().switchProject(path)
      else await get().closeProject() // a tela inicial: abrir, clonar ou criar outro
    }
  },

  openInNewWindow: async (path) => {
    // No modo dev a UI é uma aba do navegador: a "janela nova" é outra aba (mesmo backend).
    if (!get().boot?.multiWindow) {
      window.open(location.pathname + (path ? '?project=' + encodeURIComponent(path) : ''), '_blank')
      return
    }
    await useDocs.getState().autosave() // nada fica só nesta janela sem salvar
    try {
      await api.App.OpenWindow(path ?? '')
    } catch (e) {
      toast('danger', t('Não foi possível abrir outra janela'), String((e as Error).message))
    }
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

// Título da janela com o nome do projeto: com várias janelas abertas, a barra de tarefas mostra qual é qual.
let lastTitle = ''
useApp.subscribe((st) => {
  const title = st.project ? `${st.project.name} – Prumo` : 'Prumo'
  if (title === lastTitle) return
  lastTitle = title
  document.title = title
  if (st.boot) api.App.SetTitle(title).catch(() => {})
})
