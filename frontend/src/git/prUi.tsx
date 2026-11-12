// Peças comuns da janela Pull requests, da visão geral e dos comentários no diff: ícone de situação, ícone dos
// checks, Markdown do GitHub e data.
import { useMemo } from 'react'
import { CheckCircle2, CircleSlash, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, Loader2, XCircle } from 'lucide-react'
import type { PrChecks, PullRequest } from '../lib/api'
import { cn } from '../design/cn'
import { renderMarkdown } from '../editor/MarkdownPreview'
import { openUrl } from '../lib/openUrl'
import { formatDate } from '../panels/GitLogPanel'
import { usePullRequests } from './pullRequests'
import { t } from '../i18n'

export const when = (iso: string) => (iso ? formatDate(Date.parse(iso)) : '')

export const stateLabel = (pr: Pick<PullRequest, 'state' | 'draft'>) =>
  pr.state === 'merged' ? t('Merged') : pr.state === 'closed' ? t('Fechado') : pr.draft ? t('Rascunho') : t('Aberto')

/** Ícone do pull request pela situação, nas cores do GitHub. */
export function PrIcon({ pr, className }: { pr: Pick<PullRequest, 'state' | 'draft'>; className?: string }) {
  const c = cn('size-icon-sm shrink-0', className)
  if (pr.state === 'merged') return <GitMerge className={cn(c, 'text-accent-text')} aria-label={stateLabel(pr)} />
  if (pr.state === 'closed') return <GitPullRequestClosed className={cn(c, 'text-danger')} aria-label={stateLabel(pr)} />
  if (pr.draft) return <GitPullRequestDraft className={cn(c, 'text-text-muted')} aria-label={stateLabel(pr)} />
  return <GitPullRequest className={cn(c, 'text-success')} aria-label={stateLabel(pr)} />
}

export const checksText = (c: PrChecks) =>
  c.state === 'success'
    ? t('Todos os checks passaram')
    : c.state === 'failure'
      ? t('{n} de {total} checks falharam', { n: c.failed, total: c.runs.length })
      : c.state === 'pending'
        ? t('{n} checks em andamento', { n: c.pending })
        : t('Sem checks')

/** Ícone de um check (ou do resumo, com state). */
export function CheckIcon({ status, conclusion }: { status: string; conclusion: string }) {
  const c = 'size-icon-sm shrink-0'
  if (status !== 'completed') return <Loader2 className={cn(c, 'animate-spin text-warning')} aria-label={t('em andamento')} />
  if (conclusion === 'success' || conclusion === 'neutral') return <CheckCircle2 className={cn(c, 'text-success')} aria-label={t('passou')} />
  if (conclusion === 'skipped' || conclusion === 'cancelled') return <CircleSlash className={cn(c, 'text-text-muted')} aria-label={t('pulado ou cancelado')} />
  return <XCircle className={cn(c, 'text-danger')} aria-label={t('falhou')} />
}

/** Markdown do GitHub, sanitizado; links abrem no navegador (os relativos, no repositório). */
export function GhMarkdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  const base = usePullRequests((s) => s.ctx?.repo?.htmlUrl)
  return (
    <div
      className={cn('prumo-md prumo-md-compact text-sm text-text', className)}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a')
        if (!a) return
        e.preventDefault()
        const href = a.getAttribute('href') ?? ''
        if (/^https?:\/\//i.test(href)) return openUrl(href)
        if (!base || href.startsWith('#')) return
        openUrl(href.startsWith('/') ? new URL(base).origin + href : `${base}/${href}`)
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
