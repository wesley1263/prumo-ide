// S17 Breakpoints: todos os do projeto, com ligar/desligar, condição, mensagem de log (sem parar), silenciar todos e
// "parar em qualquer panic". As mudanças valem na hora, inclusive numa depuração em andamento.
import { useEffect, useState } from 'react'
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { CircleDot, FileCode2, Trash2, Zap } from 'lucide-react'
import { useDebug } from '../state/debug'
import { useDocs } from '../editor/docs'
import type { Breakpoint } from '../lib/api'
import { Button, Checkbox, IconButton } from '../design/controls'
import { EmptyState } from '../design/feedback'
import { cn } from '../design/cn'
import { t } from '../i18n'

const inputCls =
  'h-control w-full rounded-md border border-border-input bg-bg px-2 font-mono text-sm text-text placeholder:text-text-muted outline-none focus:border-focus focus:ring-2 focus:ring-focus'

export function BreakpointsDialog() {
  const dialog = useDebug((s) => s.dialog)
  const close = useDebug((s) => s.closeDialog)
  return (
    <ModalOverlay isOpen={!!dialog} onOpenChange={(o) => !o && close()} isDismissable className="fixed inset-0 z-dialog flex items-center justify-center bg-overlay p-4">
      <Modal className="max-h-full max-w-full outline-none">
        <AriaDialog aria-labelledby="bp-title" className="flex h-[min(80vh,560px)] w-dialog-lg max-w-full flex-col overflow-hidden rounded-lg bg-surface shadow-dialog outline-none">
          {dialog && <Body focus={dialog.focus} close={close} />}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  )
}

function Body({ focus, close }: { focus: string | null; close: () => void }) {
  const { breakpoints, muted, setMuted, setPanic, update, remove } = useDebug()
  const lines = breakpoints.filter((b) => b.kind === 'line')
  const panic = breakpoints.find((b) => b.kind === 'panic')
  const [selected, setSelected] = useState<string | null>(focus ?? lines[0]?.id ?? null)
  const current = lines.find((b) => b.id === selected)
  useEffect(() => {
    if (selected && !lines.some((b) => b.id === selected)) setSelected(lines[0]?.id ?? null)
  }, [lines, selected])

  return (
    <>
      <div className="flex min-h-0 flex-1">
        <nav aria-label={t('Lista de breakpoints')} className="flex w-settings-nav-width shrink-0 flex-col border-r border-border bg-chrome">
          <Heading id="bp-title" slot="title" className="px-3 pb-1 pt-3 text-md text-text">
            Breakpoints
          </Heading>
          <div className="flex flex-col gap-1 border-b border-border px-3 pb-2">
            <Checkbox isSelected={muted} onChange={(v) => void setMuted(v)}>
              {t('Silenciar todos')}
            </Checkbox>
            <Checkbox isSelected={!!panic?.enabled} onChange={(v) => void setPanic(v)}>
              <Zap className="size-icon-sm text-warning" aria-hidden /> {t('Parar em qualquer panic')}
            </Checkbox>
          </div>
          <ul role="listbox" aria-label={t('Breakpoints de linha')} className="min-h-0 flex-1 overflow-y-auto py-1">
            {lines.map((b) => (
              <li
                key={b.id}
                role="option"
                tabIndex={0}
                aria-selected={b.id === selected}
                aria-label={`${b.filePath}:${b.line}${b.enabled ? '' : t(', desligado')}${b.condition ? t(', com condição') : ''}${b.logMessage ? t(', com log') : ''}`}
                onClick={() => setSelected(b.id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSelected(b.id)}
                className={cn(
                  'flex h-row cursor-default items-center gap-2 px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-focus',
                  b.id === selected ? 'bg-selection text-text' : 'text-text hover:bg-hover',
                )}
              >
                <CircleDot className={cn('size-icon-sm shrink-0', b.enabled && !muted ? 'text-breakpoint' : 'text-text-muted')} aria-hidden />
                <span className={cn('truncate', !b.enabled && 'text-text-muted line-through')}>
                  {b.filePath?.split('/').pop()}:{b.line}
                </span>
                {(b.condition || b.logMessage) && <span className="ml-auto shrink-0 text-2xs text-text-muted">{b.logMessage ? 'log' : t('se')}</span>}
              </li>
            ))}
            {lines.length === 0 && <li className="px-3 py-2 text-xs text-text-muted">{t('Nenhum breakpoint de linha. Clique no número de uma linha para pôr um.')}</li>}
          </ul>
        </nav>
        <section aria-label={t('Detalhes do breakpoint')} className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
          {current ? <Details key={current.id} bp={current} update={update} remove={remove} close={close} muted={muted} /> : <EmptyState title={t('Escolha um breakpoint')}>{t('Ou use as opções à esquerda.')}</EmptyState>}
        </section>
      </div>
      <div className="flex justify-end border-t border-border px-4 py-3">
        <Button variant="primary" onPress={close}>
          {t('Pronto')}
        </Button>
      </div>
    </>
  )
}

function Details({ bp, update, remove, close, muted }: { bp: Breakpoint; update: (b: Breakpoint) => Promise<void>; remove: (id: string) => Promise<void>; close: () => void; muted: boolean }) {
  const [condition, setCondition] = useState(bp.condition ?? '')
  const [logOn, setLogOn] = useState(!!bp.logMessage)
  const [log, setLog] = useState(bp.logMessage ?? '')
  // Grava com uma pausa curta enquanto digita (vale na hora, inclusive na depuração em andamento).
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = { ...bp, condition: condition.trim() || null, logMessage: logOn && log.trim() ? log : null }
      if (next.condition !== bp.condition || next.logMessage !== bp.logMessage) void update(next)
    }, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condition, log, logOn])
  const go = () => {
    close()
    void useDocs.getState().open(bp.filePath!, { line: bp.line!, preview: false })
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <FileCode2 className="size-icon-sm text-accent-text" aria-hidden />
        <h3 className="flex-1 truncate font-mono text-sm text-text">
          {bp.filePath}:{bp.line}
        </h3>
        <Button size="sm" onPress={go}>
          {t('Ir para o código')}
        </Button>
        <IconButton label={t('Remover o breakpoint')} size="sm" icon={<Trash2 className="size-icon-sm" />} onPress={() => void remove(bp.id)} />
      </div>
      {muted && <p className="text-xs text-warning">{t('Todos os breakpoints estão silenciados: nenhum para o programa até tirar o silêncio.')}</p>}
      <Checkbox isSelected={bp.enabled} onChange={(v) => void update({ ...bp, enabled: v })}>
        {t('Ligado')}
      </Checkbox>
      <label className="flex flex-col gap-1 text-sm text-text">
        {t('Condição')}
        <input aria-label={t('Condição')} value={condition} onChange={(e) => setCondition(e.target.value)} placeholder={t('ex.: it.Price > 5000')} spellCheck={false} className={inputCls} />
        <span className="text-xs text-text-muted">{t('Expressão Go; só para quando for verdadeira. Vazio = sempre.')}</span>
      </label>
      <div className="flex flex-col gap-1 text-sm text-text">
        <Checkbox isSelected={logOn} onChange={setLogOn}>
          {t('Registrar uma mensagem no console (sem parar)')}
        </Checkbox>
        {logOn && (
          <>
            <input aria-label={t('Mensagem de log')} value={log} onChange={(e) => setLog(e.target.value)} placeholder={t('ex.: item {it.Name} custa {it.Price}')} spellCheck={false} className={inputCls} />
            <span className="text-xs text-text-muted">{t('Expressões entre chaves são avaliadas. Com mensagem, o programa não para nesta linha.')}</span>
          </>
        )}
      </div>
    </div>
  )
}
