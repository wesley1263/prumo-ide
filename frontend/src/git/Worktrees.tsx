// Worktrees: outras cópias de trabalho do mesmo repositório (uma branch em cada pasta). Lista, abre como
// projeto, remove; e "Abrir num worktree novo…" a partir de uma branch.
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { FolderGit2 } from 'lucide-react'
import { api, rawMessage, type Worktree } from '../lib/api'
import { Button, TextField } from '../design/controls'
import { Dialog, EmptyState, Spinner, toast } from '../design/feedback'
import { useApp } from '../state/app'
import { t } from '../i18n'

export const useWorktreeUi = create<{ list: boolean; add: string | null }>(() => ({ list: false, add: null }))

export function WorktreesDialog() {
  const open = useWorktreeUi((s) => s.list)
  const project = useApp((s) => s.project)
  const [list, setList] = useState<Worktree[] | null>(null)
  const [dirty, setDirty] = useState<string | null>(null)
  const load = () => project && api.Git.Worktrees(project.id).then(setList, (e) => toast('danger', t('Não foi possível listar'), (e as Error).message))
  useEffect(() => {
    setList(null)
    if (open) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const close = () => useWorktreeUi.setState({ list: false })
  const remove = async (w: Worktree, force: boolean) => {
    try {
      await api.Git.RemoveWorktree(project!.id, w.path, force)
      setDirty(null)
      toast('success', t('Worktree removido'), w.path)
      void load()
    } catch (e) {
      if (!force && /mudanças/.test(rawMessage(e))) setDirty(w.path)
      else toast('danger', t('Não foi possível remover'), (e as Error).message)
    }
  }
  return (
    <Dialog title={t('Worktrees')} isOpen={open} onOpenChange={(o) => !o && close()} size="lg" footer={<Button onPress={close}>{t('Fechar')}</Button>}>
      {!list ? (
        <div className="flex justify-center p-4">
          <Spinner label={t('Lendo worktrees')} />
        </div>
      ) : list.length <= 1 ? (
        <EmptyState title={t('Só a cópia principal')}>{t('Use "Abrir num worktree novo…" no menu de uma branch para trabalhar em duas branches ao mesmo tempo.')}</EmptyState>
      ) : (
        <ul aria-label={t('Worktrees do repositório')} className="flex flex-col">
          {list.map((w) => (
            <li key={w.path} className="flex items-center gap-2 py-1">
              <FolderGit2 className="size-icon-sm shrink-0 text-text-muted" aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm text-text">
                  {w.branch || `HEAD ${w.head.slice(0, 7)}`}
                  {w.current && <span className="ml-1 text-xs text-text-muted">{t('(este projeto)')}</span>}
                  {w.main && !w.current && <span className="ml-1 text-xs text-text-muted">{t('(principal)')}</span>}
                </span>
                <span className="truncate font-mono text-xs text-text-muted">{w.path}</span>
              </span>
              {dirty === w.path ? (
                <>
                  <span className="text-xs text-warning">{t('Tem mudanças não commitadas.')}</span>
                  <Button size="sm" variant="danger" onPress={() => void remove(w, true)}>
                    {t('Remover mesmo assim')}
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" isDisabled={w.current} onPress={() => (close(), void useApp.getState().switchProject(w.path))} aria-label={t('Abrir {path}', { path: w.path })}>
                    {t('Abrir')}
                  </Button>
                  <Button size="sm" isDisabled={w.current || w.main} onPress={() => void remove(w, false)} aria-label={t('Remover {path}', { path: w.path })}>
                    {t('Remover')}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}

export function AddWorktreeDialog() {
  const branch = useWorktreeUi((s) => s.add)
  const project = useApp((s) => s.project)
  const [path, setPath] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!branch || !project) return
    const root = project.rootPath
    const parent = root.slice(0, root.lastIndexOf('/'))
    setPath(`${parent}/${root.slice(root.lastIndexOf('/') + 1)}-${branch.replace(/[^\w.-]+/g, '-')}`)
    setError(undefined)
  }, [branch, project])
  const close = () => useWorktreeUi.setState({ add: null })
  const create = async (openNow: boolean) => {
    setBusy(true)
    try {
      const w = await api.Git.AddWorktree(project!.id, path, branch!, false)
      close()
      if (openNow) await useApp.getState().switchProject(w.path)
      else toast('success', t('Worktree criado'), w.path)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={t('Worktree para {branch}', { branch: branch ?? '' })}
      isOpen={!!branch}
      onOpenChange={(o) => !o && !busy && close()}
      footer={
        <>
          <Button onPress={close}>{t('Cancelar')}</Button>
          <Button isDisabled={!path.trim() || busy} onPress={() => void create(false)}>
            {t('Só criar')}
          </Button>
          <Button variant="primary" loading={busy} isDisabled={!path.trim()} onPress={() => void create(true)}>
            {t('Criar e abrir')}
          </Button>
        </>
      }
    >
      <TextField label={t('Pasta do worktree')} value={path} onChange={(v) => (setPath(v), setError(undefined))} error={error} autoFocus selectOnFocus description={t('Uma pasta nova (ou vazia) com a branch, ligada ao mesmo repositório.')} />
    </Dialog>
  )
}
