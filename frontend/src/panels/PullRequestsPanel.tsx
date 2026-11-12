// Pull requests do GitHub, como a barra lateral do VS Code: o pull request da branch atual e as seções
// "Esperando a minha revisão", "Atribuídos a mim", "Criados por mim" e "Todos abertos". Cada pull request
// abre em árvore: a descrição (visão geral numa aba do editor) e os arquivos (clique abre o diff com os
// comentários de revisão).
import { useEffect } from 'react'
import { ChevronDown, ChevronRight, FileText, MessageSquare, Plus, RefreshCw } from 'lucide-react'
import { ToolWindowFrame } from '../shell/ToolWindows'
import { Badge, Button, IconButton } from '../design/controls'
import { Banner, EmptyState, Spinner } from '../design/feedback'
import { cn } from '../design/cn'
import type { PullRequest } from '../lib/api'
import { openSettings } from '../settings/SettingsDialog'
import { SECTIONS, usePullRequests, type Section } from '../git/pullRequests'
import { PrIcon, when } from '../git/prUi'
import { useApp } from '../state/app'
import { t, tn } from '../i18n'

const sectionTitle = (s: Section) =>
  ({ review: t('Esperando a minha revisão'), assigned: t('Atribuídos a mim'), mine: t('Criados por mim'), all: t('Todos abertos') })[s]

const row = 'flex h-row w-full items-center gap-1.5 text-left text-sm outline-none hover:bg-hover focus-visible:bg-selection'

export function PullRequestsPanel() {
  const project = useApp((s) => s.project)
  const { ctx, ctxLoading, loadContext } = usePullRequests()
  useEffect(() => {
    if (!ctx && !ctxLoading) void loadContext()
  }, [ctx, ctxLoading, loadContext])

  const actions = ctx?.repo ? (
    <>
      <IconButton label={t('Novo pull request')} size="sm" icon={<Plus className="size-icon-sm" />} onPress={() => usePullRequests.setState({ creating: true })} />
      <IconButton label={t('Atualizar')} size="sm" icon={<RefreshCw className="size-icon-sm" />} onPress={() => void loadContext()} />
    </>
  ) : null

  let body
  if (!project) body = null
  else if (!ctx)
    body = (
      <div className="flex justify-center p-4">
        <Spinner label={t('Procurando o repositório no GitHub')} />
      </div>
    )
  else if (!ctx.remote) body = <EmptyState title={t('Sem remoto')}>{ctx.error || t('O repositório não tem remoto. Os pull requests aparecem quando o projeto vem do GitHub.')}</EmptyState>
  else if (!ctx.isGitHub)
    body = (
      <EmptyState title={t('Este projeto não está no GitHub')} actions={<Button onPress={() => openSettings('vcs')}>{t('Cadastrar servidor GitHub')}</Button>}>
        {t('O remoto {remote} aponta para {url}. Se for um GitHub Enterprise com outro nome, cadastre o servidor em Configurações → Controle de versão.', { remote: ctx.remote, url: ctx.remoteUrl })}
      </EmptyState>
    )
  else if (!ctx.authSource)
    body = (
      <EmptyState
        title={t('Conecte sua conta do GitHub')}
        actions={
          <>
            <Button variant="primary" onPress={() => openSettings('vcs')}>
              {t('Adicionar token')}
            </Button>
            <Button onPress={() => void loadContext()}>{t('Tentar de novo')}</Button>
          </>
        }
      >
        {t('Para ver e revisar pull requests de {host}, cadastre um token de acesso pessoal ou faça login no gh (gh auth login).', { host: ctx.host })}
      </EmptyState>
    )
  else if (!ctx.repo)
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
          {ctx.error || t('Não foi possível abrir o repositório {path} no GitHub.', { path: ctx.path })}
        </Banner>
      </div>
    )
  else
    body = (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-1 border-b border-border px-3 py-1.5 text-xs text-text-muted">
          <span className="truncate" title={ctx.repo.htmlUrl}>
            {ctx.repo.fullName}
          </span>
          {ctx.user && <span className="ml-auto shrink-0">@{ctx.user.login}</span>}
        </div>
        <div aria-label={t('Pull requests')} className="min-h-0 flex-1 overflow-y-auto py-1">
          <CurrentBranch />
          {SECTIONS.map((s) => (
            <SectionNode key={s} section={s} />
          ))}
        </div>
      </div>
    )
  return <ToolWindowFrame actions={actions}>{body}</ToolWindowFrame>
}

/** O pull request da branch atual, ou o atalho para criar um (como o "Create Pull Request" do VS Code). */
function CurrentBranch() {
  const ctx = usePullRequests((s) => s.ctx)!
  if (!ctx.currentBranch || ctx.currentBranch === ctx.repo?.defaultBranch) return null
  return (
    <section aria-label={t('Branch atual')} className="mb-1 border-b border-border pb-1">
      <div className="px-3 text-2xs font-semibold uppercase text-text-muted">{t('Branch atual: {branch}', { branch: ctx.currentBranch })}</div>
      {ctx.currentPull ? (
        <PullNode pr={ctx.currentPull} depth={0} />
      ) : (
        <button type="button" onClick={() => usePullRequests.setState({ creating: true })} className={cn(row, 'px-3 text-accent-text')}>
          <Plus className="size-icon-sm shrink-0" aria-hidden />
          {t('Criar pull request de {branch}', { branch: ctx.currentBranch })}
        </button>
      )}
    </section>
  )
}

function SectionNode({ section }: { section: Section }) {
  const s = usePullRequests((st) => st.sections[section])
  const toggle = usePullRequests((st) => st.toggleSection)
  const load = usePullRequests((st) => st.loadSection)
  const title = sectionTitle(section)
  return (
    <section aria-label={title}>
      <button type="button" aria-expanded={s.open} onClick={() => toggle(section)} className={cn(row, 'px-1.5 font-semibold')}>
        {s.open ? <ChevronDown className="size-icon-sm shrink-0 text-text-muted" aria-hidden /> : <ChevronRight className="size-icon-sm shrink-0 text-text-muted" aria-hidden />}
        <span className="truncate text-text">{title}</span>
        {s.data && <span className="text-xs font-normal text-text-muted">{s.data.length}</span>}
        {s.loading && <Spinner label={t('Carregando {section}', { section: title })} />}
      </button>
      {s.open && (
        <div>
          {s.error ? (
            <div className="flex items-center gap-2 py-1 pl-7 pr-3">
              <span className="min-w-0 flex-1 text-xs text-danger">{s.error}</span>
              <Button size="sm" onPress={() => void load(section)}>
                {t('Tentar de novo')}
              </Button>
            </div>
          ) : s.data && s.data.length === 0 ? (
            <p className="py-0.5 pl-7 text-xs text-text-muted">{t('Nenhum pull request.')}</p>
          ) : (
            s.data?.map((pr) => <PullNode key={pr.number} pr={pr} depth={1} />)
          )}
        </div>
      )}
    </section>
  )
}

function PullNode({ pr, depth }: { pr: PullRequest; depth: number }) {
  const open = usePullRequests((s) => !!s.expanded[pr.number])
  const files = usePullRequests((s) => s.files[pr.number])
  const drafts = usePullRequests((s) => s.drafts[pr.number]?.length ?? 0)
  const { togglePull, openOverview, openFile, loadFiles } = usePullRequests.getState()
  const pad = { paddingLeft: `${0.375 + depth * 1}rem` }
  const childPad = { paddingLeft: `${0.375 + (depth + 1) * 1 + 1.25}rem` }
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`#${pr.number} ${pr.title}`}
        onClick={() => togglePull(pr.number)}
        onDoubleClick={() => openOverview(pr)}
        title={t('#{n} {title} · {author} · atualizado {when}', { n: pr.number, title: pr.title, author: pr.author.login, when: when(pr.updatedAt) })}
        className={cn(row, 'pr-3')}
        style={pad}
      >
        {open ? <ChevronDown className="size-icon-sm shrink-0 text-text-muted" aria-hidden /> : <ChevronRight className="size-icon-sm shrink-0 text-text-muted" aria-hidden />}
        <PrIcon pr={pr} />
        <span className="min-w-0 flex-1 truncate text-text">
          <span className="text-text-muted">#{pr.number}</span> {pr.title}
        </span>
        {drafts > 0 && <Badge tone="warning">{tn(drafts, '{n} pendente', '{n} pendentes')}</Badge>}
        {pr.comments > 0 && (
          <span className="flex shrink-0 items-center gap-0.5 text-2xs text-text-muted" aria-label={tn(pr.comments, '{n} comentário', '{n} comentários')}>
            <MessageSquare className="size-3" aria-hidden />
            {pr.comments}
          </span>
        )}
        <span className="shrink-0 text-2xs text-text-muted">{pr.author.login}</span>
      </button>
      {open && (
        <div aria-label={t('Conteúdo de #{n}', { n: pr.number })} role="group">
          <button type="button" onClick={() => openOverview(pr)} className={cn(row, 'pr-3')} style={childPad}>
            <FileText className="size-icon-sm shrink-0 text-accent-text" aria-hidden />
            <span className="text-text">{t('Descrição')}</span>
          </button>
          {files?.loading && !files.data ? (
            <div className="py-0.5" style={childPad}>
              <Spinner label={t('Buscando o pull request no repositório')} />
            </div>
          ) : files?.error ? (
            <div className="flex items-center gap-2 py-0.5 pr-3" style={childPad}>
              <span className="min-w-0 flex-1 text-xs text-danger">{files.error}</span>
              <Button size="sm" onPress={() => void loadFiles(pr.number)}>
                {t('Tentar de novo')}
              </Button>
            </div>
          ) : (
            files?.data?.files.map((f) => {
              const name = f.path.split('/').pop()!
              const dir = f.path.slice(0, -name.length - 1)
              return (
                <button
                  key={f.path}
                  type="button"
                  disabled={f.outside}
                  onClick={() => openFile(pr.number, f)}
                  aria-label={t('{path}, abrir o diff', { path: f.path })}
                  className={cn(row, 'pr-3 disabled:text-text-subtle')}
                  style={childPad}
                >
                  <span className={cn('w-3 shrink-0 font-mono text-xs', kindColor[f.kind])} aria-hidden>
                    {f.kind[0].toUpperCase()}
                  </span>
                  <span className="truncate text-text">{name}</span>
                  {dir && <span className="truncate text-xs text-text-muted">{dir}</span>}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

const kindColor: Record<string, string> = { added: 'text-vcs-added', modified: 'text-vcs-modified', deleted: 'text-vcs-deleted', renamed: 'text-vcs-modified' }
