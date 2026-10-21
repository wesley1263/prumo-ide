// S29 Clonar repositório: URL, pasta de destino e nome; progresso do git clone em português; ao terminar, abre
// o projeto (e a pergunta de confiança aparece, como em qualquer pasta nova).
import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { on } from '../lib/events'
import { Button, TextField } from '../design/controls'
import { Banner, Dialog, ProgressBar, toast } from '../design/feedback'
import { useApp } from '../state/app'
import { t } from '../i18n'

/** Nome da pasta a partir da URL ("https://x/org/app.git" → "app"), igual ao do backend. */
export function repoName(url: string): string {
  let u = url.trim().replace(/\/+$/, '')
  const i = Math.max(u.lastIndexOf('/'), u.lastIndexOf(':'))
  if (i >= 0) u = u.slice(i + 1)
  u = u.replace(/\.git$/, '')
  return u && u !== '.' && u !== '..' ? u : ''
}

/** Pasta sugerida: a pasta-mãe do projeto aberto por último, ou a pasta do usuário. */
function defaultParent(recent: Array<{ rootPath: string }>, home: string) {
  const last = recent[0]?.rootPath
  return last ? last.slice(0, last.lastIndexOf('/')) || home : home
}

type State = { kind: 'form' } | { kind: 'cloning'; id: string; path: string; phase: string; percent: number; line: string } | { kind: 'error'; message: string }

export function CloneDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const home = useApp((s) => s.boot?.homeDir ?? '')
  const recent = useApp((s) => s.recent)
  const openProject = useApp((s) => s.openProject)
  const [url, setUrl] = useState('')
  const [parent, setParent] = useState(() => defaultParent(recent, home))
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [state, setState] = useState<State>({ kind: 'form' })
  const [fieldError, setFieldError] = useState<string>()

  useEffect(() => {
    if (!nameEdited) setName(repoName(url))
  }, [url, nameEdited])

  useEffect(() => {
    if (state.kind !== 'cloning') return
    let finished = false
    const handle = async (p: { id: string; phase: string; percent: number; line: string; done: boolean; ok: boolean; error?: string; path: string }) => {
      if (p.id !== state.id || finished) return
      if (p.done) finished = true
      if (!p.done) {
        setState((s) => (s.kind === 'cloning' ? { ...s, phase: p.phase, percent: p.percent, line: p.line } : s))
        return
      }
      if (!p.ok) {
        setState({ kind: 'error', message: p.error ?? t('O clone falhou.') })
        return
      }
      onClose()
      setState({ kind: 'form' })
      setUrl('')
      setNameEdited(false)
      toast('success', t('Repositório clonado'), p.path)
      try {
        await openProject(p.path)
      } catch (e) {
        toast('danger', t('Clonou, mas não foi possível abrir'), String((e as Error).message))
      }
    }
    const off = on('clone:progress', handle)
    // O evento pode se perder (quem lê devagar perde avisos): consulta o estado também.
    const timer = setInterval(() => void api.Git.CloneStatus(state.id).then(handle, () => {}), 1000)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [state.kind === 'cloning' ? state.id : null]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async () => {
    try {
      const dir = await api.Dialogs.PickDirectory(t('Pasta onde clonar'))
      if (dir) setParent(dir)
    } catch (e) {
      // Modo dev no navegador: sem seletor nativo, o caminho é digitado no campo.
      if (!(e instanceof ApiError && /seletor nativo/.test(e.raw))) toast('danger', t('Não foi possível escolher a pasta'), String((e as Error).message))
    }
  }

  const start = async () => {
    setFieldError(undefined)
    try {
      const s = await api.Git.Clone(url, parent, name)
      setState({ kind: 'cloning', id: s.id, path: s.path, phase: t('Conectando'), percent: 0, line: '' })
    } catch (e) {
      setFieldError((e as Error).message)
    }
  }

  const cloning = state.kind === 'cloning'
  const target = `${parent.replace(/\/+$/, '')}/${name || '…'}`
  return (
    <Dialog
      title={t('Clonar repositório')}
      isOpen={isOpen}
      onOpenChange={(o) => !o && !cloning && onClose()}
      dismissable={!cloning}
      size="md"
      footer={
        cloning ? (
          <Button onPress={() => void api.Git.CancelClone(state.id)}>{t('Cancelar clone')}</Button>
        ) : (
          <>
            <Button onPress={onClose}>{t('Cancelar')}</Button>
            <Button variant="primary" isDisabled={!url.trim() || !parent.trim()} onPress={start}>
              {t('Clonar')}
            </Button>
          </>
        )
      }
    >
      {cloning ? (
        <div className="flex flex-col gap-2" aria-live="polite">
          <p className="text-sm text-text">
            {t('Clonando em')} <span className="font-mono text-xs">{state.path}</span>
          </p>
          <div className="flex items-center gap-3">
            <ProgressBar label={t('Andamento do clone')} value={state.percent} />
            <span className="text-xs tabular-nums text-text-muted">{state.percent}%</span>
          </div>
          <p role="status" className="text-sm text-text">
            {state.phase}…
          </p>
          {state.line && <p className="truncate font-mono text-xs text-text-muted">{state.line}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {state.kind === 'error' && (
            <Banner level="danger" onClose={() => setState({ kind: 'form' })}>
              {state.message}
            </Banner>
          )}
          <TextField
            label={t('URL do repositório')}
            value={url}
            onChange={(v) => (setUrl(v), setFieldError(undefined))}
            placeholder={t('https://github.com/org/projeto.git ou git@github.com:org/projeto.git')}
            error={fieldError}
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && url.trim() && void start()}
          />
          <div className="flex items-end gap-2">
            <TextField label={t('Pasta de destino')} value={parent} onChange={setParent} className="flex-1" description={t('O repositório vira uma subpasta daqui.')} />
            <div className="pb-5">
              <Button onPress={pick}>{t('Escolher…')}</Button>
            </div>
          </div>
          <TextField
            label={t('Nome da pasta')}
            value={name}
            onChange={(v) => (setName(v), setNameEdited(true))}
            description={t('Vai clonar em {target}', { target })}
          />
          <p className="text-xs text-text-muted">{t('A autenticação é a do seu git: chave no ssh-agent para ssh, credential helper para https.')}</p>
        </div>
      )}
    </Dialog>
  )
}
