// S18 Cobertura: % de comandos cobertos por pacote e por arquivo da última execução com cobertura. Duplo clique
// (ou Enter) abre o arquivo; as faixas no gutter do editor podem ser ligadas e desligadas daqui.
import { useState } from 'react'
import { ChevronDown, ChevronRight, Eye, EyeOff, FileCode2, Layers, Trash2 } from 'lucide-react'
import { useCoverage, percent } from '../editor/coverage'
import { useDocs } from '../editor/docs'
import { ToolWindowFrame } from '../shell/ToolWindows'
import { IconButton } from '../design/controls'
import { EmptyState } from '../design/feedback'
import { cn } from '../design/cn'
import { lang, t } from '../i18n'

const fmt = (n: number) => n.toLocaleString(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'

function Bar({ covered, total, label }: { covered: number; total: number; label: string }) {
  const p = percent(covered, total)
  return (
    <span className="flex shrink-0 items-center gap-1.5" title={t('{covered} de {total} comandos', { covered, total })}>
      <span role="meter" aria-label={label} aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100} className="relative h-1.5 w-[3rem] overflow-hidden rounded-pill bg-coverage-none">
        <span className="absolute inset-y-0 left-0 bg-coverage-full" style={{ width: `${p}%` }} />
      </span>
      <span className="w-[3rem] text-right text-xs tabular-nums text-text">{fmt(p)}</span>
    </span>
  )
}

export function CoveragePanel() {
  const { data, visible, merge, runs } = useCoverage()
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const actions = data ? (
    <>
      <IconButton
        label={visible ? t('Esconder do editor') : t('Mostrar no editor')}
        size="sm"
        toggled={visible}
        icon={visible ? <Eye className="size-icon-sm" /> : <EyeOff className="size-icon-sm" />}
        onPress={() => useCoverage.setState({ visible: !visible })}
      />
      <IconButton label={t('Somar com a cobertura anterior')} size="sm" toggled={merge} icon={<Layers className="size-icon-sm" />} onPress={() => useCoverage.setState({ merge: !merge })} />
      <IconButton label={t('Limpar a cobertura')} size="sm" icon={<Trash2 className="size-icon-sm" />} onPress={() => useCoverage.setState({ data: null, runs: 0 })} />
    </>
  ) : null

  if (!data)
    return (
      <ToolWindowFrame actions={actions}>
        <EmptyState title={t('Sem cobertura ainda')}>{t('Clique com o botão direito no ▶ de um teste e escolha "Rodar com cobertura".')}</EmptyState>
      </ToolWindowFrame>
    )

  const toggle = (k: string) =>
    setClosed((c) => {
      const n = new Set(c)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  const open = (path: string) => void useDocs.getState().open(path, { preview: false })
  return (
    <ToolWindowFrame actions={actions}>
      <div className="flex h-full flex-col">
        <p role="status" className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-sm text-text">
          {t('Total')}
          {runs > 1 && <span className="text-xs text-text-muted">{t('{n} execuções somadas', { n: runs })}</span>}
          <span className="ml-auto" />
          <Bar covered={data.covered} total={data.total} label={t('Cobertura total')} />
        </p>
        <ul role="tree" aria-label={t('Cobertura por pacote')} className="min-h-0 flex-1 overflow-y-auto py-1">
          {data.packages.map((p) => {
            const isOpen = !closed.has(p.importPath)
            const files = data.files.filter((f) => f.package === p.importPath)
            // Pela pasta do projeto ("internal/cart"): o import path inteiro não cabe numa janela lateral.
            const dir = files[0]?.path.includes('/') ? files[0].path.slice(0, files[0].path.lastIndexOf('/')) : files[0] ? '.' : p.importPath
            return (
              <li key={p.importPath} role="treeitem" aria-expanded={isOpen} aria-selected={false} aria-label={`${p.importPath}, ${fmt(percent(p.covered, p.total))}`}>
                <button
                  type="button"
                  onClick={() => toggle(p.importPath)}
                  className="flex h-row w-full items-center gap-1.5 px-2 text-left text-sm outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-focus"
                >
                  {isOpen ? <ChevronDown className="size-icon-sm shrink-0" aria-hidden /> : <ChevronRight className="size-icon-sm shrink-0" aria-hidden />}
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-text" title={p.importPath}>
                    {dir}
                  </span>
                  <Bar covered={p.covered} total={p.total} label={t('Cobertura de {name}', { name: p.importPath })} />
                </button>
                {isOpen && (
                  <ul role="group">
                    {files.map((f) => (
                      <li
                        key={f.path}
                        role="treeitem"
                        tabIndex={0}
                        aria-selected={false}
                        aria-label={`${f.path}, ${fmt(percent(f.covered, f.total))}`}
                        onDoubleClick={() => open(f.path)}
                        onKeyDown={(e) => e.key === 'Enter' && open(f.path)}
                        className={cn('flex h-row cursor-default items-center gap-1.5 pl-6 pr-2 text-sm outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-focus')}
                      >
                        <FileCode2 className="size-icon-sm shrink-0 text-accent-text" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-text">{f.path.split('/').pop()}</span>
                        <Bar covered={f.covered} total={f.total} label={t('Cobertura de {name}', { name: f.path })} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </ToolWindowFrame>
  )
}
