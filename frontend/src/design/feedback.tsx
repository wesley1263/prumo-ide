// Primitivas de feedback e estrutura: Dialog, Banner, Toast, Progress, EmptyState, Splitter, Tree.
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Info, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { create } from 'zustand'
import { cn } from './cn'
import { IconButton } from './controls'
import { t } from '../i18n'

// ---------------------------------------------------------------- Dialog

export function Dialog({
  title,
  isOpen,
  onOpenChange,
  size = 'sm',
  children,
  footer,
  dismissable = true,
}: {
  title: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  size?: 'sm' | 'md' | 'lg'
  children: ReactNode
  footer?: ReactNode
  dismissable?: boolean
}) {
  const width = { sm: 'w-dialog-sm', md: 'w-dialog-md', lg: 'w-dialog-lg' }[size]
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable={dismissable}
      className="fixed inset-0 z-dialog flex items-center justify-center bg-overlay p-4"
    >
      <Modal className={cn('max-h-full max-w-full overflow-auto rounded-lg bg-surface shadow-dialog outline-none', width)}>
        <AriaDialog className="flex flex-col outline-none">
          <Heading slot="title" className="px-4 pt-4 text-md text-text">
            {title}
          </Heading>
          <div className="px-4 py-3 text-sm text-text">{children}</div>
          {footer && <div className="flex justify-end gap-2 px-4 pb-4">{footer}</div>}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  )
}

// ---------------------------------------------------------------- Banner

type Level = 'info' | 'warning' | 'danger' | 'success'
const bannerStyle: Record<Level, { box: string; icon: ReactNode }> = {
  info: { box: 'bg-selection', icon: <Info className="size-icon text-accent-text" aria-hidden /> },
  warning: { box: 'bg-warning-bg', icon: <AlertTriangle className="size-icon text-warning" aria-hidden /> },
  danger: { box: 'bg-danger-bg', icon: <AlertCircle className="size-icon text-danger" aria-hidden /> },
  success: { box: 'bg-success-bg', icon: <CheckCircle2 className="size-icon text-success" aria-hidden /> },
}

export function Banner({ level = 'info', children, actions, onClose }: { level?: Level; children: ReactNode; actions?: ReactNode; onClose?: () => void }) {
  const s = bannerStyle[level]
  return (
    <div role={level === 'danger' ? 'alert' : 'status'} className={cn('flex min-h-control items-center gap-2 px-3 py-1 text-sm text-text', s.box)}>
      {s.icon}
      <div className="flex-1">{children}</div>
      {actions}
      {onClose && <IconButton label={t('Fechar')} size="sm" icon={<X className="size-icon-sm" />} onPress={onClose} />}
    </div>
  )
}

// ---------------------------------------------------------------- Toast

interface ToastItem {
  id: number
  level: Level
  title: string
  body?: string
  action?: { label: string; run: () => void }
}
interface ToastStore {
  items: ToastItem[]
  /** S30: todos os avisos da sessão (o mais novo primeiro) e quantos ainda não foram vistos. */
  history: Array<ToastItem & { at: number }>
  unread: number
  push: (t: Omit<ToastItem, 'id'>) => void
  dismiss: (id: number) => void
  markRead: () => void
  clearHistory: () => void
}

export type Notification = ToastStore['history'][number]
export const HISTORY_MAX = 200
let toastSeq = 0
export const useToasts = create<ToastStore>((set, get) => ({
  items: [],
  history: [],
  unread: 0,
  push: (t) => {
    const id = ++toastSeq
    set({
      items: [...get().items.slice(-2), { ...t, id }],
      history: [{ ...t, id, at: Date.now() }, ...get().history].slice(0, HISTORY_MAX),
      unread: get().unread + 1,
    })
    if (t.level !== 'danger') setTimeout(() => get().dismiss(id), 8000)
  },
  dismiss: (id) => set({ items: get().items.filter((i) => i.id !== id) }),
  markRead: () => {
    if (get().unread) set({ unread: 0 })
  },
  clearHistory: () => set({ history: [], unread: 0 }),
}))

/** Atalho para mostrar um balão. Erros ficam até serem fechados. */
export const toast = (level: Level, title: string, body?: string, action?: ToastItem['action']) =>
  useToasts.getState().push({ level, title, body, action })

export function ToastViewport() {
  const { items, dismiss } = useToasts()
  return (
    <div className="pointer-events-none fixed bottom-10 right-4 z-toast flex w-toast-width max-w-full flex-col gap-2">
      {items.map((m) => (
        <div
          key={m.id}
          role={m.level === 'danger' ? 'alert' : 'status'}
          className="pointer-events-auto flex gap-2 rounded-lg border border-border bg-surface-raised p-3 shadow-toast"
        >
          {bannerStyle[m.level].icon}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-text">{m.title}</div>
            {m.body && <div className="mt-0.5 whitespace-pre-wrap break-words text-sm text-text-muted">{m.body}</div>}
            {m.action && (
              <button
                onClick={() => {
                  dismiss(m.id)
                  m.action!.run()
                }}
                className="mt-1 text-sm text-accent-text underline underline-offset-2 hover:text-text"
              >
                {m.action.label}
              </button>
            )}
          </div>
          <IconButton label={t('Fechar')} size="sm" icon={<X className="size-icon-sm" />} onPress={() => dismiss(m.id)} />
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- Progress

export function ProgressBar({ value, label }: { value?: number; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      className="relative h-1 w-progress overflow-hidden rounded-pill bg-hover"
    >
      {value === undefined ? (
        <div className="absolute inset-y-0 w-1/3 animate-[indeterminate_1.2s_ease-in-out_infinite] rounded-pill bg-accent" />
      ) : (
        <div className="h-full rounded-pill bg-accent transition-[width] duration-base" style={{ width: `${value}%` }} />
      )}
    </div>
  )
}

/** Spinner que só aparece depois de 300ms (operações rápidas não piscam). */
/** decorative: dentro de um texto que já é anunciado (role=status) — não cria uma segunda região. */
export function Spinner({ label, decorative }: { label: string; decorative?: boolean }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 300)
    return () => clearTimeout(t)
  }, [])
  if (!show) return null
  const cls = 'inline-block size-icon animate-spin rounded-pill border-2 border-hover border-t-accent-text'
  if (decorative) return <span aria-hidden className={cls} />
  return <span role="status" aria-label={label} className={cls} />
}

// ---------------------------------------------------------------- EmptyState

export function EmptyState({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex h-full min-h-empty-min flex-col items-center justify-center gap-1 p-6 text-center">
      <div className="text-sm font-semibold text-text">{title}</div>
      {children && <div className="max-w-empty-max text-xs text-text-muted">{children}</div>}
      {actions && <div className="mt-2 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- Splitter

/** Divisória arrastável. Setas redimensionam 16px; duplo clique volta ao padrão. */
export function Splitter({
  orientation,
  value,
  min,
  max,
  defaultValue,
  onChange,
  invert = false,
  label,
}: {
  orientation: 'vertical' | 'horizontal' // vertical = divide colunas
  value: number
  min: number
  max: number
  defaultValue: number
  onChange: (v: number) => void
  invert?: boolean // painel à direita/embaixo: arrastar para a esquerda/cima aumenta
  label: string
}) {
  const start = useRef<{ pos: number; value: number } | null>(null)
  const clamp = useCallback((v: number) => Math.max(min, Math.min(max, v)), [min, max])
  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    start.current = { pos: orientation === 'vertical' ? e.clientX : e.clientY, value }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return
    const delta = (orientation === 'vertical' ? e.clientX : e.clientY) - start.current.pos
    onChange(clamp(start.current.value + (invert ? -delta : delta)))
  }
  const onKeyDown = (e: KeyboardEvent) => {
    const grow = orientation === 'vertical' ? (invert ? 'ArrowLeft' : 'ArrowRight') : invert ? 'ArrowUp' : 'ArrowDown'
    const shrink = orientation === 'vertical' ? (invert ? 'ArrowRight' : 'ArrowLeft') : invert ? 'ArrowDown' : 'ArrowUp'
    if (e.key === grow) onChange(clamp(value + 16))
    else if (e.key === shrink) onChange(clamp(value - 16))
    else return
    e.preventDefault()
  }
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (start.current = null)}
      onDoubleClick={() => onChange(defaultValue)}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative z-stripe shrink-0 outline-none',
        orientation === 'vertical' ? 'w-splitter cursor-col-resize' : 'h-splitter cursor-row-resize',
      )}
    >
      <div className={cn('absolute bg-border group-hover:bg-border-strong group-focus-visible:bg-focus', orientation === 'vertical' ? 'inset-y-0 left-0 w-splitter' : 'inset-x-0 top-0 h-splitter')} />
      <div className={cn('absolute', orientation === 'vertical' ? 'inset-y-0 left-[calc((var(--size-splitter)-var(--size-splitter-hit))/2)] w-splitter-hit' : 'inset-x-0 top-[calc((var(--size-splitter)-var(--size-splitter-hit))/2)] h-splitter-hit')} />
    </div>
  )
}

// ---------------------------------------------------------------- TreeView

export interface TreeNode {
  id: string
  label: ReactNode
  textValue: string // speed search e leitor de tela
  icon?: ReactNode
  secondary?: ReactNode
  isLeaf: boolean
  children?: TreeNode[] // undefined = ainda não carregado
  className?: string // ex.: cor do status VCS
}

/**
 * Árvore acessível (role=tree) com navegação por setas, speed search e carregamento sob demanda.
 * Linhas de 24px, indentação de 16px por nível.
 */
export function TreeView({
  label,
  roots,
  expanded,
  onToggle,
  selected,
  onSelect,
  onActivate,
  loading,
}: {
  label: string
  roots: TreeNode[]
  expanded: Set<string>
  onToggle: (node: TreeNode, open: boolean) => void
  selected: string | null
  onSelect: (node: TreeNode) => void
  onActivate: (node: TreeNode) => void
  loading?: Set<string>
}) {
  const flat: Array<{ node: TreeNode; level: number; parent: string | null }> = []
  const walk = (nodes: TreeNode[], level: number, parent: string | null) => {
    for (const n of nodes) {
      flat.push({ node: n, level, parent })
      if (!n.isLeaf && expanded.has(n.id) && n.children) walk(n.children, level + 1, n.id)
    }
  }
  walk(roots, 1, null)
  const [search, setSearch] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const index = flat.findIndex((f) => f.node.id === selected)

  const focusRow = (id: string) => {
    const el = rowRefs.current.get(id)
    el?.focus()
    el?.scrollIntoView({ block: 'nearest' })
  }
  const move = (i: number) => {
    const f = flat[Math.max(0, Math.min(flat.length - 1, i))]
    if (f) {
      onSelect(f.node)
      focusRow(f.node.id)
    }
  }
  const onKeyDown = (e: KeyboardEvent) => {
    const cur = flat[index]
    switch (e.key) {
      case 'ArrowDown':
        move(index + 1)
        break
      case 'ArrowUp':
        move(index - 1)
        break
      case 'Home':
        move(0)
        break
      case 'End':
        move(flat.length - 1)
        break
      case 'ArrowRight':
        if (cur && !cur.node.isLeaf) {
          if (!expanded.has(cur.node.id)) onToggle(cur.node, true)
          else move(index + 1)
        }
        break
      case 'ArrowLeft':
        if (cur && !cur.node.isLeaf && expanded.has(cur.node.id)) onToggle(cur.node, false)
        else if (cur?.parent) move(flat.findIndex((f) => f.node.id === cur.parent))
        break
      case 'Enter':
        if (cur) onActivate(cur.node)
        break
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const q = (search + e.key).toLowerCase()
          setSearch(q)
          clearTimeout(searchTimer.current)
          searchTimer.current = setTimeout(() => setSearch(''), 1200)
          const hit = flat.findIndex((f, i) => i >= Math.max(index, 0) && f.node.textValue.toLowerCase().startsWith(q))
          const any = hit >= 0 ? hit : flat.findIndex((f) => f.node.textValue.toLowerCase().startsWith(q))
          if (any >= 0) move(any)
          break
        }
        return
    }
    e.preventDefault()
  }

  return (
    <div role="tree" aria-label={label} onKeyDown={onKeyDown} className="relative py-1 outline-none">
      {search && (
        <div className="sticky top-0 z-popup ml-2 inline-block rounded-sm bg-search-match-bg px-1.5 text-xs text-text" aria-live="polite">
          {search}
        </div>
      )}
      {flat.map(({ node, level }) => {
        const isOpen = expanded.has(node.id)
        const isSel = node.id === selected
        return (
          <div
            key={node.id}
            ref={(el) => {
              if (el) rowRefs.current.set(node.id, el)
              else rowRefs.current.delete(node.id)
            }}
            role="treeitem"
            aria-label={node.textValue}
            aria-level={level}
            aria-expanded={node.isLeaf ? undefined : isOpen}
            aria-selected={isSel}
            tabIndex={isSel || (index < 0 && flat[0]?.node.id === node.id) ? 0 : -1}
            onClick={() => {
              onSelect(node)
              if (!node.isLeaf) onToggle(node, !isOpen)
            }}
            onDoubleClick={() => node.isLeaf && onActivate(node)}
            className={cn(
              'flex h-row cursor-default items-center gap-1.5 whitespace-nowrap pr-3 text-sm outline-none',
              isSel ? 'bg-selection-inactive focus:bg-selection' : 'hover:bg-hover',
              'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-focus',
            )}
            style={{ paddingLeft: `calc(var(--space-12) + ${level - 1} * var(--size-tree-indent))` }}
          >
            <span className="flex size-3 shrink-0 items-center justify-center text-text-muted">
              {!node.isLeaf &&
                (loading?.has(node.id) ? (
                  <span className="size-3 animate-spin rounded-pill border border-hover border-t-accent-text" />
                ) : isOpen ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                ))}
            </span>
            {node.icon && <span className="flex size-icon shrink-0 items-center justify-center">{node.icon}</span>}
            <span className={cn(node.secondary ? 'shrink-0' : 'truncate', node.className ?? 'text-text')}>{node.label}</span>
            {node.secondary && <span className="min-w-0 truncate text-xs text-text-muted">{node.secondary}</span>}
          </div>
        )
      })}
    </div>
  )
}
