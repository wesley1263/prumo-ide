// Criar pull request da branch atual no GitHub: destino, título, descrição (o modelo do repositório; o agente
// de IA pode escrever os dois), revisores, rascunho. Se a branch ainda não está no remoto (ou tem commits não
// enviados), faz o push antes.
import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { api, type GhUser, type PullRequest } from '../lib/api'
import { Button, Checkbox, IconButton, TextArea, TextField } from '../design/controls'
import { Banner, Dialog, Spinner, toast } from '../design/feedback'
import { cn } from '../design/cn'
import { useApp } from '../state/app'
import { useLayout } from '../shell/layout'
import { useDocs } from '../editor/docs'
import { AgentButton } from './CreateMergeRequest'
import { usePullRequests } from './pullRequests'
import { t, tn } from '../i18n'

const selectCls = 'h-control w-full rounded-md border border-border-input bg-bg px-2 text-sm text-text outline-none focus:border-focus focus:ring-2 focus:ring-focus'

export function CreatePullRequestDialog() {
  const open = usePullRequests((s) => s.creating)
  const close = () => usePullRequests.setState({ creating: false })
  return (
    <Dialog title={t('Novo pull request')} isOpen={open} onOpenChange={(o) => !o && close()} size="lg">
      {open && <Form close={close} />}
    </Dialog>
  )
}

interface Loaded {
  head: string
  remote: string
  bases: string[]
  unpushed: number
  hasUpstream: boolean
  existing: PullRequest | null
}

const showPull = (pr: Pick<PullRequest, 'number' | 'title'>) => {
  useLayout.getState().show('pullRequests')
  usePullRequests.getState().openOverview(pr)
}

function Form({ close }: { close: () => void }) {
  const project = useApp((s) => s.project)!
  const [data, setData] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [base, setBase] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [draft, setDraft] = useState(false)
  const [reviewers, setReviewers] = useState<GhUser[]>([])
  const [assignToMe, setAssignToMe] = useState(true)
  const [push, setPush] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Branch atual, destinos possíveis (as branches do remoto), o que falta enviar e se já existe pull request.
  useEffect(() => {
    let stale = false
    ;(async () => {
      // O contexto é relido: o pull request da branch atual pode ter sido criado por fora.
      const c = await api.GitHub.Context(project.id)
      if (!c.repo) throw new Error(c.error || t('O projeto não está ligado a um repositório do GitHub.'))
      const [branches, out] = await Promise.all([api.Git.Branches(project.id), api.Git.Outgoing(project.id)])
      const head = branches.current
      if (!head) throw new Error(t('Troque para uma branch antes (o HEAD está solto).'))
      const prefix = c.remote + '/'
      const bases = branches.remote
        .map((b) => b.name)
        .filter((n) => n.startsWith(prefix) && n !== prefix + 'HEAD')
        .map((n) => n.slice(prefix.length))
        .filter((n) => n !== head)
      const def = c.repo.defaultBranch
      if (def && !bases.includes(def) && def !== head) bases.unshift(def)
      if (stale) return
      setData({ head, remote: c.remote, bases, unpushed: out.commits.length, hasUpstream: out.hasUpstream, existing: c.currentPull })
      setBase(bases.includes(def) ? def : (bases[0] ?? ''))
      setPush(!out.hasUpstream || out.commits.length > 0)
      setBody(c.template)
    })().catch((e) => !stale && setLoadError(String((e as Error).message)))
    return () => {
      stale = true
    }
  }, [project.id])

  // Título padrão: com um commit só na branch, o assunto dele (como o GitHub faz).
  useEffect(() => {
    if (!data || !base) return
    let stale = false
    api.Git.CompareBranches(project.id, `${data.remote}/${base}`).then(
      (c) => {
        if (stale) return
        if (c.onlyCurrent.length === 1) setTitle((cur) => cur || c.onlyCurrent[0].subject)
      },
      () => {},
    )
    return () => {
      stale = true
    }
  }, [data, base, project.id])

  const submit = async () => {
    if (!data) return
    if (push && !project.trusted) return useApp.setState({ trustAsked: true }) // push fala com o remoto
    setBusy(true)
    setError(null)
    try {
      if (push) await useDocs.getState().autosave()
      const pr = await api.GitHub.Create(project.id, { head: data.head, base, title, body, draft, reviewers: reviewers.map((r) => r.login), assignToMe, push })
      close()
      showPull(pr)
      void usePullRequests.getState().loadContext()
      toast('success', t('Pull request #{n} criado', { n: pr.number }), pr.title)
    } catch (e) {
      setError(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <Banner level="danger">{loadError}</Banner>
  if (!data) return <Spinner label={t('Preparando o pull request')} />
  if (data.existing)
    return (
      <div className="flex flex-col gap-3">
        <Banner level="info">{t('A branch {branch} já tem um pull request aberto: #{n} {title}', { branch: data.head, n: data.existing.number, title: data.existing.title })}</Banner>
        <div className="flex justify-end gap-2">
          <Button onPress={close}>{t('Fechar')}</Button>
          <Button
            variant="primary"
            onPress={() => {
              close()
              showPull(data.existing!)
            }}
          >
            {t('Abrir #{n}', { n: data.existing.number })}
          </Button>
        </div>
      </div>
    )

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="flex items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs text-text-muted">{t('De')}</span>
          <span className="flex h-control items-center truncate font-mono text-sm text-text">{data.head}</span>
        </div>
        <span className="pb-2 text-text-muted" aria-hidden>
          →
        </span>
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs text-text-muted">{t('Para')}</span>
          <select aria-label={t('Branch de destino')} value={base} onChange={(e) => setBase(e.target.value)} className={cn(selectCls, 'font-mono')}>
            {data.bases.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-end gap-1">
        <TextField label={t('Título')} value={title} onChange={setTitle} autoFocus className="min-w-0 flex-1" />
        <AgentButton
          target={base}
          suggest={api.GitHub.SuggestDescription}
          cancel={api.GitHub.CancelSuggest}
          onResult={(r) => {
            setTitle(r.title)
            setBody(r.description)
          }}
        />
      </div>
      <TextArea label={t('Descrição (Markdown)')} value={body} onChange={setBody} rows={8} />
      <Reviewers selected={reviewers} onChange={setReviewers} />
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <Checkbox isSelected={draft} onChange={setDraft}>
          {t('Rascunho (Draft)')}
        </Checkbox>
        <Checkbox isSelected={assignToMe} onChange={setAssignToMe}>
          {t('Atribuir a mim')}
        </Checkbox>
      </div>
      <Checkbox isSelected={push} onChange={setPush}>
        {!data.hasUpstream
          ? t('Enviar {branch} para {remote} antes (a branch ainda não está no remoto)', { branch: data.head, remote: data.remote })
          : data.unpushed > 0
            ? tn(data.unpushed, 'Enviar {n} commit que ainda não está no remoto', 'Enviar {n} commits que ainda não estão no remoto')
            : t('Fazer push antes')}
      </Checkbox>
      {error && <Banner level="danger">{error}</Banner>}
      <div className="flex justify-end gap-2">
        <Button onPress={close}>{t('Cancelar')}</Button>
        <Button variant="primary" type="submit" loading={busy} isDisabled={!title.trim() || !base}>
          {t('Criar pull request')}
        </Button>
      </div>
    </form>
  )
}

/** Busca pessoas do repositório (as que podem ser atribuídas) e marca como revisores. */
function Reviewers({ selected, onChange }: { selected: GhUser[]; onChange: (u: GhUser[]) => void }) {
  const project = useApp((s) => s.project)!
  const me = usePullRequests((s) => s.ctx?.user?.login)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<GhUser[]>([])
  useEffect(() => {
    if (!q.trim()) return setFound([])
    let stale = false
    const id = setTimeout(() => {
      api.GitHub.Assignable(project.id, q).then(
        (list) => !stale && setFound(list),
        () => !stale && setFound([]),
      )
    }, 250)
    return () => {
      stale = true
      clearTimeout(id)
    }
  }, [q, project.id])
  // O GitHub não deixa pedir revisão a quem abriu o pull request.
  const options = useMemo(() => found.filter((u) => u.login !== me && !selected.some((s) => s.login === u.login)), [found, selected, me])
  return (
    <div className="flex flex-col gap-1">
      <TextField label={t('Revisores')} value={q} onChange={setQ} placeholder={t('Buscar pelo usuário')} />
      {options.length > 0 && (
        <ul aria-label={t('Pessoas encontradas')} className="flex max-h-[8rem] flex-col overflow-y-auto rounded-md border border-border">
          {options.map((u) => (
            <li key={u.login}>
              <button
                type="button"
                onClick={() => {
                  onChange([...selected, u])
                  setQ('')
                }}
                className="flex h-row w-full items-center gap-2 px-2 text-left text-sm hover:bg-hover focus-visible:bg-selection focus-visible:outline-none"
              >
                <span className="text-text">@{u.login}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected.length > 0 && (
        <ul aria-label={t('Revisores escolhidos')} className="flex flex-wrap gap-1">
          {selected.map((u) => (
            <li key={u.login} className="flex items-center gap-1 rounded-pill bg-selection py-0.5 pl-2 pr-0.5 text-xs text-text">
              @{u.login}
              <IconButton label={t('Tirar {name}', { name: u.login })} size="sm" icon={<X className="size-3" />} onPress={() => onChange(selected.filter((s) => s.login !== u.login))} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
