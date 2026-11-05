// Estado da janela Merge requests (GitLab): o contexto do projeto no servidor, a lista com filtros e o
// merge request aberto (detalhe, arquivos e comentários).
import { create } from 'zustand'
import { api, type CommitFile, type GitLabContext, type MergeRequest, type MergeRequestDetail, type MrFilter } from '../lib/api'
import { useApp } from '../state/app'

interface MrFiles {
  base: string
  head: string
  files: CommitFile[]
}

interface MrState {
  ctx: GitLabContext | null
  ctxLoading: boolean
  filter: MrFilter
  list: MergeRequest[] | null
  listError: string | null
  listLoading: boolean
  open: number | null
  detail: MergeRequestDetail | null
  detailError: string | null
  files: MrFiles | null
  filesError: string | null
  filesLoading: boolean
  /** Diálogo de criar merge request. */
  creating: boolean
  loadContext: () => Promise<void>
  setFilter: (f: Partial<MrFilter>) => void
  refresh: () => Promise<void>
  openMr: (iid: number) => Promise<void>
  reloadDetail: () => Promise<void>
  loadFiles: () => Promise<void>
  back: () => void
}

const pid = () => useApp.getState().project?.id

/** Revisão das abas de diff de um merge request: "mr:<iid>:<base>:<head>". */
export const mrRev = (iid: number, base: string, head: string) => `mr:${iid}:${base}:${head}`
export const parseMrRev = (rev: string) => {
  const [, iid, base, head] = rev.split(':')
  return { iid: Number(iid), base, head }
}

const msg = (e: unknown) => String((e as Error)?.message ?? e)

export const useMergeRequests = create<MrState>((set, get) => ({
  ctx: null,
  ctxLoading: false,
  filter: { state: 'opened', scope: 'all', search: '' },
  list: null,
  listError: null,
  listLoading: false,
  open: null,
  detail: null,
  detailError: null,
  files: null,
  filesError: null,
  filesLoading: false,
  creating: false,

  loadContext: async () => {
    const id = pid()
    if (!id) return
    set({ ctxLoading: true })
    try {
      const ctx = await api.GitLab.Context(id)
      set({ ctx })
      if (ctx.project) await get().refresh()
    } catch (e) {
      // Contexto com o erro (e não null): a janela mostra o problema em vez de tentar de novo sem parar.
      set({ ctx: { remote: '', remoteUrl: '', host: '', path: '', isGitLab: false, server: '', authSource: '', user: null, project: null, currentBranch: '', template: '', error: msg(e) } })
    } finally {
      set({ ctxLoading: false })
    }
  },

  setFilter: (f) => {
    set({ filter: { ...get().filter, ...f } })
    void get().refresh()
  },

  refresh: async () => {
    const id = pid()
    if (!id) return
    const filter = get().filter
    set({ listLoading: true, listError: null })
    try {
      const list = await api.GitLab.List(id, filter)
      if (get().filter === filter) set({ list }) // resposta de um filtro antigo não sobrescreve a do atual
    } catch (e) {
      set({ listError: msg(e) })
    } finally {
      set({ listLoading: false })
    }
  },

  openMr: async (iid) => {
    set({ open: iid, detail: null, detailError: null, files: null, filesError: null })
    await get().reloadDetail()
    void get().loadFiles()
  },

  reloadDetail: async () => {
    const id = pid()
    const iid = get().open
    if (!id || iid == null) return
    try {
      const detail = await api.GitLab.Get(id, iid)
      if (get().open === iid) set({ detail, detailError: null })
    } catch (e) {
      if (get().open === iid) set({ detailError: msg(e) })
    }
  },

  loadFiles: async () => {
    const id = pid()
    const iid = get().open
    if (!id || iid == null) return
    set({ filesLoading: true, filesError: null })
    try {
      const files = await api.GitLab.Files(id, iid)
      if (get().open === iid) set({ files })
    } catch (e) {
      if (get().open === iid) set({ filesError: msg(e) })
    } finally {
      set({ filesLoading: false })
    }
  },

  back: () => {
    set({ open: null, detail: null, detailError: null, files: null, filesError: null })
    void get().refresh()
  },
}))

// Projeto trocado: tudo volta ao começo.
let lastProject: string | undefined
useApp.subscribe((s) => {
  const id = s.project?.id
  if (id === lastProject) return
  lastProject = id
  useMergeRequests.setState({ ctx: null, list: null, listError: null, open: null, detail: null, files: null, creating: false })
})
