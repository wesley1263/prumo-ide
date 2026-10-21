// Contexto por branch: ao trocar de branch, as abas abertas ficam guardadas na que saiu e as da que entrou
// voltam (como o "restaurar o contexto" do GoLand). Fica no estado do projeto. Os breakpoints valem para todas.
import { create } from 'zustand'
import { useApp } from '../state/app'
import { tabKeyOf, useDocs } from '../editor/docs'

export interface BranchContext {
  tabs: string[]
  active: string | null
}

export const useBranchContexts = create<{ byBranch: Record<string, BranchContext> }>(() => ({ byBranch: {} }))

function snapshot(): BranchContext {
  const { tabs, active } = useDocs.getState()
  const files = tabs.filter((t) => t.kind === 'file' && !t.key.startsWith('ext:')).map(tabKeyOf)
  return { tabs: files, active: active && files.includes(active) ? active : null }
}

async function restore(ctx: BranchContext) {
  const docs = useDocs.getState()
  // Fecha as abas de arquivo que não são da branch (fechar salva antes, como sempre).
  for (const t of docs.tabs) if (t.kind === 'file' && !t.key.startsWith('ext:') && !ctx.tabs.includes(t.key)) await useDocs.getState().close(tabKeyOf(t))
  for (const key of ctx.tabs) await useDocs.getState().open(key, { preview: false }).catch(() => {}) // pode não existir nesta branch
  if (ctx.active && useDocs.getState().tabs.some((t) => tabKeyOf(t) === ctx.active)) useDocs.getState().activate(ctx.active)
}

export function installBranchContext(): () => void {
  let last = useApp.getState().git?.branch ?? ''
  return useApp.subscribe((s) => {
    const branch = s.git?.branch ?? ''
    if (!branch || branch === last) return
    const from = last
    last = branch
    if (!from) return // primeira leitura do status
    const byBranch = { ...useBranchContexts.getState().byBranch, [from]: snapshot() }
    useBranchContexts.setState({ byBranch })
    const saved = byBranch[branch]
    if (saved) void restore(saved)
  })
}
