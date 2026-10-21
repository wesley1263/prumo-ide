// Barras laterais de ícones e o contêiner das tool windows.
import { Minus, MoveHorizontal } from 'lucide-react'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { cn } from '../design/cn'
import { useToasts } from '../design/feedback'
import { IconButton, Menu, Tooltip } from '../design/controls'
import { keyLabel } from '../lib/keymap'
import { placeOf, toolWindows, toolWindow, useLayout, type Place, type Side } from './layout'
import { useDiagnostics } from '../editor/lsp/adapter'
import { useApp } from '../state/app'
import { t, tn } from '../i18n'

// A moldura descobre qual janela mostra e onde ela está por aqui (o painel não precisa saber o lado).
const FrameContext = createContext<{ id: string; place: Place } | null>(null)
export const ToolWindowHost = FrameContext.Provider

const DRAG_TYPE = 'application/x-goide-toolwindow'

function StripeButton({ id }: { id: string }) {
  const tw = toolWindow(id)
  const active = useLayout((s) => {
    const place = s.placement[id] ?? tw.side
    return place === 'float' ? s.floating.includes(id) : s.open[place] === id
  })
  const toggle = useLayout((s) => s.toggle)
  const badge = useBadge(id)
  const unread = useToasts((s) => (id === 'notifications' ? s.unread : 0))
  const Icon = tw.icon
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, id)
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      <Tooltip content={tw.title} shortcut={keyLabel(tw.keys)}>
        <AriaButton
          aria-label={unread ? tn(unread, '{title} ({n} nova)', '{title} ({n} novas)', { title: tw.title }) : tw.title}
          aria-pressed={active}
          onPress={() => toggle(id)}
          className={cn(
            'relative flex size-stripe-button items-center justify-center rounded-md outline-none transition-colors duration-fast',
            active ? 'bg-accent text-on-accent' : 'text-text-muted data-[hovered]:bg-hover data-[hovered]:text-text',
            'data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus',
          )}
        >
          <Icon className="size-icon" strokeWidth={1.75} aria-hidden />
          {badge && <span className={cn('absolute right-1 top-1 size-1.5 rounded-pill', badge)} aria-hidden />}
        </AriaButton>
      </Tooltip>
    </div>
  )
}

/** Ponto colorido no ícone: erro no Problems, mudanças no Commit, execução rodando no Run. */
function useBadge(id: string): string | null {
  const counts = useDiagnostics((s) => s.counts)
  const changes = useApp((s) => s.git?.files.length ?? 0)
  const running = useApp((s) => s.runs.some((r) => r.state === 'running' || r.state === 'building'))
  const unread = useToasts((s) => s.unread)
  if (id === 'problems' && counts.errors > 0) return 'bg-danger'
  if (id === 'commit' && changes > 0) return 'bg-vcs-modified'
  if (id === 'run' && running) return 'bg-success'
  if (id === 'notifications' && unread > 0) return 'bg-accent-text'
  return null
}

/** Grupo de ícones que aceita uma janela arrastada de outro lugar. */
function DropGroup({ place, ids, label }: { place: Place; ids: string[]; label: string }) {
  const [over, setOver] = useState(false)
  const moveTo = useLayout((s) => s.moveTo)
  return (
    <div
      role="group"
      aria-label={label}
      data-drop={place}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const id = e.dataTransfer.getData(DRAG_TYPE)
        if (id && placeOf(id) !== place) moveTo(id, place)
      }}
      className={cn('flex min-h-[var(--size-stripe-button)] flex-col items-center gap-0.5 rounded-md p-0.5 transition-colors duration-fast', over && 'bg-selection ring-1 ring-focus')}
    >
      {ids.map((id) => (
        <StripeButton key={id} id={id} />
      ))}
    </div>
  )
}

export function Stripe({ side }: { side: 'left' | 'right' }) {
  const placement = useLayout((s) => s.placement)
  const at = (p: Place) => toolWindows.filter((w) => (placement[w.id] ?? w.side) === p).map((w) => w.id)
  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      aria-label={side === 'left' ? t('Janelas da esquerda e de baixo') : t('Janelas da direita')}
      className={cn('flex w-stripe shrink-0 flex-col items-center justify-between bg-chrome py-1.5', side === 'left' ? 'border-r border-border' : 'border-l border-border')}
    >
      <DropGroup place={side} ids={at(side)} label={side === 'left' ? t('Esquerda') : t('Direita')} />
      {side === 'left' ? (
        <div className="flex flex-col items-center gap-1">
          <DropGroup place="float" ids={at('float')} label={t('Flutuantes')} />
          <DropGroup place="bottom" ids={at('bottom')} label={t('Embaixo')} />
        </div>
      ) : (
        <span />
      )}
    </div>
  )
}

const PLACES: Array<{ id: Place; label: string }> = [
  { id: 'left', label: t('Esquerda') },
  { id: 'bottom', label: t('Embaixo') },
  { id: 'right', label: t('Direita') },
  { id: 'float', label: t('Flutuante') },
]

/** Tool window aberta: cabeçalho com título e ações, conteúdo, foco gerenciado. `side` é só legado: o lugar vem do host. */
export function ToolWindowFrame({ actions, children }: { side?: Side; actions?: ReactNode; children: ReactNode }) {
  const host = useContext(FrameContext)!
  const { id, place } = host
  const tw = toolWindow(id)
  const hideWindow = useLayout((s) => s.hideWindow)
  const moveTo = useLayout((s) => s.moveTo)
  const focusRequest = useLayout((s) => s.focusRequest)
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (focusRequest?.id !== id || !ref.current) return
    const target = ref.current.querySelector<HTMLElement>('[data-autofocus], [role=tree] [tabindex="0"], textarea, input, [tabindex="0"]')
    ;(target ?? ref.current).focus()
  }, [focusRequest, id])

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-label={tw.title}
      data-toolwindow={id}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && e.shiftKey) {
          hideWindow(id)
          window.dispatchEvent(new CustomEvent('goide:focus-editor'))
        }
      }}
      className="group/tw flex h-full min-h-0 min-w-0 flex-col bg-surface outline-none"
    >
      <header className="flex h-toolwindow-header shrink-0 items-center gap-1 pl-3 pr-1" data-drag-handle={place === 'float' ? id : undefined}>
        <h2 className="flex-1 truncate text-md text-text-muted group-focus-within/tw:text-text">{tw.title}</h2>
        {actions}
        <Menu
          label={t('Mover {title}', { title: tw.title })}
          trigger={<IconButton label={t('Mover para')} size="sm" icon={<MoveHorizontal className="size-icon-sm" />} />}
          items={PLACES.map((p) => ({ id: p.id, label: p.label, disabled: p.id === place }))}
          onAction={(p) => moveTo(id, p as Place)}
        />
        <IconButton label={t('Esconder')} shortcut="Shift+Esc" size="sm" icon={<Minus className="size-icon-sm" />} onPress={() => hideWindow(id)} />
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  )
}

/**
 * Janelas flutuantes sobre a área de trabalho: arrastar pelo cabeçalho, redimensionar pelo canto, clicar traz
 * para a frente. A posição de cada uma fica salva com o layout do projeto.
 */
export function FloatingWindows({ render }: { render: (id: string) => ReactNode }) {
  const floating = useLayout((s) => s.floating)
  const floats = useLayout((s) => s.floats)
  const { setFloat, show } = useLayout.getState()
  const drag = (id: string, mode: 'move' | 'resize', e: React.PointerEvent) => {
    const box = floats[id]
    if (!box) return
    const start = { x: e.clientX, y: e.clientY }
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x
      const dy = ev.clientY - start.y
      const maxX = window.innerWidth - 80
      const maxY = window.innerHeight - 40
      if (mode === 'move') setFloat(id, { ...box, x: Math.min(maxX, Math.max(-box.w + 80, box.x + dx)), y: Math.min(maxY, Math.max(0, box.y + dy)) })
      else setFloat(id, { ...box, w: Math.max(280, box.w + dx), h: Math.max(160, box.h + dy) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <>
      {floating.map((id, i) => {
        const box = floats[id]
        if (!box) return null
        return (
          <div
            key={id}
            data-floating={id}
            style={{ left: box.x, top: box.y, width: box.w, height: box.h, zIndex: `calc(var(--z-toolwindow-float) + ${i})` }}
            className="fixed overflow-hidden rounded-lg border border-border-strong shadow-pop"
            onPointerDownCapture={(e) => {
              if (i !== floating.length - 1) show(id) // traz para a frente
              const handle = (e.target as HTMLElement).closest('[data-drag-handle]')
              if (handle && !(e.target as HTMLElement).closest('button')) drag(id, 'move', e)
            }}
          >
            <ToolWindowHost value={{ id, place: 'float' }}>{render(id)}</ToolWindowHost>
            {/* A alça é maior que o raio do canto: a ponta arredondada é recortada pelo overflow. */}
            <div
              aria-hidden
              title={t('Redimensionar')}
              onPointerDown={(e) => (e.stopPropagation(), drag(id, 'resize', e))}
              className="absolute bottom-0 right-0 size-4 cursor-nwse-resize"
            />
          </div>
        )
      })}
    </>
  )
}
