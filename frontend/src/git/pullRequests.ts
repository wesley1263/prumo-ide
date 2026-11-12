// Estado dos pull requests do GitHub (a janela Pull requests, a aba de visão geral e os comentários no diff):
// o contexto do projeto no servidor, as seções da lista como no VS Code, os pull requests abertos (detalhe e
// arquivos) e a revisão pendente de cada um (comentários no código ainda não enviados).
import { create } from 'zustand'
import { api, type CommitFile, type DraftComment, type GitHubContext, type PullDetail, type PullQuery, type PullRequest } from '../lib/api'
import { useApp } from '../state/app'
import { useDocs } from '../editor/docs'

export type Section = PullQuery['category']
export const SECTIONS: Section[] = ['review', 'assigned', 'mine', 'all']

interface Loadable<T> {
  data: T | null
  loading: boolean
  error: string | null
}

export interface PrFiles {
  base: string
  head: string
  files: CommitFile[]
}

interface PrState {
  ctx: GitHubContext | null
  ctxLoading: boolean
  sections: Record<Section, Loadable<PullRequest[]> & { open: boolean }>
  /** Pull requests expandidos na árvore (mostram a descrição e os arquivos). */
  expanded: Record<number, boolean>
  details: Record<number, Loadable<PullDetail>>
  files: Record<number, Loadable<PrFiles>>
  /** Revisão pendente: comentários no código ainda não enviados, por pull request. */
  drafts: Record<number, DraftComment[]>
  creating: boolean
  loadContext: () => Promise<void>
  loadSection: (s: Section) => Promise<void>
  toggleSection: (s: Section) => void
  refresh: () => Promise<void>
  togglePull: (n: number) => void
  loadDetail: (n: number) => Promise<void>
  loadFiles: (n: number) => Promise<void>
  openOverview: (pr: { number: number; title: string }) => void
  openFile: (n: number, f: CommitFile) => void
  addDraft: (n: number, d: DraftComment) => void
  removeDraft: (n: number, d: DraftComment) => void
  clearDrafts: (n: number) => void
}

const pid = () => useApp.getState().project?.id
const msg = (e: unknown) => String((e as Error)?.message ?? e)
const idle = <T>(): Loadable<T> => ({ data: null, loading: false, error: null })

/** Revisão das abas de diff de um pull request: "pr:<n>:<base>:<head>". */
export const prRev = (n: number, base: string, head: string) => `pr:${n}:${base}:${head}`
export const parsePrRev = (rev: string) => {
  const [, n, base, head] = rev.split(':')
  return { number: Number(n), base, head }
}

// A revisão pendente sobrevive a fechar a IDE (fica neste computador, como rascunho): chave por repositório.
const draftKey = () => {
  const repo = usePullRequests.getState().ctx?.repo?.fullName
  return repo ? `prumo.prDrafts.${repo}` : null
}
const saveDrafts = (drafts: Record<number, DraftComment[]>) => {
  const k = draftKey()
  if (!k) return
  try {
    localStorage.setItem(k, JSON.stringify(drafts))
  } catch {
    // sem armazenamento: o rascunho fica só na memória
  }
}
const loadDrafts = (): Record<number, DraftComment[]> => {
  const k = draftKey()
  if (!k) return {}
  try {
    return JSON.parse(localStorage.getItem(k) ?? '{}') as Record<number, DraftComment[]>
  } catch {
    return {}
  }
}

const sameDraft = (a: DraftComment, b: DraftComment) => a.path === b.path && a.line === b.line && a.side === b.side && a.body === b.body

const initialSections = (): PrState['sections'] => ({
  review: { ...idle(), open: true },
  assigned: { ...idle(), open: true },
  mine: { ...idle(), open: true },
  all: { ...idle(), open: false },
})

export const usePullRequests = create<PrState>((set, get) => ({
  ctx: null,
  ctxLoading: false,
  sections: initialSections(),
  expanded: {},
  details: {},
  files: {},
  drafts: {},
  creating: false,

  loadContext: async () => {
    const id = pid()
    if (!id) return
    set({ ctxLoading: true })
    try {
      const ctx = await api.GitHub.Context(id)
      set({ ctx })
      if (ctx.repo) {
        set({ drafts: loadDrafts() })
        await get().refresh()
      }
    } catch (e) {
      // Contexto com o erro (e não null): a janela mostra o problema em vez de tentar de novo sem parar.
      set({
        ctx: { remote: '', remoteUrl: '', host: '', path: '', isGitHub: false, server: '', authSource: '', user: null, repo: null, currentBranch: '', currentPull: null, template: '', error: msg(e) },
      })
    } finally {
      set({ ctxLoading: false })
    }
  },

  loadSection: async (s) => {
    const id = pid()
    if (!id) return
    const patch = (p: Partial<Loadable<PullRequest[]>>) => set({ sections: { ...get().sections, [s]: { ...get().sections[s], ...p } } })
    patch({ loading: true, error: null })
    try {
      patch({ data: await api.GitHub.List(id, { category: s, state: 'open' }) })
    } catch (e) {
      patch({ error: msg(e) })
    } finally {
      patch({ loading: false })
    }
  },

  toggleSection: (s) => {
    const cur = get().sections[s]
    set({ sections: { ...get().sections, [s]: { ...cur, open: !cur.open } } })
    if (!cur.open && !cur.data && !cur.loading) void get().loadSection(s)
  },

  refresh: async () => {
    const open = SECTIONS.filter((s) => get().sections[s].open)
    // Os pull requests abertos na tela (expandidos ou na aba de visão geral) também são relidos.
    const shown = new Set<number>(Object.keys(get().details).map(Number))
    await Promise.all([...open.map((s) => get().loadSection(s)), ...[...shown].map((n) => get().loadDetail(n))])
  },

  togglePull: (n) => {
    const open = !get().expanded[n]
    set({ expanded: { ...get().expanded, [n]: open } })
    if (open && !get().files[n]?.data && !get().files[n]?.loading) void get().loadFiles(n)
  },

  loadDetail: async (n) => {
    const id = pid()
    if (!id) return
    const patch = (p: Partial<Loadable<PullDetail>>) => set({ details: { ...get().details, [n]: { ...(get().details[n] ?? idle()), ...p } } })
    patch({ loading: true, error: null })
    try {
      patch({ data: await api.GitHub.Get(id, n) })
    } catch (e) {
      patch({ error: msg(e) })
    } finally {
      patch({ loading: false })
    }
  },

  loadFiles: async (n) => {
    const id = pid()
    if (!id) return
    const patch = (p: Partial<Loadable<PrFiles>>) => set({ files: { ...get().files, [n]: { ...(get().files[n] ?? idle()), ...p } } })
    patch({ loading: true, error: null })
    try {
      patch({ data: await api.GitHub.Files(id, n) })
    } catch (e) {
      patch({ error: msg(e) })
    } finally {
      patch({ loading: false })
    }
  },

  openOverview: (pr) => {
    useDocs.getState().openPull(pr.number, pr.title)
    if (!get().details[pr.number]?.data) void get().loadDetail(pr.number)
  },

  openFile: (n, f) => {
    const files = get().files[n]?.data
    if (!files || f.outside) return
    // Os comentários no código vêm do detalhe: carrega junto se ainda não veio.
    if (!get().details[n]?.data && !get().details[n]?.loading) void get().loadDetail(n)
    void useDocs.getState().openDiff(f.path, { rev: prRev(n, files.base, files.head), oldPath: f.oldPath || undefined })
  },

  addDraft: (n, d) => {
    const drafts = { ...get().drafts, [n]: [...(get().drafts[n] ?? []), d] }
    set({ drafts })
    saveDrafts(drafts)
  },

  removeDraft: (n, d) => {
    const drafts = { ...get().drafts, [n]: (get().drafts[n] ?? []).filter((x) => !sameDraft(x, d)) }
    set({ drafts })
    saveDrafts(drafts)
  },

  clearDrafts: (n) => {
    const { [n]: _, ...drafts } = get().drafts
    set({ drafts })
    saveDrafts(drafts)
  },
}))

// Projeto trocado: tudo volta ao começo.
let lastProject: string | undefined
useApp.subscribe((s) => {
  const id = s.project?.id
  if (id === lastProject) return
  lastProject = id
  usePullRequests.setState({ ctx: null, sections: initialSections(), expanded: {}, details: {}, files: {}, drafts: {}, creating: false })
})
