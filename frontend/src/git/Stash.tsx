// Stash: guardar as mudanças de lado (com ou sem os arquivos novos) e recuperar depois, aplicando, aplicando e
// tirando da pilha, ou apagando.
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { api, type StashEntry } from '../lib/api'
import { useApp } from '../state/app'
import { afterDiskChange, useGitUi } from '../state/git'
import { useDocs } from '../editor/docs'
import { Button, Checkbox, IconButton, TextField } from '../design/controls'
import { Dialog, EmptyState, Spinner, toast } from '../design/feedback'
import { formatDate } from '../panels/GitLogPanel'
import { Trash2 } from 'lucide-react'
import { t, tn } from '../i18n'

export const useStashUi = create<{ save: boolean; restore: boolean }>(() => ({ save: false, restore: false }))

function trustedProject() {
  const p = useApp.getState().project
  if (p && !p.trusted) {
    useApp.setState({ trustAsked: true })
    return null
  }
  return p
}

export function StashDialog() {
  const open = useStashUi((s) => s.save)
  const close = () => useStashUi.setState({ save: false })
  const [message, setMessage] = useState('')
  const [untracked, setUntracked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (open) {
      setMessage('')
      setError(undefined)
    }
  }, [open])
  const save = async () => {
    const p = trustedProject()
    if (!p) return
    setBusy(true)
    try {
      await useDocs.getState().autosave()
      await api.Git.StashSave(p.id, message, untracked)
      await afterDiskChange()
      close()
      toast('success', t('Mudanças guardadas'), t('Recupere em Commit → Recuperar stash…'))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={t('Guardar mudanças (stash)')}
      isOpen={open}
      onOpenChange={(o) => !o && close()}
      footer={
        <>
          <Button onPress={close}>{t('Cancelar')}</Button>
          <Button variant="primary" loading={busy} onPress={save}>
            {t('Guardar')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField label={t('Descrição')} value={message} onChange={setMessage} placeholder={t('ex.: frete pela metade')} autoFocus error={error} onKeyDown={(e) => e.key === 'Enter' && void save()} />
        <Checkbox isSelected={untracked} onChange={setUntracked}>
          {t('Incluir os arquivos novos (não versionados)')}
        </Checkbox>
        <p className="text-xs text-text-muted">{t('As mudanças saem dos arquivos e ficam guardadas; os arquivos voltam ao último commit.')}</p>
      </div>
    </Dialog>
  )
}

export function UnstashDialog() {
  const open = useStashUi((s) => s.restore)
  const close = () => useStashUi.setState({ restore: false })
  const project = useApp((s) => s.project)
  const [list, setList] = useState<StashEntry[] | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const load = () => project && api.Git.StashList(project.id).then(setList, () => setList([]))
  useEffect(() => {
    if (open) {
      setList(null)
      void load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const apply = async (s: StashEntry, pop: boolean) => {
    const p = trustedProject()
    if (!p) return
    setBusy(s.index)
    try {
      await useDocs.getState().autosave()
      const res = await api.Git.StashApply(p.id, s.index, pop)
      await afterDiskChange()
      if (res.conflicts?.length) {
        close()
        useGitUi.getState().setConflictsOpen(true)
        toast('warning', t('O stash conflitou'), res.message)
      } else if (!res.ok) {
        toast('warning', t('Não foi possível aplicar'), res.message)
      } else {
        close()
        toast('success', res.message)
      }
    } catch (e) {
      toast('danger', t('Não foi possível aplicar'), (e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const drop = async (s: StashEntry) => {
    const p = trustedProject()
    if (!p) return
    setBusy(s.index)
    try {
      await api.Git.StashDrop(p.id, s.index)
      await load()
    } catch (e) {
      toast('danger', t('Não foi possível apagar'), (e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog title={t('Recuperar stash')} isOpen={open} onOpenChange={(o) => !o && close()} size="md" footer={<Button onPress={close}>{t('Fechar')}</Button>}>
      {!list ? (
        <Spinner label={t('Lendo a pilha de stash')} />
      ) : list.length === 0 ? (
        <EmptyState title={t('Nada guardado')}>{t('Use Commit → Guardar (stash)… para pôr mudanças de lado.')}</EmptyState>
      ) : (
        <ul aria-label="Stashes" className="flex flex-col">
          {list.map((s) => (
            <li key={s.index} className="flex items-center gap-2 border-t border-border py-2 first:border-t-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-text">{s.message || t('(sem descrição)')}</p>
                <p className="text-xs text-text-muted">
                  {s.branch && t('em {branch} · ', { branch: s.branch })}
                  {tn(s.files, '{n} arquivo', '{n} arquivos')} · {formatDate(s.date)}
                </p>
              </div>
              {busy === s.index ? (
                <Spinner label={t('Aplicando')} />
              ) : (
                <>
                  <Button size="sm" onPress={() => void apply(s, false)} aria-label={t('Aplicar: {message}', { message: s.message })}>
                    {t('Aplicar')}
                  </Button>
                  <Button size="sm" variant="primary" onPress={() => void apply(s, true)} aria-label={t('Aplicar e remover: {message}', { message: s.message })}>
                    {t('Aplicar e remover')}
                  </Button>
                  <IconButton label={t('Apagar: {message}', { message: s.message })} size="sm" icon={<Trash2 className="size-icon-sm" />} onPress={() => void drop(s)} />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
