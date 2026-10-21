// Locais recentes (Ctrl+Shift+E): os lugares por onde o cursor passou, com a linha de cada um.
import { useEffect, useState } from 'react'
import { Dialog as AriaDialog, Modal, ModalOverlay } from 'react-aria-components'
import { monaco } from './monaco'
import { useDocs } from './docs'
import { goToLocation, useNav } from './navigation'
import { cn } from '../design/cn'
import { t } from '../i18n'

export function RecentLocations() {
  const open = useNav((s) => s.popup)
  const recent = useNav((s) => s.recent)
  const [active, setActive] = useState(0)
  useEffect(() => setActive(recent.length > 1 ? 1 : 0), [open, recent.length]) // o primeiro é onde se está
  const close = () => useNav.setState({ popup: false })
  const root = useDocs.getState().root
  const preview = (key: string, line: number) => {
    const m = monaco.editor.getModel(monaco.Uri.file(root + '/' + key))
    return m && line <= m.getLineCount() ? m.getLineContent(line).trim() : ''
  }
  const pick = (i: number) => {
    const loc = recent[i]
    close()
    if (loc) setTimeout(() => void goToLocation(loc), 0)
  }
  return (
    <ModalOverlay isOpen={open} onOpenChange={(o) => !o && close()} isDismissable className="fixed inset-0 z-popup flex justify-center pt-[15vh]">
      <Modal className="h-fit outline-none">
        <AriaDialog aria-label={t('Locais recentes')} className="flex max-h-popup-search-max-height w-popup-search-width max-w-full flex-col overflow-hidden rounded-lg border border-border bg-surface-raised shadow-pop outline-none">
          <div className="border-b border-border px-3 py-2 text-sm font-semibold text-text">{t('Locais recentes')}</div>
          <ul
            role="listbox"
            aria-label={t('Locais')}
            tabIndex={0}
            autoFocus
            aria-activedescendant={recent[active] ? `loc-${active}` : undefined}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setActive((a) => Math.min(recent.length - 1, a + 1))
              else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1))
              else if (e.key === 'Enter') pick(active)
              else return
              e.preventDefault()
            }}
            className="min-h-0 flex-1 overflow-y-auto py-1 outline-none"
          >
            {recent.map((r, i) => (
              <li
                key={`${r.key}:${r.line}`}
                id={`loc-${i}`}
                role="option"
                aria-selected={i === active}
                aria-label={t('{file} linha {line}', { file: r.key, line: r.line })}
                onClick={() => pick(i)}
                onMouseMove={() => setActive(i)}
                className={cn('mx-1 flex cursor-default flex-col rounded-sm px-2 py-1', i === active && 'bg-selection')}
              >
                <span className="text-sm text-text">
                  {r.key.split('/').pop()} <span className="text-xs text-text-muted">{r.key.includes('/') ? r.key.slice(0, r.key.lastIndexOf('/')) : ''} · {t('linha {line}', { line: r.line })}</span>
                </span>
                <span className="truncate font-mono text-xs text-text-muted">{preview(r.key, r.line)}</span>
              </li>
            ))}
            {recent.length === 0 && <li className="px-3 py-2 text-sm text-text-muted">{t('Nenhum local ainda.')}</li>}
          </ul>
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  )
}
