// Ações do git que mexem no disco: salvam antes, releem depois e avisam o resultado.
import { create } from 'zustand'
import { api } from '../lib/api'
import { toast } from '../design/feedback'
import { t } from '../i18n'
import { useApp } from './app'
import { useDocs } from '../editor/docs'
import { useLayout } from '../shell/layout'

interface GitUi {
  pushOpen: boolean
  branchesOpen: boolean
  /** Troca de branch bloqueada por mudanças locais: o diálogo pergunta o que fazer. */
  checkoutBlocked: { ref: string; files: string[] } | null
  openPush: () => void
  closePush: () => void
  setBranchesOpen: (open: boolean) => void
  checkout: (ref: string, mode?: 'normal' | 'smart' | 'force') => Promise<void>
  update: (mode: 'merge' | 'rebase') => Promise<boolean>
  abort: () => Promise<void>
  /** S25: lista de arquivos em conflito. */
  conflictsOpen: boolean
  setConflictsOpen: (open: boolean) => void
  /** S26: arquivo aberto no editor de 3 painéis. */
  merging: string | null
  openMerge: (path: string | null) => void
  resolve: (path: string, side: 'content' | 'ours' | 'theirs' | 'delete', content?: string) => Promise<boolean>
  /** Conclui o merge/rebase (commit de merge, rebase --continue). */
  finish: () => Promise<void>
}

/** Mensagens de commit usadas (as últimas 20, a mais nova primeiro); salvas com o projeto. */
export const useCommitHistory = create<{ messages: string[] }>(() => ({ messages: [] }))
export function rememberMessage(m: string) {
  const msg = m.trim()
  if (!msg) return
  const list = useCommitHistory.getState().messages.filter((x) => x !== msg)
  useCommitHistory.setState({ messages: [msg, ...list].slice(0, 20) })
}

/** Branches favoritas do projeto (aparecem primeiro, com ★); null = ainda não mexeu: main e master. */
export const useFavoriteBranches = create<{ list: string[] | null }>(() => ({ list: null }))
export const favoriteBranches = () => useFavoriteBranches.getState().list ?? ['main', 'master', 'origin/main', 'origin/master']
export function toggleFavorite(name: string) {
  const cur = favoriteBranches()
  useFavoriteBranches.setState({ list: cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name] })
}

/** Changelists: grupos nomeados de mudanças no Commit (o resto fica em "Mudanças"). Salvas com o projeto. */
export interface Changelist {
  name: string
  files: string[]
}
export const useChangelists = create<{ lists: Changelist[] }>(() => ({ lists: [] }))
export function moveToChangelist(path: string, name: string | null) {
  const lists = useChangelists.getState().lists.map((l) => ({ ...l, files: l.files.filter((f) => f !== path) }))
  if (name) {
    const i = lists.findIndex((l) => l.name === name)
    if (i >= 0) lists[i] = { ...lists[i], files: [...lists[i].files, path] }
    else lists.push({ name, files: [path] })
  }
  useChangelists.setState({ lists })
}

/** Comparar a branch atual com outra (diálogo). */
export const useBranchCompare = create<{ other: string | null }>(() => ({ other: null }))

/** Depois que o git mudou arquivos: relê o editor, a árvore e o status. */
export async function afterDiskChange() {
  await useDocs.getState().reloadFromDisk()
  window.dispatchEvent(new CustomEvent('goide:refresh-tree'))
  await useApp.getState().refreshGit()
}

function projectId(): string | null {
  const p = useApp.getState().project
  if (!p) return null
  if (!p.trusted) {
    useApp.setState({ trustAsked: true })
    return null
  }
  return p.id
}

export const useGitUi = create<GitUi>((set, get) => ({
  pushOpen: false,
  branchesOpen: false,
  conflictsOpen: false,
  merging: null,
  setConflictsOpen: (open) => set({ conflictsOpen: open }),
  openMerge: (path) => set({ merging: path }),

  resolve: async (path, side, content = '') => {
    const pid = projectId()
    if (!pid) return false
    try {
      await api.Git.ResolveConflict(pid, path, side, content)
      await afterDiskChange()
      return true
    } catch (e) {
      toast('danger', t('Não foi possível resolver {path}', { path }), String((e as Error).message))
      return false
    }
  },

  finish: async () => {
    const pid = projectId()
    if (!pid) return
    await useDocs.getState().autosave()
    try {
      const res = await api.Git.ContinueOperation(pid)
      await afterDiskChange()
      if (res.conflicts?.length) {
        set({ conflictsOpen: true })
        toast('warning', t('Ainda há conflitos'), res.message)
        return
      }
      set({ conflictsOpen: false })
      toast(res.ok ? 'success' : 'info', res.message || t('Concluído.'))
    } catch (e) {
      toast('danger', t('Não foi possível concluir'), String((e as Error).message))
    }
  },
  checkoutBlocked: null,
  openPush: () => projectId() && set({ pushOpen: true, branchesOpen: false }),
  closePush: () => set({ pushOpen: false }),
  setBranchesOpen: (open) => set({ branchesOpen: open }),

  checkout: async (ref, mode = 'normal') => {
    const pid = projectId()
    if (!pid) return
    set({ checkoutBlocked: null })
    await useDocs.getState().autosave()
    try {
      const res = await api.Git.Checkout(pid, ref, mode)
      if (!res.ok && res.localChanges?.length) {
        set({ checkoutBlocked: { ref, files: res.localChanges }, branchesOpen: false })
        return
      }
      set({ branchesOpen: false })
      await afterDiskChange()
      if (res.message) toast('warning', t('Trocou de branch, com conflito'), res.message)
    } catch (e) {
      toast('danger', t('Não foi possível trocar de branch'), String((e as Error).message))
    }
  },

  update: async (mode) => {
    const pid = projectId()
    if (!pid) return false
    await useDocs.getState().autosave()
    try {
      const res = await api.Git.Update(pid, mode)
      await afterDiskChange()
      if (res.conflicts?.length) {
        useLayout.getState().show('commit')
        set({ conflictsOpen: true })
        toast('danger', t('Atualização parou em conflito'), `${res.conflicts.join(', ')}\n${t('Resolva os conflitos e conclua, ou aborte.')}`, {
          label: t('Abortar'),
          run: () => void get().abort(),
        })
        return false
      }
      toast('success', res.message || t('Atualizado.'))
      return true
    } catch (e) {
      toast('danger', t('Não foi possível atualizar'), String((e as Error).message))
      return false
    }
  },

  abort: async () => {
    const pid = projectId()
    if (!pid) return
    try {
      await api.Git.AbortOperation(pid)
      await afterDiskChange()
      toast('info', t('Operação abortada'), t('O repositório voltou ao estado anterior.'))
    } catch (e) {
      toast('danger', t('Não foi possível abortar'), String((e as Error).message))
    }
  },
}))
