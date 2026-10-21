// Barra de status: caminho do arquivo, estado do gopls, problemas, cursor e formato do arquivo.
import { AlertCircle, AlertTriangle, ChevronRight, GitBranch } from 'lucide-react'
import { Button as AriaButton } from 'react-aria-components'
import { useApp } from '../state/app'
import { useDocs } from '../editor/docs'
import { useCursor } from '../editor/EditorArea'
import { useDiagnostics, useLsp } from '../editor/lsp/adapter'
import { useLayout } from './layout'
import { ProgressBar } from '../design/feedback'
import { useSymbolPath } from '../editor/structure'
import { cn } from '../design/cn'
import { t } from '../i18n'

const item = 'inline-flex h-full items-center gap-1 px-1.5 text-xs text-text-muted outline-none data-[hovered]:bg-hover data-[hovered]:text-text data-[focus-visible]:ring-1 data-[focus-visible]:ring-inset data-[focus-visible]:ring-focus'

export function StatusBar() {
  const project = useApp((s) => s.project)!
  const git = useApp((s) => s.git)
  const sdk = useApp((s) => s.boot?.sdks.find((x) => x.isDefault))
  const active = useDocs((s) => s.active)
  const doc = useDocs((s) => (s.active ? s.docs[s.active] : undefined))
  const cursor = useCursor()
  const symbols = useSymbolPath()
  const counts = useDiagnostics((s) => s.counts)
  const lsp = useLsp()

  const crumbs = doc ? doc.key.replace(/^ext:/, '').split('/') : active?.startsWith('diff:') ? [active.slice(5)] : []
  const lspText =
    !project.trusted ? t('Modo restrito')
    : lsp.state === 'ready' ? t('gopls pronto')
    : lsp.state === 'connecting' ? t('gopls iniciando')
    : lsp.state === 'error' ? t('gopls indisponível')
    : t('gopls desconectado')

  return (
    <footer role="contentinfo" className="flex h-status-bar shrink-0 items-stretch border-t border-border bg-chrome pl-2 pr-1">
      <nav aria-label={t('Localização do arquivo')} className="flex min-w-0 flex-1 items-center gap-0.5 text-xs text-text-muted">
        <span className="truncate">{project.name}</span>
        {crumbs.map((c, i) => (
          <span key={i} className="flex min-w-0 items-center gap-0.5">
            <ChevronRight className="size-3 shrink-0" aria-hidden />
            <span className={cn('truncate', i === crumbs.length - 1 && !symbols.length && 'text-text')}>{c}</span>
          </span>
        ))}
        {/* Onde o cursor está no código (breadcrumbs): tipo › método. */}
        {symbols.map((s, i) => (
          <span key={'s' + i} className="flex min-w-0 items-center gap-0.5">
            <ChevronRight className="size-3 shrink-0" aria-hidden />
            <span className={cn('truncate font-mono', i === symbols.length - 1 && 'text-text')}>{s.name}</span>
          </span>
        ))}
      </nav>
      <div role="status" aria-live="polite" className={cn('flex items-center gap-1.5 px-1.5 text-xs', lsp.state === 'error' ? 'text-danger' : 'text-text-muted')} title={lsp.message || undefined}>
        {project.trusted && lsp.state === 'connecting' && <ProgressBar label={t('gopls iniciando')} />}
        {lspText}
      </div>
      <AriaButton className={item} aria-label={t('{errors} erros e {warnings} avisos', { errors: counts.errors, warnings: counts.warnings })} onPress={() => useLayout.getState().show('problems')}>
        <AlertCircle className={cn('size-3', counts.errors ? 'text-danger' : '')} aria-hidden />
        {counts.errors}
        <AlertTriangle className={cn('ml-1 size-3', counts.warnings ? 'text-warning' : '')} aria-hidden />
        {counts.warnings}
      </AriaButton>
      {doc && (
        <>
          <span className={cn(item, 'pointer-events-none')} aria-label={t('Linha {line}, coluna {col}', { line: cursor.line, col: cursor.col })}>
            {cursor.line}:{cursor.col}
            {cursor.selected > 0 && ' ' + t('({n} car.)', { n: cursor.selected })}
          </span>
          <span className={cn(item, 'pointer-events-none')}>{doc.lineEnding === '\r\n' ? 'CRLF' : 'LF'}</span>
          <span className={cn(item, 'pointer-events-none')}>UTF-8</span>
          {doc.readOnly && <span className={cn(item, 'pointer-events-none')}>{t('Somente leitura')}</span>}
        </>
      )}
      {sdk && <span className={cn(item, 'pointer-events-none')}>{sdk.version}</span>}
      {git?.isRepo && (
        <AriaButton className={item} onPress={() => useLayout.getState().show('commit')} aria-label={t('Branch {name}', { name: git.branch })}>
          <GitBranch className="size-3" aria-hidden />
          {git.branch || git.head}
        </AriaButton>
      )}
    </footer>
  )
}
