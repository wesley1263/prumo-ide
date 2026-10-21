// Rebase interativo a partir de um commit do Log: os commits depois dele, do mais antigo ao mais novo, com a
// ação de cada um (pick, reword, edit, squash, fixup, drop) e a ordem (subir/descer).
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { api, type LogCommit, type RebaseStep } from '../lib/api'
import { Button, IconButton } from '../design/controls'
import { Banner, Dialog, Spinner, toast } from '../design/feedback'
import { useApp } from '../state/app'
import { afterDiskChange, useGitUi } from '../state/git'
import { cn } from '../design/cn'
import { t } from '../i18n'

export const useRebaseUi = create<{ base: LogCommit | null }>(() => ({ base: null }))

const ACTIONS: Array<{ id: RebaseStep['action']; label: string }> = [
  { id: 'pick', label: t('pick: manter') },
  { id: 'reword', label: t('reword: nova mensagem') },
  { id: 'edit', label: t('edit: parar para mudar') },
  { id: 'squash', label: t('squash: juntar ao anterior') },
  { id: 'fixup', label: t('fixup: juntar sem a mensagem') },
  { id: 'drop', label: t('drop: tirar') },
]

type Row = RebaseStep & { subject: string }

const selectCls = 'h-control rounded-md border border-border-input bg-bg px-1 text-sm text-text outline-none focus:border-focus focus:ring-2 focus:ring-focus'

export function RebaseDialog() {
  const base = useRebaseUi((s) => s.base)
  const project = useApp((s) => s.project)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setRows(null)
    setError(null)
    if (!base || !project) return
    api.Git.RebaseCommits(project.id, base.hash).then(
      (list) => setRows(list.map((c) => ({ action: 'pick', hash: c.hash, subject: c.subject }))),
      (e) => setError((e as Error).message),
    )
  }, [base, project])
  const close = () => useRebaseUi.setState({ base: null })
  const set = (i: number, patch: Partial<Row>) => setRows((r) => r!.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const move = (i: number, d: number) =>
    setRows((r) => {
      const n = [...r!]
      ;[n[i], n[i + d]] = [n[i + d], n[i]]
      return n
    })
  const start = async () => {
    if (!rows || !base || !project) return
    setBusy(true)
    try {
      const res = await api.Git.InteractiveRebase(project.id, base.hash, rows.map(({ action, hash, message }) => ({ action, hash, message })))
      await afterDiskChange()
      if (res.conflicts?.length) {
        close()
        useGitUi.getState().setConflictsOpen(true)
        toast('warning', t('O rebase parou em conflito'), t('Resolva os arquivos e continue (ou cancele) pela janela de conflitos.'))
      } else if (res.operation === 'rebase') {
        close()
        toast('info', t('Rebase parado'), res.message)
      } else if (!res.ok) setError(res.message)
      else {
        close()
        toast('success', res.message)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={base ? t('Rebase interativo depois de {hash}', { hash: base.hash.slice(0, 7) }) : t('Rebase interativo')}
      isOpen={!!base}
      onOpenChange={(o) => !o && !busy && close()}
      size="lg"
      footer={
        <>
          <Button onPress={close}>{t('Cancelar')}</Button>
          <Button variant="primary" loading={busy} isDisabled={!rows?.length} onPress={() => void start()}>
            {t('Começar o rebase')}
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-2">
          <Banner level="danger" onClose={() => setError(null)}>
            {error}
          </Banner>
        </div>
      )}
      {!rows ? (
        !error && (
          <div className="flex justify-center p-4">
            <Spinner label={t('Lendo os commits')} />
          </div>
        )
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-muted">{t('Nenhum commit depois deste no branch atual.')}</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-text-muted">{t('Do mais antigo (em cima) ao mais novo. Squash e fixup juntam ao commit de cima.')}</p>
          <ol aria-label={t('Commits do rebase')} className="flex flex-col gap-1">
            {rows.map((r, i) => (
              <li key={r.hash} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <select aria-label={t('Ação para {subject}', { subject: r.subject })} value={r.action} onChange={(e) => set(i, { action: e.target.value as Row['action'], message: r.message ?? r.subject })} className={selectCls}>
                    {ACTIONS.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                  <span className="shrink-0 font-mono text-xs text-text-muted">{r.hash.slice(0, 7)}</span>
                  <span className={cn('min-w-0 flex-1 truncate text-sm', r.action === 'drop' ? 'text-text-muted line-through' : 'text-text')}>{r.subject}</span>
                  <IconButton label={t('Subir {subject}', { subject: r.subject })} size="sm" isDisabled={i === 0} icon={<ArrowUp className="size-icon-sm" />} onPress={() => move(i, -1)} />
                  <IconButton label={t('Descer {subject}', { subject: r.subject })} size="sm" isDisabled={i === rows.length - 1} icon={<ArrowDown className="size-icon-sm" />} onPress={() => move(i, 1)} />
                </div>
                {r.action === 'reword' && (
                  <input
                    aria-label={t('Nova mensagem de {subject}', { subject: r.subject })}
                    value={r.message ?? ''}
                    onChange={(e) => set(i, { message: e.target.value })}
                    className={cn(selectCls, 'ml-8 px-2')}
                  />
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </Dialog>
  )
}
