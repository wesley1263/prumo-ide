// Shift+F11: todos os bookmarks do projeto (Enter vai, Delete apaga, descrição editável); Ctrl+F11: escolher o mnemônico.
import { useEffect, useState } from 'react'
import { Dialog as AriaDialog, Modal, ModalOverlay } from 'react-aria-components'
import { monaco } from './monaco'
import { useDocs } from './docs'
import { MNEMONICS, describeBookmark, goToBookmark, removeBookmark, setMnemonic, useBookmarks } from './bookmarks'
import { Dialog } from '../design/feedback'
import { Button } from '../design/controls'
import { cn } from '../design/cn'
import { t } from '../i18n'

export function BookmarksDialog() {
  const open = useBookmarks((s) => s.dialog)
  const list = useBookmarks((s) => s.list)
  const [active, setActive] = useState(0)
  const [editing, setEditing] = useState<number | null>(null)
  useEffect(() => {
    setActive(0)
    setEditing(null)
  }, [open])
  useEffect(() => setActive((a) => Math.min(a, Math.max(0, list.length - 1))), [list.length])
  const close = () => useBookmarks.setState({ dialog: false })
  const root = useDocs.getState().root
  const preview = (key: string, line: number) => {
    const m = monaco.editor.getModel(monaco.Uri.file(root + '/' + key))
    return m && line <= m.getLineCount() ? m.getLineContent(line).trim() : ''
  }
  // Com mnemônico primeiro (na ordem 1…0, A…Z), depois por arquivo e linha.
  const rank = (m?: string) => (m ? MNEMONICS.indexOf(m) : MNEMONICS.length)
  const sorted = [...list].sort((a, b) => rank(a.mnemonic) - rank(b.mnemonic) || a.key.localeCompare(b.key) || a.line - b.line)
  const pick = (i: number) => {
    const b = sorted[i]
    close()
    if (b) setTimeout(() => goToBookmark(b), 0)
  }
  return (
    <ModalOverlay isOpen={open} onOpenChange={(o) => !o && close()} isDismissable className="fixed inset-0 z-popup flex justify-center pt-[15vh]">
      <Modal className="h-fit outline-none">
        <AriaDialog aria-label="Bookmarks" className="flex max-h-popup-search-max-height w-popup-search-width max-w-full flex-col overflow-hidden rounded-lg border border-border bg-surface-raised shadow-pop outline-none">
          <div className="flex items-center border-b border-border px-3 py-2 text-sm font-semibold text-text">
            <span className="flex-1">Bookmarks</span>
            <span className="text-xs font-normal text-text-muted">{t('Enter vai · Delete apaga · F2 descreve')}</span>
          </div>
          <ul
            role="listbox"
            aria-label={t('Bookmarks do projeto')}
            tabIndex={0}
            autoFocus
            aria-activedescendant={sorted[active] ? `bm-${active}` : undefined}
            onKeyDown={(e) => {
              if (editing !== null) return
              if (e.key === 'ArrowDown') setActive((a) => Math.min(sorted.length - 1, a + 1))
              else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1))
              else if (e.key === 'Enter') pick(active)
              else if (e.key === 'Delete' && sorted[active]) removeBookmark(sorted[active])
              else if (e.key === 'F2' && sorted[active]) setEditing(active)
              else return
              e.preventDefault()
            }}
            className="min-h-0 flex-1 overflow-y-auto py-1 outline-none"
          >
            {sorted.map((b, i) => (
              <li
                key={`${b.key}:${b.line}`}
                id={`bm-${i}`}
                role="option"
                aria-selected={i === active}
                aria-label={`${b.mnemonic ? b.mnemonic + ': ' : ''}${t('{file} linha {line}', { file: b.key, line: b.line })}${b.description ? ', ' + b.description : ''}`}
                onClick={() => editing === null && pick(i)}
                onMouseMove={() => setActive(i)}
                className={cn('mx-1 flex cursor-default items-center gap-2 rounded-sm px-2 py-1', i === active && 'bg-selection')}
              >
                <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-xs bg-accent text-2xs font-semibold text-on-accent">
                  {b.mnemonic ?? ''}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm text-text">
                    {b.key.split('/').pop()} <span className="text-xs text-text-muted">{b.key.includes('/') ? b.key.slice(0, b.key.lastIndexOf('/')) : ''} · {t('linha {line}', { line: b.line })}</span>
                  </span>
                  {editing === i ? (
                    <input
                      aria-label={t('Descrição do bookmark')}
                      autoFocus
                      defaultValue={b.description ?? ''}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === 'Enter') {
                          describeBookmark(b, e.currentTarget.value.trim())
                          setEditing(null)
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          setEditing(null)
                        }
                      }}
                      className="h-control rounded-sm border border-border-input bg-bg px-1 text-sm text-text outline-none focus:border-focus"
                    />
                  ) : (
                    <span className="truncate font-mono text-xs text-text-muted">{b.description ? <span className="font-sans text-text">{b.description} · </span> : null}{preview(b.key, b.line)}</span>
                  )}
                </span>
              </li>
            ))}
            {sorted.length === 0 && <li className="px-3 py-2 text-sm text-text-muted">{t('Nenhum bookmark. F11 marca a linha do cursor; Ctrl+F11 marca com um número ou letra.')}</li>}
          </ul>
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  )
}

export function MnemonicDialog() {
  const at = useBookmarks((s) => s.mnemonicFor)
  const list = useBookmarks((s) => s.list)
  const close = () => useBookmarks.setState({ mnemonicFor: null })
  const choose = (m: string) => {
    if (at) setMnemonic(at, m)
    close()
  }
  const used = new Map(list.filter((b) => b.mnemonic).map((b) => [b.mnemonic!, b]))
  const mine = at && list.find((b) => b.key === at.key && b.line === at.line)?.mnemonic
  return (
    <Dialog
      title={t('Bookmark com mnemônico')}
      isOpen={!!at}
      onOpenChange={(o) => !o && close()}
      footer={
        <>
          {mine && <Button onPress={() => choose('')}>{t('Tirar o mnemônico')}</Button>}
          <Button onPress={close}>{t('Cancelar')}</Button>
        </>
      }
    >
      <p className="mb-2 text-sm text-text-muted">{t('Aperte um número ou uma letra. Ctrl+número volta aqui depois.')}</p>
      <div
        role="group"
        aria-label={t('Mnemônicos')}
        className="grid grid-cols-10 gap-1"
        onKeyDown={(e) => {
          const k = e.key.toUpperCase()
          if (k.length === 1 && MNEMONICS.includes(k) && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault()
            choose(k)
          }
        }}
      >
        {MNEMONICS.map((m, i) => (
          <Button key={m} size="sm" variant={m === mine ? 'primary' : 'secondary'} autoFocus={i === 0} onPress={() => choose(m)} aria-label={`${m}${used.has(m) && m !== mine ? t(', em uso') : ''}`}>
            <span className={cn(used.has(m) && m !== mine && 'text-text-muted line-through')}>{m}</span>
          </Button>
        ))}
      </div>
    </Dialog>
  )
}
