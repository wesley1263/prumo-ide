// S05 Projeto: árvore de arquivos com status do git, carregada sob demanda.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronsDownUp, Crosshair, File, FileCode2, FileText, Folder, RefreshCw } from 'lucide-react'
import { api, type ChangeKind, type FileNode } from '../lib/api'
import { IconButton } from '../design/controls'
import { EmptyState, TreeView, toast, type TreeNode } from '../design/feedback'
import { ToolWindowFrame } from '../shell/ToolWindows'
import { useApp } from '../state/app'
import { useDocs } from '../editor/docs'
import { t } from '../i18n'

const statusClass: Record<ChangeKind, string> = {
  modified: 'text-vcs-modified',
  added: 'text-vcs-added',
  renamed: 'text-vcs-modified',
  untracked: 'text-vcs-unversioned',
  deleted: 'text-vcs-deleted',
  conflict: 'text-danger',
}

function fileIcon(name: string) {
  if (name.endsWith('.go')) return <FileCode2 className="size-icon text-accent-text" aria-hidden />
  if (/\.(md|txt)$/i.test(name)) return <FileText className="size-icon text-text-muted" aria-hidden />
  return <File className="size-icon text-text-muted" aria-hidden />
}

function homeRelative(path: string): string {
  const home = useApp.getState().boot?.homeDir
  return home && path.startsWith(home + '/') ? '~' + path.slice(home.length) : path
}

export function ProjectPanel() {
  const project = useApp((s) => s.project)!
  const git = useApp((s) => s.git)
  const open = useDocs((s) => s.open)
  const activeKey = useDocs((s) => s.active)
  const [children, setChildren] = useState<Record<string, FileNode[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']))
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (dir: string) => {
      setLoading((l) => new Set(l).add(dir))
      try {
        const list = await api.Files.Tree(project.id, dir)
        setChildren((c) => ({ ...c, [dir]: list }))
        setError(null)
      } catch (e) {
        if (dir === '') setError(String((e as Error).message))
        else toast('danger', t('Não foi possível ler a pasta'), String((e as Error).message))
      } finally {
        setLoading((l) => {
          const n = new Set(l)
          n.delete(dir)
          return n
        })
      }
    },
    [project.id],
  )

  useEffect(() => {
    setChildren({})
    setExpanded(new Set(['']))
    load('')
  }, [load])

  // Operações do git que mexem no disco (trocar de branch, atualizar) pedem para reler as pastas abertas.
  useEffect(() => {
    const onRefresh = () => {
      for (const dir of expandedRef.current) load(dir)
    }
    window.addEventListener('prumo:refresh-tree', onRefresh)
    return () => window.removeEventListener('prumo:refresh-tree', onRefresh)
  }, [load])

  const refresh = () => {
    for (const dir of expanded) load(dir)
    useApp.getState().refreshGit()
  }

  // Status por arquivo e pastas que contêm mudanças.
  const { byPath, dirty } = useMemo(() => {
    const byPath = new Map<string, ChangeKind>()
    const dirty = new Set<string>()
    for (const f of git?.files ?? []) {
      byPath.set(f.path, f.kind)
      const parts = f.path.split('/')
      for (let i = 1; i < parts.length; i++) dirty.add(parts.slice(0, i).join('/'))
    }
    return { byPath, dirty }
  }, [git])

  const toNode = (n: FileNode): TreeNode => {
    const kind = byPath.get(n.path)
    return {
      id: n.path,
      label: n.name,
      textValue: n.name,
      isLeaf: !n.isDir,
      icon: n.isDir ? <Folder className="size-icon text-text-muted" aria-hidden /> : fileIcon(n.name),
      children: n.isDir ? children[n.path]?.map(toNode) : undefined,
      className: kind ? statusClass[kind] : n.isDir && dirty.has(n.path) ? 'text-vcs-modified' : undefined,
    }
  }
  const root: TreeNode = {
    id: '',
    label: project.name,
    textValue: project.name,
    secondary: homeRelative(project.rootPath),
    isLeaf: false,
    icon: <Folder className="size-icon text-accent-text" aria-hidden />,
    children: children['']?.map(toNode),
  }

  const onToggle = (node: TreeNode, isOpen: boolean) => {
    setExpanded((e) => {
      const n = new Set(e)
      if (isOpen) n.add(node.id)
      else n.delete(node.id)
      return n
    })
    if (isOpen && !children[node.id]) load(node.id)
  }

  const selectOpened = async () => {
    if (!activeKey || activeKey.startsWith('diff:') || activeKey.startsWith('ext:')) return
    const parts = activeKey.split('/')
    const dirs = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
    for (const d of dirs) if (!children[d]) await load(d)
    setExpanded((e) => new Set([...e, '', ...dirs]))
    setSelected(activeKey)
  }

  return (
    <ToolWindowFrame
      side="left"
      actions={
        <>
          <IconButton label={t('Mostrar arquivo aberto')} size="sm" icon={<Crosshair className="size-icon-sm" />} onPress={selectOpened} />
          <IconButton label={t('Recolher tudo')} size="sm" icon={<ChevronsDownUp className="size-icon-sm" />} onPress={() => setExpanded(new Set(['']))} />
          <IconButton label={t('Atualizar')} size="sm" icon={<RefreshCw className="size-icon-sm" />} onPress={refresh} />
        </>
      }
    >
      {error ? (
        <EmptyState title={t('Não foi possível ler o projeto')}>{error}</EmptyState>
      ) : (
        <TreeView
          label={t('Arquivos do projeto')}
          roots={[root]}
          expanded={expanded}
          onToggle={onToggle}
          selected={selected}
          onSelect={(n) => setSelected(n.id)}
          onActivate={(n) => n.isLeaf && open(n.id, { preview: false })}
          loading={loading}
        />
      )}
      {children['']?.length === 0 && <EmptyState title={t('Pasta vazia')}>{t('Crie um arquivo para começar.')}</EmptyState>}
    </ToolWindowFrame>
  )
}
