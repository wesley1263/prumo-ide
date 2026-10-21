// Primitivas de controle: botões, campos, checkbox, tooltip, menu, badge.
// Só classes dos tokens (bg-surface, text-muted, h-control...). Nada de hex ou px soltos.
import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
  Checkbox as AriaCheckbox,
  type CheckboxProps,
  Input,
  Label,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  type MenuItemProps,
  MenuTrigger,
  Popover,
  Separator,
  Text,
  TextArea as AriaTextArea,
  TextField as AriaTextField,
  Tooltip as AriaTooltip,
  TooltipTrigger,
  FieldError,
} from 'react-aria-components'
import { Check, Loader2, Minus } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from './cn'

const focusRing =
  'outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus data-[focus-visible]:ring-offset-1 data-[focus-visible]:ring-offset-surface'

// ---------------------------------------------------------------- Button

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent data-[hovered]:bg-accent-hover data-[pressed]:bg-accent-hover',
  secondary: 'border border-border-input text-text data-[hovered]:bg-hover data-[pressed]:bg-pressed',
  ghost: 'text-text data-[hovered]:bg-hover data-[pressed]:bg-pressed',
  danger: 'border border-danger bg-danger-bg text-danger data-[hovered]:bg-pressed',
}
const sizes: Record<Size, string> = {
  sm: 'h-control-sm px-2 text-xs',
  md: 'h-control px-3 text-sm',
  lg: 'h-control-lg px-4 text-sm',
}

export interface ButtonProps extends AriaButtonProps {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
}

export function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, isDisabled, ...rest }: ButtonProps) {
  return (
    <AriaButton
      {...rest}
      isDisabled={isDisabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex min-w-button-min select-none items-center whitespace-nowrap justify-center gap-1.5 rounded-md font-medium transition-colors duration-fast',
        'data-[disabled]:cursor-default data-[disabled]:border-border data-[disabled]:bg-transparent data-[disabled]:text-text-subtle',
        focusRing,
        variants[variant],
        sizes[size],
        className as string,
      )}
    >
      {(rp) => (
        <>
          {loading ? <Loader2 className="size-icon animate-spin" aria-hidden /> : icon}
          {typeof children === 'function' ? children(rp) : children}
        </>
      )}
    </AriaButton>
  )
}

// ---------------------------------------------------------------- IconButton

export interface IconButtonProps extends Omit<AriaButtonProps, 'children'> {
  label: string // aria-label e tooltip
  shortcut?: string
  icon: ReactNode
  toggled?: boolean
  size?: 'sm' | 'md'
}

export function IconButton({ label, shortcut, icon, toggled, size = 'md', className, ...rest }: IconButtonProps) {
  return (
    <Tooltip content={label} shortcut={shortcut}>
      <AriaButton
        {...rest}
        aria-label={label}
        aria-pressed={toggled}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-fast',
          size === 'md' ? 'size-icon-button' : 'size-control-sm',
          toggled ? 'bg-selection text-accent-text' : 'text-text-muted data-[hovered]:bg-hover data-[hovered]:text-text',
          'data-[pressed]:bg-pressed data-[disabled]:text-text-subtle data-[disabled]:bg-transparent',
          focusRing,
          className as string,
        )}
      >
        {icon}
      </AriaButton>
    </Tooltip>
  )
}

// ---------------------------------------------------------------- Tooltip

export function Tooltip({ content, shortcut, children }: { content: ReactNode; shortcut?: string; children: ReactNode }) {
  return (
    <TooltipTrigger delay={600} closeDelay={0}>
      {children}
      <AriaTooltip
        offset={6}
        className="z-tooltip flex items-center gap-2 rounded-sm border border-border bg-surface-raised px-2 py-1 text-xs text-text shadow-pop"
      >
        {content}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </AriaTooltip>
    </TooltipTrigger>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="font-mono text-2xs text-text-muted">{children}</kbd>
}

// ---------------------------------------------------------------- TextField / TextArea

interface FieldProps {
  label: string
  hideLabel?: boolean
  value: string
  onChange: (v: string) => void
  placeholder?: string
  description?: string
  error?: string
  autoFocus?: boolean
  className?: string
  onKeyDown?: (e: React.KeyboardEvent) => void
  name?: string
  selectOnFocus?: boolean // valor sugerido que o usuário normalmente substitui
}

const inputBox =
  'w-full rounded-md border border-border-input bg-bg px-2 text-sm text-text placeholder:text-text-muted ' +
  'outline-none transition-colors duration-fast data-[hovered]:border-text-muted ' +
  'data-[focused]:border-focus data-[focused]:ring-2 data-[focused]:ring-focus ' +
  'data-[invalid]:border-danger data-[disabled]:bg-surface data-[disabled]:text-text-subtle'

export function TextField({ label, hideLabel, value, onChange, placeholder, description, error, autoFocus, className, onKeyDown, name, selectOnFocus }: FieldProps) {
  return (
    <AriaTextField
      value={value}
      onChange={onChange}
      isInvalid={!!error}
      autoFocus={autoFocus}
      name={name}
      className={cn('flex flex-col gap-1', className)}
    >
      <Label className={cn('text-xs text-text-muted', hideLabel && 'sr-only')}>{label}</Label>
      <Input
        placeholder={placeholder}
        onKeyDown={onKeyDown}
        onFocus={selectOnFocus ? (e) => e.currentTarget.select() : undefined}
        className={cn(inputBox, 'h-control')}
      />
      {description && !error && <Text slot="description" className="text-xs text-text-muted">{description}</Text>}
      <FieldError className="text-xs text-danger">{error}</FieldError>
    </AriaTextField>
  )
}

export function TextArea({ label, hideLabel, value, onChange, placeholder, error, className, onKeyDown, rows = 4 }: FieldProps & { rows?: number }) {
  return (
    <AriaTextField value={value} onChange={onChange} isInvalid={!!error} className={cn('flex flex-col gap-1', className)}>
      <Label className={cn('text-xs text-text-muted', hideLabel && 'sr-only')}>{label}</Label>
      <AriaTextArea rows={rows} placeholder={placeholder} onKeyDown={onKeyDown} className={cn(inputBox, 'resize-none py-1.5')} />
      <FieldError className="text-xs text-danger">{error}</FieldError>
    </AriaTextField>
  )
}

// ---------------------------------------------------------------- Checkbox

export function Checkbox({ children, className, ...rest }: CheckboxProps & { children?: ReactNode }) {
  return (
    <AriaCheckbox {...rest} className={cn('group flex items-center gap-2 text-sm text-text outline-none', className as string)}>
      {({ isSelected, isIndeterminate }) => (
        <>
          <span
            className={cn(
              'flex size-icon shrink-0 items-center justify-center rounded-xs border transition-colors duration-fast',
              isSelected || isIndeterminate ? 'border-accent bg-accent text-on-accent' : 'border-border-input bg-bg',
              'group-data-[focus-visible]:ring-2 group-data-[focus-visible]:ring-focus group-data-[disabled]:opacity-50',
            )}
          >
            {isIndeterminate ? <Minus className="size-3" strokeWidth={3} /> : isSelected && <Check className="size-3" strokeWidth={3} />}
          </span>
          {children}
        </>
      )}
    </AriaCheckbox>
  )
}

// ---------------------------------------------------------------- Menu

export interface MenuAction {
  id: string
  label: string
  shortcut?: string
  icon?: ReactNode
  disabled?: boolean
  danger?: boolean
  separatorBefore?: boolean
}

export function Menu({ trigger, items, onAction, label }: { trigger: ReactNode; items: MenuAction[]; onAction: (id: string) => void; label: string }) {
  return (
    <MenuTrigger>
      {trigger}
      <Popover placement="bottom start" offset={4} className="z-popup min-w-menu-min rounded-md border border-border bg-surface-raised py-1 shadow-pop outline-none">
        <AriaMenu aria-label={label} onAction={(k) => onAction(String(k))} className="outline-none" disabledKeys={items.filter((i) => i.disabled).map((i) => i.id)}>
          {items.flatMap((it) => {
            const node = (
              <MenuRow key={it.id} id={it.id} textValue={it.label} danger={it.danger}>
                <span className="flex size-icon items-center justify-center text-text-muted">{it.icon}</span>
                <span className="flex-1">{it.label}</span>
                {it.shortcut && <Kbd>{it.shortcut}</Kbd>}
              </MenuRow>
            )
            return it.separatorBefore ? [<Separator key={it.id + '-sep'} className="my-1 border-t border-border" />, node] : [node]
          })}
        </AriaMenu>
      </Popover>
    </MenuTrigger>
  )
}

function MenuRow({ danger, ...props }: MenuItemProps & { danger?: boolean }) {
  return (
    <AriaMenuItem
      {...props}
      className={cn(
        'mx-1 flex h-row cursor-default items-center gap-2 rounded-sm px-2 text-sm outline-none',
        danger ? 'text-danger' : 'text-text',
        'data-[focused]:bg-selection data-[disabled]:text-text-subtle',
      )}
    />
  )
}

// ---------------------------------------------------------------- Badge

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'
const tones: Record<Tone, string> = {
  neutral: 'bg-hover text-text-muted',
  info: 'bg-selection text-accent-text',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn('inline-flex h-badge items-center rounded-xs px-1.5 text-2xs font-semibold', tones[tone])}>{children}</span>
}
