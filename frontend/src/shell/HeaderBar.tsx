// Cabeçalho: menu principal, projeto, branch, configuração de execução e ações.
import { Button as AriaButton } from 'react-aria-components'
import { Bug, ChevronDown, LayoutGrid, Menu as MenuIcon, Moon, Play, Square, Sun, Settings } from 'lucide-react'
import { openSettings } from '../settings/SettingsDialog'
import { openRunConfigs } from '../run/RunConfigDialog'
import { GO_TOOLS, runGoTool, type GoTool } from '../run/GoTools'
import { useDebug } from '../state/debug'
import { BranchesWidget } from '../git/BranchesPopup'
import { Menu, IconButton, type MenuAction } from '../design/controls'
import { toast } from '../design/feedback'
import { cn } from '../design/cn'
import { useApp, windowForConfig } from '../state/app'
import { useLayout } from './layout'
import { screens } from '../lib/screens'
import { keyLabel } from '../lib/keymap'
import { t } from '../i18n'

const widget =
  'inline-flex h-control max-w-dialog-sm items-center gap-1.5 rounded-md px-2 text-sm text-text outline-none transition-colors duration-fast ' +
  'data-[hovered]:bg-hover data-[pressed]:bg-pressed data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus'

function openScreen(id: string) {
  const s = screens.find((x) => x.id === id)!
  if (s.toolWindow) return useLayout.getState().show(s.toolWindow)
  if (id === 'S01') return useApp.getState().closeProject()
  toast('info', `${s.name} (${id})`, s.status === 'stub' ? t('Ainda não construída. Entra num próximo marco.') : t('Já está nesta janela.'))
}

export function HeaderBar() {
  const project = useApp((s) => s.project)!
  const theme = useApp((s) => s.theme)
  const configs = useApp((s) => s.runConfigs)
  const selected = useApp((s) => s.selectedConfig)
  const runs = useApp((s) => s.runs)
  const { setTheme, closeProject, switchProject, selectConfig, runConfig, stopRun } = useApp.getState()
  const recent = useApp((s) => s.recent)
  const home = useApp((s) => s.boot?.homeDir ?? '')
  const cfg = configs.find((c) => c.id === selected)
  const live = runs.find((r) => r.configId === selected && (r.state === 'running' || r.state === 'building'))
  const debugging = useDebug((d) => d.sessions.some((x) => x.id === d.active && x.state !== 'terminated'))

  const mainMenu: MenuAction[] = [
    { id: 'settings', label: t('Configurações…'), shortcut: keyLabel('Mod+Alt+S'), icon: <Settings className="size-icon-sm" /> },
    ...GO_TOOLS.map((g, i) => ({ id: 'go:' + g.id, label: g.title, separatorBefore: i === 0 })),
    { id: 'close', label: t('Fechar projeto'), separatorBefore: true },
    { id: 'theme', label: theme === 'dark' ? t('Tema claro') : t('Tema escuro'), icon: theme === 'dark' ? <Sun className="size-icon-sm" /> : <Moon className="size-icon-sm" /> },
    { id: 'design', label: t('Sistema de design'), separatorBefore: true },
  ]
  // Trocar de projeto: os recentes (menos o atual e os que sumiram do disco) e a tela inicial.
  const others = recent.filter((r) => r.id !== project.id && r.exists).slice(0, 10)
  const projectMenu: MenuAction[] = [
    ...(others.length ? others.map((r) => ({ id: 'p:' + r.rootPath, label: r.name, shortcut: r.rootPath.replace(home, '~') })) : [{ id: 'none', label: t('Nenhum outro projeto recente'), disabled: true }]),
    { id: 'welcome', label: t('Abrir ou clonar outro…'), separatorBefore: true },
  ]
  const runMenu: MenuAction[] = [
    ...(configs.length
      ? configs.map((c) => ({ id: c.id, label: c.name + (c.temporary ? '' : ' ★') }))
      : [{ id: 'none', label: t('Nenhuma configuração ainda'), disabled: true }]),
    { id: 'edit', label: t('Editar configurações…'), separatorBefore: true },
  ]

  return (
    <header role="banner" className="flex h-header shrink-0 items-center gap-1 border-b border-border bg-chrome px-2">
      <Menu
        label={t('Menu principal')}
        trigger={<IconButton label={t('Menu principal')} icon={<MenuIcon className="size-icon" />} />}
        items={mainMenu}
        onAction={(id) => {
          if (id === 'settings') openSettings()
          if (id.startsWith('go:')) void runGoTool(id.slice(3) as GoTool).catch((e) => toast('danger', t('Não foi possível rodar'), String(e.message)))
          if (id === 'close') closeProject()
          if (id === 'theme') setTheme(theme === 'dark' ? 'light' : 'dark')
          if (id === 'design') location.hash = '#design'
        }}
      />
      <Menu
        label={t('Projetos')}
        trigger={
          <AriaButton className={cn(widget, 'font-semibold')} aria-label={t('Projeto: {name}', { name: project.name })}>
            <span className="flex size-5 items-center justify-center rounded-sm bg-selection text-2xs font-semibold text-accent-text" aria-hidden>
              {project.name.slice(0, 2).toUpperCase()}
            </span>
            <span className="truncate">{project.name}</span>
            <ChevronDown className="size-3 text-text-muted" aria-hidden />
          </AriaButton>
        }
        items={projectMenu}
        onAction={(id) => {
          if (id === 'welcome') void closeProject()
          else if (id.startsWith('p:')) void switchProject(id.slice(2))
        }}
      />
      <BranchesWidget />
      <div className="flex-1" />
      <Menu
        label={t('Configuração de execução')}
        trigger={
          <AriaButton className={widget} aria-label={t('Configuração: {name}', { name: cfg?.name ?? t('nenhuma') })}>
            <span className={cn('truncate', !cfg && 'text-text-muted')}>{cfg?.name ?? t('Sem configuração')}</span>
            <ChevronDown className="size-3 text-text-muted" aria-hidden />
          </AriaButton>
        }
        items={runMenu}
        onAction={(id) => (id === 'edit' ? openRunConfigs() : selectConfig(id))}
      />
      <IconButton
        label={cfg ? t('Rodar {name}', { name: cfg.name }) : t('Escolha uma configuração')}
        shortcut={keyLabel('Shift+F10')}
        isDisabled={!cfg}
        icon={<Play className="size-icon text-success" />}
        onPress={() => cfg && (runConfig(cfg.id), useLayout.getState().show(windowForConfig(cfg.id)))}
      />
      <IconButton
        label={cfg ? t('Depurar {name}', { name: cfg.name }) : t('Escolha uma configuração')}
        shortcut={keyLabel('Shift+F9')}
        isDisabled={!cfg}
        icon={<Bug className="size-icon" />}
        onPress={() => cfg && useDebug.getState().start(cfg.id)}
      />
      <IconButton
        label={t('Parar')}
        shortcut={keyLabel('Mod+F2')}
        isDisabled={!live && !debugging}
        icon={<Square className={cn('size-icon', (live || debugging) && 'text-danger')} />}
        onPress={() => (debugging ? useDebug.getState().stop() : live && stopRun(live.id))}
      />
      <Menu
        label={t('Telas')}
        trigger={<IconButton label={t('Telas do inventário')} icon={<LayoutGrid className="size-icon" />} />}
        items={screens.map((s) => ({ id: s.id, label: `${s.id} ${s.name}${s.status === 'stub' ? ' ' + t('(em breve)') : s.status === 'partial' ? ' ' + t('(parcial)') : ''}` }))}
        onAction={openScreen}
      />
    </header>
  )
}
