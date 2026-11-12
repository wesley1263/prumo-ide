// Visão geral de um pull request do GitHub numa aba do editor, como a página de descrição do VS Code:
// situação, checks, revisores, descrição, linha do tempo, conversas no código, arquivos, e as ações
// (checkout, merge, comentar e enviar a revisão com os comentários pendentes).
import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CircleDot, ExternalLink, GitBranch, GitMerge, MessageSquare, RefreshCw, Trash2, XCircle } from 'lucide-react'
import { api, type DraftComment, type PullDetail, type ReviewComment, type ReviewVerdict } from '../lib/api'
import { Badge, Button, IconButton, TextArea } from '../design/controls'
import { Banner, Spinner, toast } from '../design/feedback'
import { cn } from '../design/cn'
import { openUrl } from '../lib/openUrl'
import { useApp } from '../state/app'
import { useGitUi } from '../state/git'
import { usePullRequests } from '../git/pullRequests'
import { CheckIcon, GhMarkdown, PrIcon, checksText, stateLabel, when } from '../git/prUi'
import { t, tn } from '../i18n'

const NO_DRAFTS: DraftComment[] = []

const selectCls = 'h-control-sm rounded-md border border-border-input bg-bg px-1.5 text-xs text-text outline-none focus:border-focus focus:ring-2 focus:ring-focus'

export function PullRequestView({ number }: { number: number }) {
  const d = usePullRequests((s) => s.details[number])
  const loadDetail = usePullRequests((s) => s.loadDetail)
  useEffect(() => {
    if (!d) void loadDetail(number)
  }, [d, number, loadDetail])
  if (d?.error && !d.data)
    return (
      <div className="p-4">
        <Banner level="danger" actions={<Button size="sm" onPress={() => void loadDetail(number)}>{t('Tentar de novo')}</Button>}>
          {d.error}
        </Banner>
      </div>
    )
  if (!d?.data)
    return (
      <div className="flex justify-center p-6">
        <Spinner label={t('Carregando #{n}', { n: number })} />
      </div>
    )
  return <Overview pr={d.data} loading={d.loading} />
}

const verdictLabel = (s: ReviewVerdict) =>
  ({ APPROVED: t('aprovou'), CHANGES_REQUESTED: t('pediu alterações'), COMMENTED: t('comentou'), DISMISSED: t('revisão descartada'), REQUESTED: t('revisão pedida') })[s]

function VerdictIcon({ state }: { state: ReviewVerdict | '' }) {
  const c = 'size-icon-sm shrink-0'
  if (state === 'APPROVED') return <CheckCircle2 className={cn(c, 'text-success')} aria-hidden />
  if (state === 'CHANGES_REQUESTED') return <XCircle className={cn(c, 'text-danger')} aria-hidden />
  if (state === 'REQUESTED') return <CircleDot className={cn(c, 'text-warning')} aria-hidden />
  return <MessageSquare className={cn(c, 'text-text-muted')} aria-hidden />
}

function Overview({ pr, loading }: { pr: PullDetail; loading: boolean }) {
  const project = useApp((s) => s.project)!
  const ctx = usePullRequests((s) => s.ctx)
  const { loadDetail, loadFiles, openFile } = usePullRequests.getState()
  const files = usePullRequests((s) => s.files[pr.number])
  const [checking, setChecking] = useState(false)
  useEffect(() => {
    if (!files) void loadFiles(pr.number)
  }, [files, pr.number, loadFiles])
  const reload = () => {
    void loadDetail(pr.number)
    void loadFiles(pr.number)
  }

  const checkout = async () => {
    if (!project.trusted) return useApp.setState({ trustAsked: true })
    setChecking(true)
    try {
      const ref = await api.GitHub.PrepareCheckout(project.id, pr.number)
      await useGitUi.getState().checkout(ref)
      void usePullRequests.getState().loadContext()
    } catch (e) {
      toast('danger', t('Não foi possível fazer checkout'), String((e as Error).message))
    } finally {
      setChecking(false)
    }
  }

  const threads = useMemo(() => groupThreads(pr.reviewComments), [pr.reviewComments])
  const isOpen = pr.state === 'open'
  return (
    <div className="h-full overflow-y-auto" aria-busy={loading}>
      <article aria-label={t('Pull request #{n}', { n: pr.number })} className="mx-auto flex max-w-[60rem] flex-col gap-4 px-6 py-5">
        <header className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <h1 className="min-w-0 flex-1 text-lg font-semibold text-text">
              {pr.title} <span className="font-normal text-text-muted">#{pr.number}</span>
            </h1>
            <IconButton label={t('Atualizar')} size="sm" icon={<RefreshCw className={cn('size-icon-sm', loading && 'animate-spin')} />} onPress={reload} />
            <IconButton label={t('Abrir no GitHub')} size="sm" icon={<ExternalLink className="size-icon-sm" />} onPress={() => openUrl(pr.htmlUrl)} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
            <Badge tone={pr.state === 'open' ? (pr.draft ? 'neutral' : 'success') : pr.state === 'merged' ? 'info' : 'danger'}>
              <span className="flex items-center gap-1">
                <PrIcon pr={pr} className="size-3 text-current" />
                {stateLabel(pr)}
              </span>
            </Badge>
            <span>
              {t('{author} quer juntar {n} commits de {head} em {base}', { author: pr.author.login, n: pr.commits, head: pr.sameRepo ? pr.head : `${pr.headRepo}:${pr.head}`, base: pr.base })}
            </span>
            <span className="font-mono">
              <span className="text-vcs-added">+{pr.additions}</span> <span className="text-vcs-deleted">−{pr.deletions}</span>
            </span>
            {pr.labels.map((l) => (
              <Badge key={l} tone="info">
                {l}
              </Badge>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {isOpen && (
              <Button size="sm" icon={<GitBranch className="size-icon-sm" />} loading={checking} onPress={() => void checkout()}>
                {ctx?.currentBranch && ctx.currentBranch === pr.head ? t('Atualizar a branch') : t('Fazer checkout')}
              </Button>
            )}
            {isOpen && ctx?.repo?.canPush && <MergeBox pr={pr} />}
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <Section title={t('Descrição', undefined, 'mr')}>
              {pr.body.trim() ? <GhMarkdown text={pr.body} /> : <p className="text-xs text-text-muted">{t('Sem descrição.')}</p>}
            </Section>

            <Section title={t('Conversa')}>
              {pr.timeline.length === 0 && threads.length === 0 ? (
                <p className="text-xs text-text-muted">{t('Nenhum comentário ainda.')}</p>
              ) : (
                <ul aria-label={t('Linha do tempo')} className="flex flex-col gap-2">
                  {pr.timeline.map((it) => (
                    <li key={`${it.kind}-${it.id}`} className="rounded-md border border-border px-3 py-2">
                      <div className="flex items-center gap-1.5 text-xs">
                        {it.kind === 'review' && <VerdictIcon state={it.state} />}
                        <span className="font-semibold text-text">{it.author.login}</span>
                        {it.kind === 'review' && it.state && <span className="text-text-muted">{verdictLabel(it.state)}</span>}
                        <span className="ml-auto shrink-0 text-2xs text-text-muted">{when(it.createdAt)}</span>
                      </div>
                      {it.body && <GhMarkdown text={it.body} className="mt-1" />}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {threads.length > 0 && (
              <Section title={tn(threads.length, '{n} conversa no código', '{n} conversas no código')}>
                <ul className="flex flex-col gap-2">
                  {threads.map((th) => (
                    <li key={th[0].id} className="rounded-md border border-border">
                      <button
                        type="button"
                        disabled={!th[0].path}
                        onClick={() => {
                          const f = files?.data?.files.find((x) => x.path === th[0].path)
                          if (f) openFile(pr.number, f)
                        }}
                        className="flex w-full items-center gap-1.5 border-b border-border px-3 py-1 text-left font-mono text-2xs text-text-muted hover:bg-hover disabled:hover:bg-transparent"
                      >
                        <span className="truncate">
                          {th[0].path || t('fora do projeto')}
                          {th[0].line ? `:${th[0].line}` : ''}
                        </span>
                        {!th[0].line && <Badge>{t('Desatualizado')}</Badge>}
                      </button>
                      <ul className="flex flex-col gap-1.5 px-3 py-2">
                        {th.map((c) => (
                          <li key={c.id}>
                            <div className="flex items-baseline gap-1.5 text-xs">
                              <span className="font-semibold text-text">{c.author.login}</span>
                              <span className="ml-auto text-2xs text-text-muted">{when(c.createdAt)}</span>
                            </div>
                            <GhMarkdown text={c.body} />
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {pr.state !== 'merged' && <ReviewBox pr={pr} />}
          </div>

          <aside className="flex flex-col gap-4">
            <Section title={t('Revisores')}>
              {pr.reviews.length === 0 ? (
                <p className="text-xs text-text-muted">{t('Ninguém ainda')}</p>
              ) : (
                <ul className="flex flex-col gap-1 text-xs">
                  {pr.reviews.map((r) => (
                    <li key={r.user.login} className="flex items-center gap-1.5" aria-label={`${r.user.login}: ${verdictLabel(r.state)}`}>
                      <VerdictIcon state={r.state} />
                      <span className="text-text">{r.user.login}</span>
                      <span className="ml-auto text-text-muted">{verdictLabel(r.state)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title={t('Atribuídos')}>
              {pr.assignees.length === 0 ? <p className="text-xs text-text-muted">{t('Ninguém')}</p> : <p className="text-xs text-text">{pr.assignees.map((u) => u.login).join(', ')}</p>}
            </Section>
            <Section title={t('Checks')}>
              <p className="text-xs text-text">{checksText(pr.checks)}</p>
              {pr.checks.runs.length > 0 && (
                <ul aria-label={t('Checks')} className="flex flex-col gap-0.5 text-xs">
                  {pr.checks.runs.map((r, i) => (
                    <li key={`${r.name}-${i}`} className="flex items-center gap-1.5">
                      <CheckIcon status={r.status} conclusion={r.conclusion} />
                      {r.url ? (
                        <button type="button" className="truncate text-left text-text underline-offset-2 hover:underline" onClick={() => openUrl(r.url)}>
                          {r.name}
                        </button>
                      ) : (
                        <span className="truncate text-text">{r.name}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title={files?.data ? t('Arquivos ({n})', { n: files.data.files.length }) : t('Arquivos')}>
              {files?.error ? (
                <p className="text-xs text-danger">{files.error}</p>
              ) : !files?.data ? (
                <Spinner label={t('Buscando o pull request no repositório')} />
              ) : (
                <ul aria-label={t('Arquivos do pull request')} className="flex flex-col">
                  {files.data.files.map((f) => (
                    <li key={f.path}>
                      <button
                        type="button"
                        disabled={f.outside}
                        onClick={() => openFile(pr.number, f)}
                        title={f.path}
                        className="flex h-row w-full items-center gap-1.5 rounded-sm px-1 text-left text-xs hover:bg-hover focus-visible:bg-selection focus-visible:outline-none disabled:text-text-subtle"
                      >
                        <span className="truncate text-text">{f.path.split('/').pop()}</span>
                        {pr.reviewComments.some((c) => c.path === f.path) && <MessageSquare className="size-3 shrink-0 text-text-muted" aria-label={t('tem comentários')} />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </aside>
        </div>
      </article>
    </div>
  )
}

/** Agrupa os comentários no código em conversas (o primeiro e as respostas). */
export function groupThreads(list: ReviewComment[]): ReviewComment[][] {
  const byRoot = new Map<number, ReviewComment[]>()
  for (const c of list) {
    const root = c.inReplyTo || c.id
    byRoot.set(root, [...(byRoot.get(root) ?? []), c])
  }
  return [...byRoot.values()]
}

/** Merge pelo próprio GitHub, com a forma escolhida (merge, squash ou rebase). */
function MergeBox({ pr }: { pr: PullDetail }) {
  const project = useApp((s) => s.project)!
  const [method, setMethod] = useState<'merge' | 'squash' | 'rebase'>('merge')
  const [busy, setBusy] = useState(false)
  const blocked = pr.draft || pr.mergeable === false
  const hint = pr.draft
    ? t('Rascunho: marque como pronto no GitHub antes do merge')
    : pr.mergeable === false
      ? t('Tem conflitos com {base}', { base: pr.base })
      : pr.mergeableState === 'blocked'
        ? t('Bloqueado pelas regras da branch (revisões ou checks obrigatórios)')
        : pr.mergeableState === 'behind'
          ? t('A branch está atrás de {base}', { base: pr.base })
          : ''
  const merge = async () => {
    setBusy(true)
    try {
      await api.GitHub.Merge(project.id, pr.number, method, pr.headSha)
      toast('success', t('Pull request #{n} juntado', { n: pr.number }), pr.title)
      void usePullRequests.getState().loadDetail(pr.number)
      void usePullRequests.getState().refresh()
    } catch (e) {
      toast('danger', t('Não foi possível fazer o merge'), String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="flex items-center gap-1.5">
      <select aria-label={t('Forma do merge')} value={method} onChange={(e) => setMethod(e.target.value as typeof method)} className={selectCls}>
        <option value="merge">{t('Criar commit de merge')}</option>
        <option value="squash">{t('Squash e merge')}</option>
        <option value="rebase">{t('Rebase e merge')}</option>
      </select>
      <Button size="sm" variant="primary" icon={<GitMerge className="size-icon-sm" />} loading={busy} isDisabled={blocked} onPress={() => void merge()}>
        {t('Fazer merge')}
      </Button>
      {hint && <span className="text-xs text-text-muted">{hint}</span>}
    </span>
  )
}

/** Comentar na conversa ou enviar a revisão (com os comentários pendentes no código). */
function ReviewBox({ pr }: { pr: PullDetail }) {
  const project = useApp((s) => s.project)!
  const me = usePullRequests((s) => s.ctx?.user?.login)
  const drafts = usePullRequests((s) => s.drafts[pr.number]) ?? NO_DRAFTS
  const { removeDraft, clearDrafts, loadDetail } = usePullRequests.getState()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const mine = me === pr.author.login

  const send = async (event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES') => {
    setBusy(event)
    try {
      if (event === 'COMMENT' && drafts.length === 0) await api.GitHub.Comment(project.id, pr.number, text)
      else {
        await api.GitHub.Review(project.id, pr.number, pr.headSha, { event, body: text, comments: drafts })
        clearDrafts(pr.number)
      }
      setText('')
      toast('success', event === 'APPROVE' ? t('Pull request aprovado') : event === 'REQUEST_CHANGES' ? t('Alterações pedidas') : drafts.length ? t('Revisão enviada') : t('Comentário publicado'))
      await loadDetail(pr.number)
    } catch (e) {
      toast('danger', t('Não foi possível enviar'), String((e as Error).message))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Section title={drafts.length ? t('Sua revisão') : t('Comentar')}>
      {drafts.length > 0 && (
        <ul aria-label={t('Comentários pendentes')} className="flex flex-col gap-1">
          {drafts.map((d) => (
            <li key={`${d.path}:${d.side}:${d.line}:${d.body}`} className="flex items-start gap-2 rounded-md border border-warning bg-warning-bg px-2 py-1 text-xs">
              <span className="shrink-0 font-mono text-text-muted">
                {d.path}:{d.line}
                {d.side === 'LEFT' ? ` (${t('antes')})` : ''}
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap text-text">{d.body}</span>
              <IconButton label={t('Descartar este comentário')} size="sm" icon={<Trash2 className="size-icon-sm" />} onPress={() => removeDraft(pr.number, d)} />
            </li>
          ))}
        </ul>
      )}
      <TextArea
        label={t('Comentário geral')}
        hideLabel
        value={text}
        onChange={setText}
        rows={4}
        placeholder={drafts.length ? t('Resumo da revisão (opcional para aprovar). Markdown.') : t('Escreva um comentário (Markdown). Ctrl+Enter envia.')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && (text.trim() || drafts.length)) {
            e.preventDefault()
            void send('COMMENT')
          }
        }}
      />
      <div className="flex flex-wrap justify-end gap-1.5">
        {!mine && pr.state === 'open' && (
          <>
            <Button size="sm" loading={busy === 'REQUEST_CHANGES'} isDisabled={!!busy || (!text.trim() && drafts.length === 0)} onPress={() => void send('REQUEST_CHANGES')}>
              {t('Pedir alterações')}
            </Button>
            <Button size="sm" loading={busy === 'APPROVE'} isDisabled={!!busy} onPress={() => void send('APPROVE')}>
              {t('Aprovar')}
            </Button>
          </>
        )}
        <Button size="sm" variant="primary" loading={busy === 'COMMENT'} isDisabled={!!busy || (!text.trim() && drafts.length === 0)} onPress={() => void send('COMMENT')}>
          {drafts.length ? tn(drafts.length, 'Enviar revisão ({n} comentário)', 'Enviar revisão ({n} comentários)') : t('Comentar')}
        </Button>
      </div>
    </Section>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h2 className="text-xs font-semibold text-text-muted">{title}</h2>
      {children}
    </section>
  )
}
