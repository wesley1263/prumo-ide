// Menu de contexto aberto numa posição (clique direito). Teclado: setas, Home/End, Enter, Esc.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from './cn'
import { Kbd, type MenuAction } from './controls'

export function ContextMenu({ x, y, items, label, onAction, onClose }: { x: number; y: number; items: MenuAction[]; label: string; onAction: (id: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const enabled = items.filter((i) => !i.disabled)
  const [focus, setFocus] = useState(enabled[0]?.id)
  const [pos, setPos] = useState({ x, y })

  useEffect(() => {
    ref.current?.focus()
    // Não deixa o menu sair da janela.
    const r = ref.current?.getBoundingClientRect()
    if (r) setPos({ x: Math.min(x, window.innerWidth - r.width - 4), y: Math.min(y, window.innerHeight - r.height - 4) })
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose()
    window.addEventListener('mousedown', away, true)
    return () => window.removeEventListener('mousedown', away, true)
  }, [x, y, onClose])

  const pick = (id: string) => {
    onClose()
    onAction(id)
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = enabled.findIndex((it) => it.id === focus)
    if (e.key === 'ArrowDown') setFocus(enabled[(i + 1) % enabled.length]?.id)
    else if (e.key === 'ArrowUp') setFocus(enabled[(i - 1 + enabled.length) % enabled.length]?.id)
    else if (e.key === 'Home') setFocus(enabled[0]?.id)
    else if (e.key === 'End') setFocus(enabled[enabled.length - 1]?.id)
    else if (e.key === 'Enter' && focus) pick(focus)
    else if (e.key === 'Escape') onClose()
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      aria-activedescendant={focus ? `ctx-${focus}` : undefined}
      onKeyDown={onKeyDown}
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-popup min-w-menu-min rounded-md border border-border bg-surface-raised py-1 shadow-pop outline-none"
    >
      {items.map((it) => (
        <div key={it.id}>
          {it.separatorBefore && <div role="separator" className="my-1 border-t border-border" />}
          <div
            id={`ctx-${it.id}`}
            role="menuitem"
            aria-disabled={it.disabled || undefined}
            onMouseEnter={() => !it.disabled && setFocus(it.id)}
            onClick={() => !it.disabled && pick(it.id)}
            className={cn(
              'mx-1 flex h-row cursor-default items-center gap-2 rounded-sm px-2 text-sm',
              it.disabled ? 'text-text-subtle' : it.danger ? 'text-danger' : 'text-text',
              focus === it.id && 'bg-selection',
            )}
          >
            <span className="flex size-icon items-center justify-center text-text-muted">{it.icon}</span>
            <span className="flex-1">{it.label}</span>
            {it.shortcut && <Kbd>{it.shortcut}</Kbd>}
          </div>
        </div>
      ))}
    </div>,
    document.body,
  )
}
