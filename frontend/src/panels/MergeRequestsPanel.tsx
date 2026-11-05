// Merge requests do GitLab: a lista com filtros e, ao abrir um, a descrição, o CI, as aprovações, os arquivos
// (clique abre o diff) e os comentários. Daqui também se faz checkout da branch e se cria um merge request.
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, CircleDashed, CircleSlash, Clock, ExternalLink, GitBranch, GitMerge, GitPullRequest, Loader2, MessageSquare, Plus, RefreshCw, XCircle } from 'lucide-react'
import { ToolWindowFrame } from '../shell/ToolWindows'
import { Badge, Button, IconButton, TextArea } from '../design/controls'
import { Banner, EmptyState, Spinner, toast } from '../design/feedback'
import { cn } from '../design/cn'
import { api, type MergeRequest, type MrFilter, type MrNote } from '../lib/api'
import { openUrl } from '../lib/openUrl'
import { useApp } from '../state/app'
import { useGitUi } from '../state/git'
import { useDocs } from '../editor/docs'
import { renderMarkdown } from '../editor/MarkdownPreview'
import { openSettings } from '../settings/SettingsDialog'
import { formatDate } from './GitLogPanel'
import { mrRev, useMergeRequests } from '../git/mergeRequests'
import { t, tn } from '../i18n'

const selectCls = 'h-control-sm rounded-md border border-border-input bg-bg px-1.5 text-xs text-text outline-none focus:border-focus focus:ring-2 focus:ring-focus'

const stateLabel = (s: MergeRequest['state']) => ({ opened: t('Aberto'), merged: t('Merged'), closed: t('Fechado'), locked: t('Bloqueado') })[s] ?? s
const stateTone = (s: MergeRequest['state']) => (s === 'opened' ? 'success' : s === 'merged' ? 'info' : 'neutral') as 'success' | 'info' | 'neutral'
const when = (iso: string) => (iso ? formatDate(Date.parse(iso)) : '')

/** Ícone e texto do CI (pipeline do último commit). */
function PipelineIcon({ status }: { status: string }) {
  const c = 'size-icon-sm shrink-0'
  switch (status) {
    case 'success':
      return <CheckCircle2 className={cn(c, 'text-success')} aria-label={t('CI passou')} />
    case 'failed':
      return <XCircle className={cn(c, 'text-danger')} aria-label={t('CI falhou')} />
    case 'running':
      return <Loader2 className={cn(c, 'animate-spin text-accent-text')} aria-label={t('CI rodando')} />
    case 'pending':
    case 'created':
    case 'waiting_for_resource':
    case 'preparing':
    case 'scheduled':
      return <Clock className={cn(c, 'text-warning')} aria-label={t('CI na fila')} />
    case 'manual':
      return <CircleDashed className={cn(c, 'text-text-muted')} aria-label={t('CI esperando ação manual')} />
    default:
      return <CircleSlash className={cn(c, 'text-text-muted')} aria-label={t('CI cancelado ou pulado')} />
  }
}

export function MergeRequestsPanel() {
  const project = useApp((s) => s.project)
  const { ctx, ctxLoading, open, loadContext, refresh } = useMergeRequests()
  useEffect(() => {
    if (!ctx && !ctxLoading) void loadContext()
  }, [ctx, ctxLoading, loadContext])

  const actions = ctx?.project ? (
    <>
      <IconButton label={t('Novo merge request')} size="sm" icon={<Plus className="size-icon-sm" />} onPress={() => useMergeRequests.setState({ creating: true })} />
      <IconButton label={t('Atualizar')} size="sm" icon={<RefreshCw className="size-icon-sm" />} onPress={() => void (open != null ? useMergeRequests.getState().reloadDetail() : refresh())} />
    </>
  ) : null

  let body
  if (!project) body = null
  else if (!ctx)
    body = (
      <div className="flex justify-center p-4">
        <Spinner label={t('Procurando o projeto no GitLab')} />
      </div>
    )
  else if (!ctx.remote)
    body = <EmptyState title={t('Sem remoto')}>{ctx.error || t('O repositório não tem remoto. Os merge requests aparecem quando o projeto vem do GitLab.')}</EmptyState>
  else if (!ctx.isGitLab)
    body = (
      <EmptyState
        title={t('Este projeto não está no GitLab')}
        actions={<Button onPress={() => openSettings('vcs')}>{t('Cadastrar servidor GitLab')}</Button>}
      >
        {t('O remoto {remote} aponta para {url}. Se for um GitLab com outro nome, cadastre o servidor em Configurações → Controle de versão.', { remote: ctx.remote, url: ctx.remoteUrl })}
      </EmptyState>
    )
  else if (!ctx.authSource)
    body = (
      <EmptyState
        title={t('Conecte sua conta do GitLab')}
        actions={
          <>
            <Button variant="primary" onPress={() => openSettings('vcs')}>
              {t('Adicionar token')}
            </Button>
            <Button onPress={() => void loadContext()}>{t('Tentar de novo')}</Button>
          </>
        }
      >
        {t('Para ver e criar merge requests de {host}, cadastre um token de acesso pessoal (escopo api) ou faça login no glab (glab auth login).', { host: ctx.host })}
      </EmptyState>
    )
  else if (!ctx.project)
    body = (
      <div className="p-3">
        <Banner
          level="danger"
          actions={
            <>
              <Button size="sm" onPress={() => void loadContext()}>
                {t('Tentar de novo')}
              </Button>
              <Button size="sm" onPress={() => openSettings('vcs')}>
                {t('Configurações')}
              </Button>
            </>
          }
        >
          {ctx.error || t('Não foi possível abrir o projeto {path} no GitLab.', { path: ctx.path })}
        </Banner>
      </div>
    )
  else body = open != null ? <Detail /> : <List />

  return <ToolWindowFrame actions={actions}>{body}</ToolWindowFrame>
}

// ---------------------------------------------------------------- lista

function List() {
  const { ctx, filter, setFilter, list, listError, listLoading, openMr } = useMergeRequests()
  const [search, setSearch] = useState(filter.search)
  useEffect(() => {
    const id = setTimeout(() => search !== filter.search && setFilter({ search }), 350)
    return () => clearTimeout(id)
  }, [search, filter.search, setFilter])
  const current = ctx?.currentBranch
  const mine = useMemo(() => list?.find((m) => m.sourceBranch === current && m.state === 'opened'), [list, current])
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-1.5 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1 text-xs text-text-muted">
          <GitPullRequest className="size-icon-sm shrink-0" aria-hidden />
          <span className="truncate" title={ctx?.project?.webUrl}>
            {ctx?.project?.path}
          </span>
          {ctx?.user && <span className="ml-auto shrink-0">@{ctx.user.username}</span>}
        </div>
        <div className="flex gap-1.5">
          <select aria-label={t('Estado')} value={filter.state} onChange={(e) => setFilter({ state: e.target.value as MrFilter['state'] })} className={selectCls}>
            <option value="opened">{t('Abertos')}</option>
            <option value="merged">{t('Merged')}</option>
            <option value="closed">{t('Fechados')}</option>
            <option value="all">{t('Todos')}</option>
          </select>
          <select aria-label={t('De quem')} value={filter.scope} onChange={(e) => setFilter({ scope: e.target.value as MrFilter['scope'] })} className={cn(selectCls, 'min-w-0 flex-1')}>
            <option value="all">{t('Todos')}</option>
            <option value="mine">{t('Criados por mim')}</option>
            <option value="review">{t('Esperando a minha revisão')}</option>
            <option value="assigned">{t('Atribuídos a mim')}</option>
          </select>
        </div>
        <input aria-label={t('Buscar merge requests')} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Buscar no título e na descrição')} className={cn(selectCls, 'w-full')} />
      </div>
      {current && !mine && filter.state === 'opened' && list && (
        <button
          type="button"
          onClick={() => useMergeRequests.setState({ creating: true })}
          className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-left text-xs text-accent-text hover:bg-hover"
        >
          <Plus className="size-icon-sm shrink-0" aria-hidden />
          {t('Criar merge request de {branch}', { branch: current })}
        </button>
      )}
      {listError && (
        <div className="p-3">
          <Banner level="danger">{listError}</Banner>
        </div>
      )}
      {!list && listLoading ? (
        <div className="flex justify-center p-4">
          <Spinner label={t('Carregando merge requests')} />
        </div>
      ) : list && list.length === 0 ? (
        <EmptyState title={t('Nenhum merge request')}>{t('Nada com esses filtros.')}</EmptyState>
      ) : (
        <ul aria-label={t('Merge requests')} aria-busy={listLoading} className="min-h-0 flex-1 overflow-y-auto">
          {list?.map((m) => (
            <li key={m.iid}>
              <button
                type="button"
                onClick={() => void openMr(m.iid)}
                aria-label={`!${m.iid} ${m.title}`}
                className="flex w-full flex-col gap-0.5 border-b border-border px-3 py-1.5 text-left outline-none hover:bg-hover focus-visible:bg-selection"
              >
                <span className="flex items-center gap-1.5">
                  {m.pipeline && <PipelineIcon status={m.pipeline.status} />}
                  <span className="min-w-0 flex-1 truncate text-sm text-text">{m.title}</span>
                  {m.draft && <Badge>{t('Rascunho')}</Badge>}
                  {filter.state !== 'opened' && <Badge tone={stateTone(m.state)}>{stateLabel(m.state)}</Badge>}
                </span>
                <span className="flex items-center gap-1.5 text-2xs text-text-muted">
                  <span className="shrink-0 font-mono">!{m.iid}</span>
                  <span className="min-w-0 truncate">
                    {m.author.name} · {m.sourceBranch} → {m.targetBranch}
                  </span>
                  {m.comments > 0 && (
                    <span className="ml-auto flex shrink-0 items-center gap-0.5" aria-label={tn(m.comments, '{n} comentário', '{n} comentários')}>
                      <MessageSquare className="size-3" aria-hidden />
                      {m.comments}
                    </span>
                  )}
                  <span className={cn('shrink-0', m.comments === 0 && 'ml-auto')}>{when(m.updatedAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- detalhe

function Detail() {
  const project = useApp((s) => s.project)!
  const { open, detail, detailError, files, filesError, filesLoading, back, loadFiles, reloadDetail } = useMergeRequests()
  const [checking, setChecking] = useState(false)
  if (detailError)
    return (
      <div className="flex flex-col gap-2 p-3">
        <BackButton onBack={back} />
        <Banner level="danger">{detailError}</Banner>
      </div>
    )
  if (!detail)
    return (
      <div className="flex flex-col gap-2 p-3">
        <BackButton onBack={back} />
        <div className="flex justify-center">
          <Spinner label={t('Carregando !{iid}', { iid: open ?? '' })} />
        </div>
      </div>
    )

  const checkout = async () => {
    if (!project.trusted) return useApp.setState({ trustAsked: true })
    setChecking(true)
    try {
      const ref = await api.GitLab.PrepareCheckout(project.id, detail.iid)
      await useGitUi.getState().checkout(ref)
      void useMergeRequests.getState().loadContext()
    } catch (e) {
      toast('danger', t('Não foi possível fazer checkout'), String((e as Error).message))
    } finally {
      setChecking(false)
    }
  }

  const openDiff = (path: string, oldPath: string) => {
    if (!files) return
    void useDocs.getState().openDiff(path, { rev: mrRev(detail.iid, files.base, files.head), oldPath: oldPath || undefined })
  }

  const comments = detail.notes.filter((n) => !n.system)
  return (
    <div className="flex flex-col gap-3 p-3" aria-label={t('Merge request !{iid}', { iid: detail.iid })}>
      <div className="flex items-center gap-1">
        <BackButton onBack={back} />
        <span className="font-mono text-xs text-text-muted">!{detail.iid}</span>
        <span className="ml-auto" />
        <IconButton label={t('Abrir no GitLab')} size="sm" icon={<ExternalLink className="size-icon-sm" />} onPress={() => openUrl(detail.webUrl)} />
      </div>
      <div>
        <h3 className="text-md font-semibold text-text">{detail.title}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge tone={stateTone(detail.state)}>{stateLabel(detail.state)}</Badge>
          {detail.draft && <Badge>{t('Rascunho')}</Badge>}
          {detail.hasConflicts && <Badge tone="danger">{t('Com conflitos')}</Badge>}
          {detail.labels.map((l) => (
            <Badge key={l} tone="info">
              {l}
            </Badge>
          ))}
        </div>
        <p className="mt-1 text-xs text-text-muted">
          {t('{author} quer juntar {source} em {target}', { author: detail.author.name, source: detail.sourceBranch, target: detail.targetBranch })}
          {detail.createdAt && ` · ${when(detail.createdAt)}`}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {detail.state === 'opened' && (
          <Button size="sm" icon={<GitBranch className="size-icon-sm" />} loading={checking} onPress={() => void checkout()}>
            {t('Fazer checkout')}
          </Button>
        )}
      </div>

      <Section title={t('Situação')}>
        <ul className="flex flex-col gap-1 text-xs">
          <li className="flex items-center gap-1.5">
            {detail.pipeline ? (
              <>
                <PipelineIcon status={detail.pipeline.status} />
                <button type="button" className="text-text underline-offset-2 hover:underline" onClick={() => openUrl(detail.pipeline!.webUrl)}>
                  {t('Pipeline #{id}: {status}', { id: detail.pipeline.id, status: pipelineText(detail.pipeline.status) })}
                </button>
              </>
            ) : (
              <span className="text-text-muted">{t('Sem pipeline')}</span>
            )}
          </li>
          <li className="text-text">
            {detail.approvedBy.length > 0
              ? t('Aprovado por {names}', { names: detail.approvedBy.map((u) => u.name).join(', ') })
              : t('Ainda sem aprovação')}
            {detail.approvalsLeft > 0 && <span className="text-text-muted"> · {tn(detail.approvalsLeft, 'falta {n} aprovação', 'faltam {n} aprovações')}</span>}
          </li>
          <li className="text-text">
            {detail.reviewers.length > 0 ? t('Revisores: {names}', { names: detail.reviewers.map((u) => u.name).join(', ') }) : <span className="text-text-muted">{t('Sem revisores')}</span>}
          </li>
          {detail.mergedBy && (
            <li className="flex items-center gap-1.5 text-text">
              <GitMerge className="size-icon-sm text-accent-text" aria-hidden />
              {t('Merged por {name}', { name: detail.mergedBy.name })}
            </li>
          )}
        </ul>
      </Section>

      <Section title={t('Descrição', undefined, 'mr')}>
        {detail.description.trim() ? <Markdown text={detail.description} /> : <p className="text-xs text-text-muted">{t('Sem descrição.')}</p>}
      </Section>

      <Section title={files ? t('Arquivos ({n})', { n: files.files.length }) : t('Arquivos')}>
        {filesLoading && !files ? (
          <Spinner label={t('Buscando o merge request no repositório')} />
        ) : filesError ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-danger">{filesError}</p>
            <div className="flex gap-1.5">
              {!project.trusted && (
                <Button size="sm" onPress={() => useApp.setState({ trustAsked: true })}>
                  {t('Confiar no projeto')}
                </Button>
              )}
              <Button size="sm" onPress={() => void loadFiles()}>
                {t('Tentar de novo')}
              </Button>
            </div>
          </div>
        ) : files && files.files.length === 0 ? (
          <p className="text-xs text-text-muted">{t('Nenhum arquivo muda.')}</p>
        ) : (
          <ul aria-label={t('Arquivos do merge request')} className="flex flex-col">
            {files?.files.map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  disabled={f.outside}
                  onClick={() => openDiff(f.path, f.oldPath)}
                  aria-label={t('{path}, abrir o diff', { path: f.path })}
                  className="flex h-row w-full items-center gap-2 rounded-sm px-1 text-left text-sm hover:bg-hover focus-visible:bg-selection focus-visible:outline-none disabled:text-text-subtle"
                >
                  <span className={cn('w-3 shrink-0 font-mono text-xs', kindColor[f.kind])} aria-hidden>
                    {f.kind[0].toUpperCase()}
                  </span>
                  <span className="truncate text-text">{f.path}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('Comentários ({n})', { n: comments.length })}>
        <Notes notes={detail.notes} />
        {detail.state !== 'locked' && <CommentBox iid={detail.iid} onDone={reloadDetail} />}
      </Section>
    </div>
  )
}

const kindColor: Record<string, string> = { added: 'text-vcs-added', modified: 'text-vcs-modified', deleted: 'text-vcs-deleted', renamed: 'text-vcs-modified' }

const pipelineText = (s: string) =>
  ({
    success: t('passou'),
    failed: t('falhou'),
    running: t('rodando'),
    pending: t('na fila'),
    created: t('na fila'),
    canceled: t('cancelado'),
    skipped: t('pulado'),
    manual: t('esperando ação manual'),
  })[s] ?? s

function BackButton({ onBack }: { onBack: () => void }) {
  return <IconButton label={t('Voltar para a lista')} size="sm" icon={<ArrowLeft className="size-icon-sm" />} onPress={onBack} />
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h4 className="text-xs font-semibold text-text-muted">{title}</h4>
      {children}
    </section>
  )
}

/** Markdown do GitLab, sanitizado; links abrem no navegador (os relativos, como /uploads/…, no servidor). */
function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  const base = useMergeRequests((s) => s.ctx?.project?.webUrl)
  return (
    <div
      className="prumo-md prumo-md-compact text-sm text-text"
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a')
        if (!a) return
        e.preventDefault()
        const href = a.getAttribute('href') ?? ''
        if (/^https?:\/\//i.test(href)) return openUrl(href)
        if (!base || href.startsWith('#')) return
        // "/uploads/x" é do projeto no GitLab; "/grupo/outro" (começa com outro caminho) é do servidor.
        const server = new URL(base).origin
        openUrl(href.startsWith('/uploads/') ? base + href : href.startsWith('/') ? server + href : `${base}/${href}`)
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function Notes({ notes }: { notes: MrNote[] }) {
  if (notes.length === 0) return <p className="text-xs text-text-muted">{t('Nenhum comentário ainda.')}</p>
  return (
    <ul aria-label={t('Comentários')} className="flex flex-col gap-2">
      {notes.map((n) =>
        n.system ? (
          <li key={n.id} className="text-2xs text-text-muted">
            {n.author.name} {n.body} · {when(n.createdAt)}
          </li>
        ) : (
          <li key={n.id} className="rounded-md border border-border px-2 py-1.5">
            <div className="flex items-baseline gap-1.5 text-xs">
              <span className="font-semibold text-text">{n.author.name}</span>
              <span className="text-text-muted">@{n.author.username}</span>
              <span className="ml-auto shrink-0 text-2xs text-text-muted">{when(n.createdAt)}</span>
            </div>
            {n.path && (
              <div className="mt-0.5 font-mono text-2xs text-text-muted">
                {n.path}:{n.line}
              </div>
            )}
            <Markdown text={n.body} />
          </li>
        ),
      )}
    </ul>
  )
}

function CommentBox({ iid, onDone }: { iid: number; onDone: () => Promise<void> }) {
  const project = useApp((s) => s.project)!
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      await api.GitLab.Comment(project.id, iid, text)
      setText('')
      await onDone()
    } catch (e) {
      toast('danger', t('Não foi possível comentar'), String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      <TextArea
        label={t('Novo comentário')}
        hideLabel
        value={text}
        onChange={setText}
        rows={3}
        placeholder={t('Escreva um comentário (Markdown). Ctrl+Enter envia.')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void send()
          }
        }}
      />
      <div className="flex justify-end">
        <Button size="sm" variant="primary" loading={busy} isDisabled={!text.trim()} onPress={() => void send()}>
          {t('Comentar')}
        </Button>
      </div>
    </div>
  )
}

