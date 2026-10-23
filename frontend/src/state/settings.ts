// Preferências da IDE (S28). O tema fica em state/app (aplica no <html> antes de tudo); o resto vive aqui.
import { create } from 'zustand'
import { api } from '../lib/api'
import { setKeyOverrides } from '../lib/keymap'
import tokens from '../../design/tokens.json'

export interface Prefs {
  'editor.fontSize': number
  'editor.formatOnSave': boolean
  'editor.inlayHints': boolean
  'terminal.shell': string
  'commit.format': boolean // gofmt + organizar imports nos .go do commit
  'commit.vet': boolean // go vet nos pacotes do commit
  'commit.tests': boolean // go test nos pacotes do commit
  'keymap.overrides': Record<string, string> // ação → atalho trocado pelo usuário ("" = sem atalho)
  'commit.agent': string // agente de IA da mensagem de commit: auto | claude | codex | gemini | custom | off
  'commit.agentCommand': string // comando do agente quando "custom" (o pedido vai pela entrada padrão)
  'commit.agentLanguage': string // auto (o dos commits recentes) | pt-BR | en
  'commit.agentInstructions': string // instruções extras para o agente
  'commit.agentConsent': boolean // já confirmou que o diff vai para o provedor do agente
  'agent.editConsent': boolean // já confirmou que o código do arquivo vai para o provedor do agente (Ctrl+\\ no editor)
}

export const DEFAULTS: Prefs = {
  'editor.fontSize': tokens.type.code.size,
  'editor.formatOnSave': true,
  'editor.inlayHints': true,
  'terminal.shell': '',
  'commit.format': false,
  'commit.vet': false,
  'commit.tests': false,
  'keymap.overrides': {},
  'commit.agent': 'auto',
  'commit.agentCommand': '',
  'commit.agentLanguage': 'auto',
  'commit.agentInstructions': '',
  'commit.agentConsent': false,
  'agent.editConsent': false,
}

export const usePrefs = create<Prefs>(() => ({ ...DEFAULTS }))
// O keymap acompanha as preferências (vale na hora).
usePrefs.subscribe((s, prev) => s['keymap.overrides'] !== prev['keymap.overrides'] && setKeyOverrides(s['keymap.overrides']))

/** Lê do bootstrap (o que não estiver gravado fica no padrão). */
export function loadPrefs(saved: Record<string, unknown>) {
  const next = { ...DEFAULTS }
  for (const k of Object.keys(DEFAULTS) as Array<keyof Prefs>) {
    if (saved[k] !== undefined && typeof saved[k] === typeof DEFAULTS[k]) (next as Record<string, unknown>)[k] = saved[k]
  }
  usePrefs.setState(next)
  setKeyOverrides(next['keymap.overrides'])
}

/** Grava as mudanças (o backend valida cada uma) e só então aplica. */
export async function savePrefs(changes: Partial<Prefs>) {
  for (const [k, v] of Object.entries(changes)) await api.Settings.Set(k, v)
  usePrefs.setState(changes)
}

/** Altura de linha do código proporcional à fonte (o token é 13/20). */
export const codeLineHeight = (size: number) => Math.round((size * tokens.type.code.line) / tokens.type.code.size)
