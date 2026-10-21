// Inventário de telas do recon (replica/recon.md). IDs estáveis: o resto do projeto se refere a eles.
// status: built = construída nesta fase; partial = existe com parte dos estados; stub = só o lugar reservado.

export type ScreenKind = 'view' | 'toolwindow' | 'dialog' | 'popup'
export type ScreenStatus = 'built' | 'partial' | 'stub'

export interface Screen {
  id: string
  name: string
  kind: ScreenKind
  status: ScreenStatus
  toolWindow?: string // id da tool window que mostra a tela
}

export const screens: Screen[] = [
  { id: 'S01', name: 'Tela inicial', kind: 'view', status: 'built' },
  { id: 'S02', name: 'Novo projeto', kind: 'dialog', status: 'stub' },
  { id: 'S03', name: 'Janela principal', kind: 'view', status: 'partial' },
  { id: 'S04', name: 'Editor', kind: 'view', status: 'partial' },
  { id: 'S05', name: 'Projeto', kind: 'toolwindow', status: 'built', toolWindow: 'project' },
  { id: 'S06', name: 'Buscar em tudo', kind: 'popup', status: 'built' },
  { id: 'S07', name: 'Buscar nos arquivos', kind: 'dialog', status: 'built' },
  { id: 'S08', name: 'Popups de código', kind: 'popup', status: 'partial' },
  { id: 'S09', name: 'Usos', kind: 'toolwindow', status: 'built', toolWindow: 'find' },
  { id: 'S10', name: 'Problemas', kind: 'toolwindow', status: 'partial', toolWindow: 'problems' },
  { id: 'S11', name: 'Refatorações', kind: 'dialog', status: 'partial' },
  { id: 'S12', name: 'Configurações de execução', kind: 'dialog', status: 'built' },
  { id: 'S13', name: 'Execução', kind: 'toolwindow', status: 'built', toolWindow: 'run' },
  { id: 'S14', name: 'Testes', kind: 'toolwindow', status: 'built', toolWindow: 'tests' },
  { id: 'S15', name: 'Depuração', kind: 'toolwindow', status: 'built', toolWindow: 'debug' },
  { id: 'S16', name: 'Avaliar expressão', kind: 'dialog', status: 'partial', toolWindow: 'debug' },
  { id: 'S17', name: 'Breakpoints', kind: 'dialog', status: 'built' },
  { id: 'S18', name: 'Cobertura', kind: 'toolwindow', status: 'built', toolWindow: 'coverage' },
  { id: 'S19', name: 'Terminal', kind: 'toolwindow', status: 'built', toolWindow: 'terminal' },
  { id: 'S20', name: 'Commit', kind: 'toolwindow', status: 'built', toolWindow: 'commit' },
  { id: 'S21', name: 'Diff', kind: 'view', status: 'partial' },
  { id: 'S22', name: 'Push', kind: 'dialog', status: 'built' },
  { id: 'S23', name: 'Branches', kind: 'popup', status: 'built' },
  { id: 'S24', name: 'Histórico do git', kind: 'toolwindow', status: 'built', toolWindow: 'git' },
  { id: 'S25', name: 'Conflitos', kind: 'dialog', status: 'built' },
  { id: 'S26', name: 'Merge em 3 painéis', kind: 'view', status: 'built' },
  { id: 'S27', name: 'Anotar (blame)', kind: 'view', status: 'built' },
  { id: 'S28', name: 'Configurações', kind: 'dialog', status: 'built' },
  { id: 'S29', name: 'Clonar repositório', kind: 'dialog', status: 'built' },
  { id: 'S30', name: 'Notificações', kind: 'toolwindow', status: 'built', toolWindow: 'notifications' },
]

export const screenById = (id: string) => screens.find((s) => s.id === id)
