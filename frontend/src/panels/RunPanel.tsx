// S13 Executar: uma aba por execução, console com links arquivo:linha, parar, rodar de novo, stdin.
import { useEffect, useState } from 'react'
import { ArrowDownToLine, Eraser, Play, RotateCw, Square, X } from 'lucide-react'
import { type RunInfo } from '../lib/api'
import { Console, clearOutput, closeOutput, follow, useOutput } from './Console'
import { IconButton, TextField } from '../design/controls'
import { EmptyState } from '../design/feedback'
import { cn } from '../design/cn'
import { ToolWindowFrame } from '../shell/ToolWindows'
import { useApp } from '../state/app'
import { keyLabel } from '../lib/keymap'
import { api } from '../lib/api'
import { t } from '../i18n'

const stateLabel: Record<RunInfo['state'], string> = {
  building: t('compilando'),
  running: t('rodando'),
  exited: t('terminou'),
  failed: t('falhou'),
  stopped: t('parado'),
}

export function RunPanel() {
  const runs = useApp((s) => s.runs)
  const runConfig = useApp((s) => s.runConfig)
  const stopRun = useApp((s) => s.stopRun)
  const closedTabs = useOutput((s) => s.closedTabs)
  const visible = runs.filter((r) => !closedTabs.has(r.id)).slice(0, 8)
  const [activeId, setActiveId] = useState<string | null>(null)
  const active = visible.find((r) => r.id === activeId) ?? visible[0]
  const [autoscroll, setAutoscroll] = useState(true)
  const [input, setInput] = useState('')

  useEffect(() => {
    for (const r of visible) follow(r.id)
  }, [visible])
  useEffect(() => {
    if (runs[0] && runs[0].id !== activeId && (runs[0].state === 'building' || runs[0].state === 'running')) setActiveId(runs[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs[0]?.id])

  const live = active && (active.state === 'building' || active.state === 'running')
  const closeTab = closeOutput

  if (!active) {
    return (
      <ToolWindowFrame side="bottom">
        <EmptyState title={t('Nada rodou ainda')}>
          {t('Clique no ▶ ao lado de')} <code className="font-mono">func main()</code> {t('ou use {key} para rodar a configuração escolhida.', { key: keyLabel('Shift+F10') ?? '' })}
        </EmptyState>
      </ToolWindowFrame>
    )
  }

  return (
    <ToolWindowFrame
      side="bottom"
      actions={
        <div role="tablist" aria-label={t('Execuções')} className="mr-2 flex items-center gap-1 overflow-x-auto">
          {visible.map((r) => (
            <div
              key={r.id}
              role="tab"
              aria-selected={r.id === active.id}
              tabIndex={0}
              onClick={() => setActiveId(r.id)}
              onKeyDown={(e) => e.key === 'Enter' && setActiveId(r.id)}
              className={cn(
                'group flex h-control-sm items-center gap-1.5 rounded-md px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-focus',
                r.id === active.id ? 'bg-selection text-text' : 'text-text-muted hover:bg-hover',
              )}
            >
              <span
                className={cn(
                  'size-1.5 rounded-pill',
                  r.state === 'running' || r.state === 'building' ? 'bg-success' : r.state === 'failed' || (r.exitCode ?? 0) !== 0 ? 'bg-danger' : 'bg-text-subtle',
                )}
                aria-label={stateLabel[r.state]}
              />
              <span className="max-w-empty-max truncate">{r.name}</span>
              <span aria-hidden title={t('Fechar {name}', { name: r.name })} onClick={(e) => (e.stopPropagation(), closeTab(r.id))} className="hidden rounded-xs hover:bg-pressed group-hover:block">
                <X className="size-3" />
              </span>
            </div>
          ))}
        </div>
      }
    >
      <div className="flex h-full min-h-0">
        <div role="toolbar" aria-orientation="vertical" aria-label={t('Ações da execução')} className="flex shrink-0 flex-col gap-0.5 border-r border-border p-1">
          <IconButton label={t('Rodar de novo')} shortcut={keyLabel('Mod+F5')} size="sm" icon={live ? <RotateCw className="size-icon-sm" /> : <Play className="size-icon-sm text-success" />} onPress={() => runConfig(active.configId)} />
          <IconButton label={t('Parar')} shortcut={keyLabel('Mod+F2')} size="sm" isDisabled={!live} icon={<Square className={cn('size-icon-sm', live && 'text-danger')} />} onPress={() => stopRun(active.id)} />
          <IconButton label={t('Rolar até o fim')} size="sm" toggled={autoscroll} icon={<ArrowDownToLine className="size-icon-sm" />} onPress={() => setAutoscroll(!autoscroll)} />
          <IconButton label={t('Limpar')} size="sm" icon={<Eraser className="size-icon-sm" />} onPress={() => clearOutput(active.id)} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <Console id={active.id} label={t('Saída de {name}', { name: active.name })} autoscroll={autoscroll} onAutoscroll={setAutoscroll} />
          {active.state === 'running' && (
            <div className="border-t border-border px-2 py-1">
              <TextField
                label={t('Entrada do programa')}
                hideLabel
                value={input}
                onChange={setInput}
                placeholder={t('Digite e tecle Enter para enviar ao programa')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    api.Runs.WriteStdin(active.id, input + '\n').catch(() => {})
                    setInput('')
                  }
                }}
              />
            </div>
          )}
        </div>
      </div>
    </ToolWindowFrame>
  )
}
