// S30 Notificações: o histórico dos avisos da sessão, o mais novo primeiro. Abrir a janela marca como vistos.
import { useEffect } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Trash2 } from 'lucide-react'
import { useToasts, type Notification } from '../design/feedback'
import { ToolWindowFrame } from '../shell/ToolWindows'
import { IconButton } from '../design/controls'
import { EmptyState } from '../design/feedback'
import { lang, t } from '../i18n'

const icon: Record<Notification['level'], React.ReactNode> = {
  info: <Info className="size-icon-sm shrink-0 text-accent-text" aria-label={t('informação')} />,
  success: <CheckCircle2 className="size-icon-sm shrink-0 text-success" aria-label={t('sucesso')} />,
  warning: <AlertTriangle className="size-icon-sm shrink-0 text-warning" aria-label={t('aviso')} />,
  danger: <AlertCircle className="size-icon-sm shrink-0 text-danger" aria-label={t('erro')} />,
}
const timeFmt = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export function NotificationsPanel() {
  const { history, markRead, clearHistory } = useToasts()
  // Enquanto a janela está aberta, o que chega já é visto.
  useEffect(() => {
    markRead()
  }, [history, markRead])
  return (
    <ToolWindowFrame actions={history.length ? <IconButton label={t('Limpar notificações')} size="sm" icon={<Trash2 className="size-icon-sm" />} onPress={clearHistory} /> : null}>
      {history.length === 0 ? (
        <EmptyState title={t('Nenhuma notificação')}>{t('Os avisos da sessão (commits, erros, execuções) ficam guardados aqui.')}</EmptyState>
      ) : (
        <ul aria-label={t('Notificações')} className="flex flex-col">
          {history.map((n) => (
            <li key={n.id} className="flex gap-2 border-b border-border px-3 py-2">
              {icon[n.level]}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 text-sm font-semibold text-text">{n.title}</span>
                  <time className="shrink-0 text-2xs tabular-nums text-text-muted" dateTime={new Date(n.at).toISOString()}>
                    {timeFmt.format(n.at)}
                  </time>
                </div>
                {n.body && <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-text-muted">{n.body}</p>}
                {n.action && (
                  <button type="button" onClick={n.action.run} className="mt-1 text-xs text-accent-text underline underline-offset-2 hover:text-text">
                    {n.action.label}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </ToolWindowFrame>
  )
}
