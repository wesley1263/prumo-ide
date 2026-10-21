// S01 Tela inicial: projetos recentes, abrir pasta, clonar (S29) e criar um módulo novo (S02).
import { useMemo, useState } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { FolderOpen, FolderPlus, GitBranchPlus, Moon, Search, Sun, Trash2, Settings } from 'lucide-react'
import { keyLabel } from '../lib/keymap'
import { openSettings } from '../settings/SettingsDialog'
import { api, ApiError } from '../lib/api'
import { Button, IconButton, TextField } from '../design/controls'
import { Banner, Dialog, EmptyState, toast } from '../design/feedback'
import { cn } from '../design/cn'
import { useApp } from '../state/app'
import { CloneDialog } from './CloneDialog'
import { NewProjectDialog } from './NewProjectDialog'
import { t } from '../i18n'

function OpenPathDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const home = useApp((s) => s.boot?.homeDir ?? '')
  const openProject = useApp((s) => s.openProject)
  const [path, setPath] = useState(home ? home + '/' : '')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      await openProject(path)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={t('Abrir pasta')}
      isOpen={isOpen}
      onOpenChange={(o) => !o && onClose()}
      footer={
        <>
          <Button onPress={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onPress={submit} loading={busy} isDisabled={!path.trim()}>
            {t('Abrir')}
          </Button>
        </>
      }
    >
      <TextField
        label={t('Caminho da pasta')}
        value={path}
        onChange={(v) => (setPath(v), setError(undefined))}
        error={error}
        autoFocus
        selectOnFocus
        description={t('Caminho absoluto ou começando com ~.')}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
    </Dialog>
  )
}

export function Welcome() {
  const boot = useApp((s) => s.boot)!
  const recent = useApp((s) => s.recent)
  const theme = useApp((s) => s.theme)
  const { openProject, setTheme, refreshRecent } = useApp.getState()
  const [query, setQuery] = useState('')
  const [pathDialog, setPathDialog] = useState(false)
  const [cloneDialog, setCloneDialog] = useState(false)
  const [newDialog, setNewDialog] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? recent.filter((p) => p.name.toLowerCase().includes(q) || p.rootPath.toLowerCase().includes(q)) : recent
  }, [recent, query])

  const pickAndOpen = async () => {
    try {
      const dir = await api.Dialogs.PickDirectory(t('Abrir projeto'))
      if (dir) await openProject(dir)
    } catch (e) {
      // Sem seletor nativo (modo dev no navegador): pede o caminho por texto.
      if (e instanceof ApiError && /seletor nativo/.test(e.raw)) setPathDialog(true)
      else toast('danger', t('Não foi possível abrir'), String((e as Error).message))
    }
  }
  const openRecent = async (path: string) => {
    setOpening(path)
    try {
      await openProject(path)
    } catch (e) {
      toast('danger', t('Não foi possível abrir'), String((e as Error).message))
    } finally {
      setOpening(null)
    }
  }
  const missingTools = [
    !boot.tools.go.path && 'go',
    !boot.tools.git.path && 'git',
    !boot.tools.gopls.path && 'gopls',
  ].filter(Boolean) as string[]

  const actions = (
    <>
      <Button icon={<FolderPlus className="size-icon" />} onPress={() => setNewDialog(true)}>
        {t('Novo projeto')}
      </Button>
      <Button variant="primary" icon={<FolderOpen className="size-icon" />} onPress={pickAndOpen}>
        {t('Abrir')}
      </Button>
      <Button icon={<GitBranchPlus className="size-icon" />} onPress={() => setCloneDialog(true)}>
        {t('Clonar')}
      </Button>
    </>
  )

  return (
    <div className="flex h-full bg-surface text-text">
      <aside className="flex w-settings-nav-width shrink-0 flex-col gap-6 border-r border-border bg-chrome p-4">
        <div>
          <div className="text-xl">Prumo</div>
          <div className="text-xs text-text-muted">{t('IDE para Go feita de peças abertas · em desenvolvimento')}</div>
        </div>
        <nav aria-label={t('Tela inicial')} className="flex flex-col gap-0.5">
          <span className="flex h-control items-center rounded-md bg-selection px-2 text-sm text-text" aria-current="page">
            {t('Projetos')}
          </span>
        </nav>
        <div className="mt-auto flex items-center gap-2 text-xs text-text-muted">
          <IconButton
            label={theme === 'dark' ? t('Usar tema claro') : t('Usar tema escuro')}
            icon={theme === 'dark' ? <Sun className="size-icon" /> : <Moon className="size-icon" />}
            onPress={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          />
          <IconButton label={t('Configurações')} shortcut={keyLabel('Mod+Alt+S')} icon={<Settings className="size-icon" />} onPress={() => openSettings()} />
          {boot.sdks.find((s) => s.isDefault)?.version ?? t('Go não encontrado')}
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        {missingTools.length > 0 && (
          <Banner
            level="warning"
            actions={
              !boot.tools.gopls.path && boot.tools.go.path ? (
                <Button
                  size="sm"
                  onPress={() =>
                    api.Tools.Install('gopls')
                      .then(() => toast('success', t('gopls instalado')))
                      .catch((e) => toast('danger', t('Falha ao instalar o gopls'), String(e.message)))
                  }
                >
                  {t('Instalar gopls')}
                </Button>
              ) : undefined
            }
          >
            {t('Ferramentas não encontradas: {tools}. Algumas funções ficam desligadas.', { tools: missingTools.join(', ') })}
          </Banner>
        )}
        <div className="flex items-center gap-2 p-4 pb-3">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-icon -translate-y-1/2 text-text-muted" aria-hidden />
            <input
              aria-label={t('Buscar projetos recentes')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('Buscar projetos')}
              className="h-control w-full rounded-md border border-border-input bg-bg pl-8 pr-2 text-sm text-text placeholder:text-text-muted outline-none focus:border-focus focus:ring-2 focus:ring-focus"
            />
          </div>
          {actions}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-2 pb-4">
          {recent.length === 0 ? (
            <EmptyState title={t('Nenhum projeto ainda')} actions={actions}>
              {t('Abra uma pasta com um módulo Go para começar.')}
            </EmptyState>
          ) : filtered.length === 0 ? (
            <EmptyState title={t('Nenhum projeto com esse nome')} />
          ) : (
            <ul aria-label={t('Projetos recentes')} className="flex flex-col">
              {filtered.map((p) => (
                <li key={p.id} className="group flex items-center rounded-md hover:bg-hover">
                  <AriaButton
                    isDisabled={!p.exists || opening !== null}
                    onPress={() => openRecent(p.rootPath)}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1.5 text-left outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus"
                  >
                    <span
                      aria-hidden
                      className={cn('flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold', p.exists ? 'bg-selection text-accent-text' : 'bg-hover text-text-subtle')}
                    >
                      {p.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className={cn('block truncate text-sm font-semibold', p.exists ? 'text-text' : 'text-text-subtle')}>{p.name}</span>
                      <span className="block truncate text-xs text-text-muted">{p.exists ? p.rootPath : t('Pasta não encontrada: {path}', { path: p.rootPath })}</span>
                    </span>
                    {opening === p.rootPath && <span className="ml-auto text-xs text-text-muted">{t('Abrindo…')}</span>}
                  </AriaButton>
                  <IconButton
                    label={t('Remover {name} da lista', { name: p.name })}
                    size="sm"
                    className={cn('mr-2', p.exists && 'opacity-0 group-hover:opacity-100 data-[focus-visible]:opacity-100')}
                    icon={<Trash2 className="size-icon-sm" />}
                    onPress={() => api.Projects.RemoveRecent(p.id).then(refreshRecent)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
      {pathDialog && <OpenPathDialog isOpen onClose={() => setPathDialog(false)} />}
      <CloneDialog isOpen={cloneDialog} onClose={() => setCloneDialog(false)} />
      {newDialog && <NewProjectDialog isOpen onClose={() => setNewDialog(false)} />}
    </div>
  )
}
