// Registro de ações com atalho. A mesma lista alimenta o "Buscar em tudo > Ações" (S06).
// O keymap é próprio da IDE; o usuário troca atalhos em Configurações → Atalhos (S28), que viram overrides.

export interface Action {
  id: string
  title: string
  keys?: string // "Mod+S", "Alt+1", "Shift+F10"; Mod = Ctrl (Cmd no macOS)
  run: () => void
  when?: () => boolean
  inTerminal?: boolean // vale também com o foco no terminal (que, fora isso, recebe todas as teclas)
}

const actions = new Map<string, Action>()
const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
// Atalhos trocados pelo usuário (ação → teclas; "" = sem atalho).
let overrides: Record<string, string> = {}

export function setKeyOverrides(o: Record<string, string>) {
  overrides = o
}

/** O atalho que vale agora (o do usuário, se houver, senão o padrão). */
const effective = (a: Action) => (a.id in overrides ? overrides[a.id] || undefined : a.keys)

export function registerActions(list: Action[]): () => void {
  for (const a of list) actions.set(a.id, a)
  return () => list.forEach((a) => actions.delete(a.id))
}

/** As ações com o atalho efetivo; `defaultKeys` é o original. */
export function allActions(): Array<Action & { defaultKeys?: string }> {
  return [...actions.values()].map((a) => ({ ...a, keys: effective(a), defaultKeys: a.keys }))
}

/** A combinação de um evento no formato do keymap ("Mod+Shift+K"); null para tecla modificadora sozinha. */
export function comboFromEvent(e: KeyboardEvent | React.KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null
  const parts: string[] = []
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('Mod')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  // Com Alt/Shift o e.key vira outro caractere: a letra/número vem do code.
  const code = e.code
  let key = code.startsWith('Key') ? code.slice(3) : code.startsWith('Digit') ? code.slice(5) : e.key.length === 1 ? e.key.toUpperCase() : e.key
  if (key === ' ') key = 'Space'
  parts.push(key)
  return parts.join('+')
}

/** Texto do atalho para mostrar na UI. */
export function keyLabel(keys?: string): string | undefined {
  if (!keys) return undefined
  return keys.replace('Mod', isMac ? '⌘' : 'Ctrl')
}

function matches(keys: string, e: KeyboardEvent): boolean {
  const parts = keys.split('+')
  const key = parts.pop()!.toLowerCase()
  const want = { mod: false, shift: false, alt: false }
  for (const p of parts) want[p.toLowerCase() as keyof typeof want] = true
  const mod = isMac ? e.metaKey : e.ctrlKey
  if (mod !== want.mod || e.shiftKey !== want.shift || e.altKey !== want.alt) return false
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase()
  // Alt+número no Linux pode vir como outro caractere: confira também o code.
  return k === key || e.code.toLowerCase() === 'digit' + key || e.code.toLowerCase() === 'key' + key
}

/** Liga o despacho global (fase de captura, antes do Monaco). */
export function installKeymap(): () => void {
  const onKey = (e: KeyboardEvent) => {
    // No terminal, Ctrl+K, Ctrl+T, Esc... são do shell (e de programas como vim e less).
    const target = e.target as Element | null
    if (target?.closest?.('[data-recording-keys]')) return // gravando um atalho novo (Configurações → Atalhos)
    const inTerminal = !!target?.closest?.('.xterm')
    for (const a of actions.values()) {
      if (inTerminal && !a.inTerminal) continue
      const keys = effective(a)
      if (keys && matches(keys, e) && (!a.when || a.when())) {
        e.preventDefault()
        e.stopPropagation()
        a.run()
        return
      }
    }
  }
  window.addEventListener('keydown', onKey, true)
  return () => window.removeEventListener('keydown', onKey, true)
}
