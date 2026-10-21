// S10 Problemas: diagnósticos que o gopls publicou, por arquivo. Filtros por gravidade e "só o arquivo atual";
// Enter abre no lugar, Alt+Enter (ou o botão) abre e já mostra as correções rápidas do gopls.
import { useState } from 'react'
import { AlertCircle, AlertTriangle, FileCode2, Info, Lightbulb } from 'lucide-react'
import { EmptyState } from '../design/feedback'
import { IconButton } from '../design/controls'
import { ToolWindowFrame } from '../shell/ToolWindows'
import { useDiagnostics } from '../editor/lsp/adapter'
import { useDocs } from '../editor/docs'
import { currentEditor } from '../editor/EditorArea'
import { useApp } from '../state/app'
import { cn } from '../design/cn'
import { runAction } from '../editor/runAction'
import { t } from '../i18n'

const isError = (s?: number) => (s ?? 1) === 1

export function ProblemsPanel() {
  const byUri = useDiagnostics((s) => s.byUri)
  const openUri = useDocs((s) => s.openUri)
  const activeKey = useDocs((s) => s.active)
  const root = useApp((s) => s.project?.rootPath ?? '')
  const [errors, setErrors] = useState(true)
  const [warnings, setWarnings] = useState(true)
  const [onlyCurrent, setOnlyCurrent] = useState(false)

  const all = Object.entries(byUri).sort(([a], [b]) => a.localeCompare(b))
  const pathOf = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, '')).replace(root + '/', '')
  const counts = { e: 0, w: 0 }
  for (const [, ds] of all) for (const d of ds) isError(d.severity) ? counts.e++ : counts.w++
  const entries = all
    .filter(([uri]) => !onlyCurrent || pathOf(uri) === activeKey)
    .map(([uri, ds]) => [uri, ds.filter((d) => (isError(d.severity) ? errors : warnings))] as const)
    .filter(([, ds]) => ds.length > 0)

  const open = (uri: string, line: number, col: number) => openUri(uri, line + 1, col + 1)
  // Abre no lugar e pede as correções do gopls (o mesmo do Alt+Enter no editor).
  const fix = async (uri: string, line: number, col: number) => {
    await open(uri, line, col)
    setTimeout(() => {
      const ed = currentEditor()
      ed?.focus()
      ed?.setPosition({ lineNumber: line + 1, column: col + 1 })
      runAction(ed, 'editor.action.quickFix')
    }, 120)
  }

  const actions = (
    <>
      <IconButton label={t('Erros ({n})', { n: counts.e })} size="sm" toggled={errors} icon={<AlertCircle className="size-icon-sm text-danger" />} onPress={() => setErrors(!errors)} />
      <IconButton label={t('Avisos ({n})', { n: counts.w })} size="sm" toggled={warnings} icon={<AlertTriangle className="size-icon-sm text-warning" />} onPress={() => setWarnings(!warnings)} />
      <IconButton label={t('Só o arquivo atual')} size="sm" toggled={onlyCurrent} icon={<FileCode2 className="size-icon-sm" />} onPress={() => setOnlyCurrent(!onlyCurrent)} />
    </>
  )

  return (
    <ToolWindowFrame actions={actions}>
      {entries.length === 0 ? (
        <EmptyState title={all.length ? t('Nada com esses filtros') : t('Nenhum problema encontrado')}>
          {all.length ? t('Ligue os filtros de erros e avisos ou tire o "só o arquivo atual".') : t('O gopls analisa os pacotes dos arquivos abertos.')}
        </EmptyState>
      ) : (
        <ul className="py-1" aria-label={t('Problemas por arquivo')}>
          {entries.map(([uri, diags]) => (
            <li key={uri}>
              <div className="flex h-row items-center gap-2 px-3 text-sm font-semibold text-text">
                {pathOf(uri)}
                <span className="text-xs font-normal text-text-muted">{diags.length}</span>
              </div>
              <ul>
                {diags.map((d, i) => {
                  const { line, character } = d.range.start
                  return (
                    <li key={i} className="group flex items-center pr-2 hover:bg-hover">
                      <button
                        onClick={() => open(uri, line, character)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && e.altKey) {
                            e.preventDefault()
                            void fix(uri, line, character)
                          }
                        }}
                        aria-label={t('{kind}: {message}, linha {line}', { kind: isError(d.severity) ? t('Erro') : t('Aviso'), message: d.message, line: line + 1 })}
                        className="flex h-row min-w-0 flex-1 items-center gap-2 pl-8 pr-2 text-left text-sm focus-visible:bg-selection focus-visible:outline-none"
                      >
                        {isError(d.severity) ? (
                          <AlertCircle className="size-icon-sm shrink-0 text-danger" aria-hidden />
                        ) : d.severity === 2 ? (
                          <AlertTriangle className="size-icon-sm shrink-0 text-warning" aria-hidden />
                        ) : (
                          <Info className="size-icon-sm shrink-0 text-accent-text" aria-hidden />
                        )}
                        <span className="truncate text-text">{d.message}</span>
                        <span className="shrink-0 text-xs text-text-muted">
                          {line + 1}:{character + 1}
                        </span>
                      </button>
                      <span className={cn('opacity-0 group-hover:opacity-100 group-focus-within:opacity-100')}>
                        <IconButton label={t('Corrigir…')} shortcut="Alt+Enter" size="sm" icon={<Lightbulb className="size-icon-sm text-warning" />} onPress={() => void fix(uri, line, character)} />
                      </span>
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </ToolWindowFrame>
  )
}
