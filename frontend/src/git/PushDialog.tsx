// S22 Push: o que vai ser enviado, para onde, e o que fazer se o remoto recusar.
import { useEffect, useState } from 'react'
import { api, type Outgoing } from '../lib/api'
import { Button, Checkbox, TextField } from '../design/controls'
import { Banner, Dialog, EmptyState, Spinner, toast } from '../design/feedback'
import { useApp } from '../state/app'
import { useGitUi } from '../state/git'
import { lang, t } from '../i18n'

const when = (unix: number) => new Date(unix * 1000).toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' })

export function PushDialog() {
  const open = useGitUi((s) => s.pushOpen)
  const close = useGitUi((s) => s.closePush)
  const update = useGitUi((s) => s.update)
  const project = useApp((s) => s.project)
  const [out, setOut] = useState<Outgoing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [remote, setRemote] = useState('')
  const [target, setTarget] = useState('')
  const [track, setTrack] = useState(true)
  const [force, setForce] = useState(false)
  const [busy, setBusy] = useState(false)
  const [rejected, setRejected] = useState<string | null>(null)

  const load = async () => {
    if (!project) return
    setError(null)
    try {
      const o = await api.Git.Outgoing(project.id)
      setOut(o)
      setRemote(o.remote)
      setTarget(o.target)
    } catch (e) {
      setError(String((e as Error).message))
    }
  }
  useEffect(() => {
    if (!open) return
    setOut(null)
    setRejected(null)
    setForce(false)
    setTrack(true)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const push = async () => {
    if (!project || !out) return
    setBusy(true)
    setRejected(null)
    try {
      const res = await api.Git.Push(project.id, { remote, target, setUpstream: !out.hasUpstream && track, force, tags: false })
      if (res.rejected) {
        setRejected(res.message)
        return
      }
      toast('success', t('Push concluído'), t('{n} commit(s) em {remote}/{target}', { n: out.commits.length, remote, target }))
      close()
      await useApp.getState().refreshGit()
    } catch (e) {
      toast('danger', t('O push falhou'), String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  // Push recusado: atualiza com merge ou rebase e deixa o diálogo pronto para tentar de novo.
  const updateThenRetry = async (mode: 'merge' | 'rebase') => {
    setBusy(true)
    const ok = await update(mode)
    setBusy(false)
    if (ok) {
      await load()
      setRejected(null)
    } else close()
  }

  const nothing = out && out.hasUpstream && out.commits.length === 0 && !force
  return (
    <Dialog
      title={t('Enviar commits (push)')}
      isOpen={open}
      onOpenChange={(o) => !o && close()}
      size="md"
      footer={
        <>
          <Button onPress={close}>{t('Cancelar')}</Button>
          <Button variant={force ? 'danger' : 'primary'} onPress={push} loading={busy} isDisabled={!out || !remote || !target.trim() || !!nothing}>
            {force ? t('Forçar push') : t('Push')}
          </Button>
        </>
      }
    >
      {error ? (
        <Banner level="danger">{error}</Banner>
      ) : !out ? (
        <div className="flex justify-center p-6">
          <Spinner label={t('Lendo os commits')} />
        </div>
      ) : out.remotes.length === 0 ? (
        <EmptyState title={t('Nenhum remoto configurado')}>{t('Adicione um remoto pelo terminal (git remote add origin URL) e volte aqui.')}</EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {rejected && (
            <Banner
              level="warning"
              actions={
                <>
                  <Button size="sm" onPress={() => updateThenRetry('merge')}>
                    {t('Atualizar (merge)')}
                  </Button>
                  <Button size="sm" onPress={() => updateThenRetry('rebase')}>
                    {t('Atualizar (rebase)')}
                  </Button>
                </>
              }
            >
              {t('Push recusado.')} {rejected}
            </Banner>
          )}
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-muted">{t('De')}</span>
              <span className="flex h-control items-center font-mono text-sm text-text">{out.branch || 'HEAD'}</span>
            </div>
            <span className="flex h-control items-center text-text-muted" aria-hidden>
              →
            </span>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-text-muted">{t('Remoto')}</span>
              <select
                value={remote}
                onChange={(e) => setRemote(e.target.value)}
                className="h-control rounded-md border border-border-input bg-bg px-2 text-sm text-text outline-none focus:border-focus focus:ring-2 focus:ring-focus"
              >
                {out.remotes.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <TextField label={t('Branch de destino')} value={target} onChange={setTarget} className="min-w-0 flex-1" />
          </div>
          <section aria-label={t('Commits a enviar')} className="max-h-dialog-sm overflow-auto rounded-md border border-border">
            {out.commits.length === 0 ? (
              <EmptyState title={t('Nada para enviar')}>{t('A branch já está igual à remota.')}</EmptyState>
            ) : (
              <ul>
                {out.commits.map((c) => (
                  <li key={c.hash} className="flex h-row items-center gap-3 px-3 text-sm odd:bg-bg">
                    <span className="font-mono text-xs text-accent-text">{c.hash}</span>
                    <span className="min-w-0 flex-1 truncate text-text">{c.subject}</span>
                    <span className="shrink-0 text-xs text-text-muted">
                      {c.author} · {when(c.date)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {!out.hasUpstream && (
            <Checkbox isSelected={track} onChange={setTrack}>
              {t('Passar a acompanhar {remote}/{target} (para atualizar e enviar sem escolher de novo)', { remote, target })}
            </Checkbox>
          )}
          <Checkbox isSelected={force} onChange={setForce}>
            {t('Forçar: sobrescrever o remoto, só se ninguém tiver enviado nada desde o último fetch')}
          </Checkbox>
        </div>
      )}
    </Dialog>
  )
}
