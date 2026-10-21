// Estrutura (Alt+7): os símbolos do arquivo ativo em árvore; o que contém o cursor fica selecionado.
// Clique ou Enter leva ao símbolo.
import { useEffect, useMemo, useState } from 'react'
import { Box, Braces, SquareFunction, Type, Variable } from 'lucide-react'
import { useStructure, useSymbolPath } from '../editor/structure'
import { useDocs } from '../editor/docs'
import type { DocSymbol } from '../editor/lsp/adapter'
import { ToolWindowFrame } from '../shell/ToolWindows'
import { EmptyState, TreeView, type TreeNode } from '../design/feedback'
import { t } from '../i18n'

const c = 'size-icon-sm shrink-0'
function iconOf(kind: number) {
  if (kind === 6 || kind === 12) return <SquareFunction className={`${c} text-accent-text`} aria-hidden />
  if (kind === 5 || kind === 23) return <Box className={`${c} text-warning`} aria-hidden />
  if (kind === 11) return <Braces className={`${c} text-success`} aria-hidden />
  if (kind === 8 || kind === 13 || kind === 14) return <Variable className={`${c} text-text-muted`} aria-hidden />
  return <Type className={`${c} text-text-muted`} aria-hidden />
}

const idOf = (s: DocSymbol, parent: string) => `${parent}/${s.name}:${s.selectionRange.start.line}`

export function StructurePanel() {
  const { key, symbols } = useStructure()
  const path = useSymbolPath()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const { roots, byId } = useMemo(() => {
    const byId = new Map<string, DocSymbol>()
    const conv = (list: DocSymbol[], parent: string): TreeNode[] =>
      list.map((s) => {
        const id = idOf(s, parent)
        byId.set(id, s)
        const kids = s.children?.length ? conv(s.children, id) : undefined
        return { id, label: s.name, textValue: s.name, icon: iconOf(s.kind), secondary: s.detail, isLeaf: !kids, children: kids }
      })
    return { roots: conv(symbols, ''), byId }
  }, [symbols])
  // Tipos com campos começam abertos.
  useEffect(() => setExpanded(new Set([...byId.keys()].filter((id) => (byId.get(id)?.children?.length ?? 0) > 0))), [byId])
  let selected: string | null = null
  let parent = ''
  for (const s of path) {
    parent = idOf(s, parent)
    selected = parent
  }
  const go = (n: TreeNode) => {
    const s = byId.get(n.id)
    if (s && key) void useDocs.getState().open(key, { line: s.selectionRange.start.line + 1, col: s.selectionRange.start.character + 1, preview: false })
  }
  return (
    <ToolWindowFrame>
      {!key || !key.endsWith('.go') ? (
        <EmptyState title={t('Sem estrutura')}>{t('Abra um arquivo Go para ver as funções, os tipos e os métodos dele.')}</EmptyState>
      ) : roots.length === 0 ? (
        <EmptyState title={t('Nada aqui ainda')}>{t('O gopls ainda não respondeu ou o arquivo não tem declarações.')}</EmptyState>
      ) : (
        <TreeView
          label={t('Estrutura do arquivo')}
          roots={roots}
          expanded={expanded}
          selected={selected}
          onSelect={go}
          onActivate={go}
          onToggle={(n, open) =>
            setExpanded((e) => {
              const s = new Set(e)
              if (open) s.add(n.id)
              else s.delete(n.id)
              return s
            })
          }
        />
      )}
    </ToolWindowFrame>
  )
}
