// S05 Projeto: árvore de arquivos com status do git, carregada sob demanda.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronsDownUp, ClipboardPaste, Copy, Crosshair, File, FileCode2, FilePlus, FileText, Folder, FolderPlus, Pencil, RefreshCw, Scissors, Trash2 } from 'lucide-react'
import { api, type ChangeKind, type FileNode } from '../lib/api'
import { Button, IconButton, TextField } from '../design/controls'
import { ContextMenu } from '../design/ContextMenu'
import { Dialog, EmptyState, TreeView, toast, type TreeNode } from '../design/feedback'
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

const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const join = (dir: string, name: string) => (dir ? dir + '/' + name : name)
const under = (p: string, root: string) => p === root || p.startsWith(root + '/')

/** "a.go" → "a copy.go", "a copy 2.go"...: o primeiro nome livre na pasta. */
function freeName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name
  const dot = name.lastIndexOf('.')
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  for (let i = 1; ; i++) {
    const cand = `${base} ${t('cópia')}${i > 1 ? ' ' + i : ''}${ext}`
    if (!taken.has(cand)) return cand
  }
}

type FileAction = 'newFile' | 'newDir' | 'cut' | 'copy' | 'paste' | 'copyPath' | 'copyRelPath' | 'rename' | 'delete'
type NameDialog = { mode: 'newFile' | 'newDir' | 'rename'; dir: string; path?: string; value: string }

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
  const [menu, setMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null)
  const [nameDlg, setNameDlg] = useState<NameDialog | null>(null)
  const [nameError, setNameError] = useState<string | undefined>()
  const [delDlg, setDelDlg] = useState<{ path: string; isDir: boolean; name: string } | null>(null)
  const [clip, setClip] = useState<{ path: string; cut: boolean } | null>(null)
  const childrenRef = useRef(children)
  childrenRef.current = children

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

  // ---- Operações de arquivo (menu de contexto) ----
  const fail = (title: string, e: unknown) => toast('danger', title, String((e as Error).message))
  const dirOf = (n: TreeNode) => (n.isLeaf ? parentOf(n.id) : n.id)
  const reloadDirs = async (...dirs: string[]) => {
    await Promise.all([...new Set(dirs)].filter((d) => d === '' || expandedRef.current.has(d)).map((d) => load(d)))
    useApp.getState().refreshGit()
  }
  const forgetCache = (path: string) => setChildren((c) => Object.fromEntries(Object.entries(c).filter(([k]) => !under(k, path))))
  const reveal = (dir: string) => {
    const parts = dir ? dir.split('/') : []
    setExpanded((e) => new Set([...e, '', ...parts.map((_, i) => parts.slice(0, i + 1).join('/'))]))
  }

  const create = async (dir: string, name: string, isDir: boolean) => {
    const path = join(dir, name.trim())
    try {
      await api.Files.Create(project.id, path, isDir)
    } catch (e) {
      setNameError(String((e as Error).message))
      return false
    }
    // Pastas intermediárias (a/b/c.go) também precisam aparecer.
    const chain = path.split('/').slice(0, -1)
    const dirs = chain.map((_, i) => chain.slice(0, i + 1).join('/'))
    reveal(isDir ? path : parentOf(path))
    for (const d of ['', ...dirs]) await load(d)
    useApp.getState().refreshGit()
    setSelected(path)
    if (!isDir) void open(path, { preview: false })
    return true
  }

  const rename = async (from: string, name: string) => {
    const to = join(parentOf(from), name.trim())
    if (to === from) return true
    const { keys, active } = await useDocs.getState().dropPaths(from, true)
    const reopen = async () => {
      for (const k of keys) await open(k, { preview: false })
      if (active) await open(active, { preview: false })
    }
    try {
      await api.Files.Rename(project.id, from, to)
    } catch (e) {
      setNameError(String((e as Error).message))
      await reopen()
      return false
    }
    forgetCache(from)
    setExpanded((e) => new Set([...e].map((k) => (under(k, from) ? to + k.slice(from.length) : k))))
    for (const k of keys) await open(to + k.slice(from.length), { preview: false })
    if (active) await open(to + active.slice(from.length), { preview: false })
    await reloadDirs(parentOf(from), parentOf(to))
    setSelected(to)
    return true
  }

  const remove = async (path: string) => {
    await useDocs.getState().dropPaths(path, false)
    try {
      await api.Files.Delete(project.id, path)
    } catch (e) {
      fail(t('Não foi possível apagar'), e)
    }
    forgetCache(path)
    await reloadDirs(parentOf(path))
    setSelected(null)
  }

  const paste = async (dir: string) => {
    if (!clip) return
    const taken = new Set((childrenRef.current[dir] ?? []).map((n) => n.name))
    const name = clip.path.split('/').pop()!
    try {
      if (clip.cut) {
        if (parentOf(clip.path) === dir) return
        if (taken.has(name)) throw new Error(t('Já existe "{name}" nesta pasta.', { name }))
        await useDocs.getState().dropPaths(clip.path, true).then(async ({ keys }) => {
          try {
            await api.Files.Rename(project.id, clip.path, join(dir, name))
          } catch (e) {
            for (const k of keys) await open(k, { preview: false })
            throw e
          }
          for (const k of keys) await open(join(dir, name) + k.slice(clip.path.length), { preview: false })
        })
        forgetCache(clip.path)
        setClip(null)
        await reloadDirs(parentOf(clip.path), dir)
      } else {
        await api.Files.Copy(project.id, clip.path, join(dir, freeName(name, taken)))
        await reloadDirs(dir)
      }
      reveal(dir)
    } catch (e) {
      fail(clip.cut ? t('Não foi possível mover') : t('Não foi possível copiar'), e)
    }
  }

  const onMenuAction = (id: string) => {
    const node = menu?.node
    if (!node) return
    const a = id as FileAction
    const abs = project.rootPath + (node.id ? '/' + node.id : '')
    switch (a) {
      case 'newFile':
      case 'newDir':
        setNameError(undefined)
        setNameDlg({ mode: a, dir: dirOf(node), value: '' })
        break
      case 'rename':
        setNameError(undefined)
        setNameDlg({ mode: 'rename', dir: parentOf(node.id), path: node.id, value: node.textValue })
        break
      case 'delete':
        setDelDlg({ path: node.id, isDir: !node.isLeaf, name: node.textValue })
        break
      case 'cut':
      case 'copy':
        setClip({ path: node.id, cut: a === 'cut' })
        break
      case 'paste':
        void paste(dirOf(node))
        break
      case 'copyPath':
        void navigator.clipboard?.writeText(abs).catch(() => {})
        break
      case 'copyRelPath':
        void navigator.clipboard?.writeText(node.id || '.').catch(() => {})
        break
    }
  }

  const menuItems = (node: TreeNode) => {
    const isRoot = node.id === ''
    const items = [
      { id: 'newFile', label: t('Novo arquivo…'), icon: <FilePlus className="size-icon-sm" /> },
      { id: 'newDir', label: t('Nova pasta…'), icon: <FolderPlus className="size-icon-sm" /> },
      ...(isRoot ? [] : [
        { id: 'cut', label: t('Recortar'), icon: <Scissors className="size-icon-sm" />, separatorBefore: true },
        { id: 'copy', label: t('Copiar'), icon: <Copy className="size-icon-sm" /> },
      ]),
      { id: 'paste', label: t('Colar'), icon: <ClipboardPaste className="size-icon-sm" />, disabled: !clip, separatorBefore: isRoot },
      { id: 'copyPath', label: t('Copiar caminho'), separatorBefore: true },
      { id: 'copyRelPath', label: t('Copiar caminho relativo ao projeto') },
      ...(isRoot ? [] : [
        { id: 'rename', label: t('Renomear…'), icon: <Pencil className="size-icon-sm" />, separatorBefore: true },
        { id: 'delete', label: t('Apagar…'), icon: <Trash2 className="size-icon-sm" />, danger: true },
      ]),
    ]
    return items
  }

  const submitName = async () => {
    if (!nameDlg) return
    const name = nameDlg.value.trim()
    if (!name) return
    const ok =
      nameDlg.mode === 'rename' ? await rename(nameDlg.path!, name) : await create(nameDlg.dir, name, nameDlg.mode === 'newDir')
    if (ok) setNameDlg(null)
  }

  const refresh = () => {
    for (const dir of expanded) load(dir)
    useApp.getState().refreshGit()
  }

  // Status por arquivo e pastas que contêm mudanças.
  const { byPath, dirty } = useMemo(() => {
    const byPath = new Map<string, ChangeKind>()
    const dirty = new Set<string>()
    for (const f of git?.files ?? []) {
      const path = f.path.replace(/\/$/, '') // pasta não versionada recolhida: a pasta e tudo dentro dela
      byPath.set(path, f.kind)
      const parts = path.split('/')
      for (let i = 1; i < parts.length; i++) dirty.add(parts.slice(0, i).join('/'))
    }
    return { byPath, dirty }
  }, [git])

  // inherited: dentro de uma pasta não versionada, tudo é não versionado.
  const toNode = (n: FileNode, inherited?: ChangeKind): TreeNode => {
    const kind = byPath.get(n.path) ?? inherited
    return {
      id: n.path,
      label: n.name,
      textValue: n.name,
      isLeaf: !n.isDir,
      icon: n.isDir ? <Folder className="size-icon text-text-muted" aria-hidden /> : fileIcon(n.name),
      children: n.isDir ? children[n.path]?.map((c) => toNode(c, kind === 'untracked' ? kind : undefined)) : undefined,
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
    children: children['']?.map((c) => toNode(c)),
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
          onContextMenu={(node, x, y) => setMenu({ x, y, node })}
          loading={loading}
        />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} label={t('Ações do arquivo')} items={menuItems(menu.node)} onAction={onMenuAction} onClose={() => setMenu(null)} />}
      <Dialog
        title={nameDlg?.mode === 'newDir' ? t('Nova pasta') : nameDlg?.mode === 'rename' ? t('Renomear') : t('Novo arquivo')}
        isOpen={!!nameDlg}
        onOpenChange={(o) => !o && setNameDlg(null)}
        footer={
          <>
            <Button onPress={() => setNameDlg(null)}>{t('Cancelar')}</Button>
            <Button variant="primary" isDisabled={!nameDlg?.value.trim()} onPress={() => void submitName()}>
              {nameDlg?.mode === 'rename' ? t('Renomear') : t('Criar')}
            </Button>
          </>
        }
      >
        {nameDlg && (
          <TextField
            label={nameDlg.mode === 'newDir' ? t('Nome da pasta') : nameDlg.mode === 'rename' ? t('Novo nome') : t('Nome do arquivo')}
            value={nameDlg.value}
            onChange={(v) => {
              setNameError(undefined)
              setNameDlg({ ...nameDlg, value: v })
            }}
            description={nameDlg.mode !== 'rename' ? t('Em: {dir}', { dir: nameDlg.dir || project.name }) : undefined}
            error={nameError}
            autoFocus
            selectOnFocus
            onKeyDown={(e) => e.key === 'Enter' && void submitName()}
          />
        )}
      </Dialog>
      <Dialog
        title={t('Apagar')}
        isOpen={!!delDlg}
        onOpenChange={(o) => !o && setDelDlg(null)}
        footer={
          <>
            <Button onPress={() => setDelDlg(null)} autoFocus>{t('Cancelar')}</Button>
            <Button
              variant="danger"
              onPress={() => {
                const p = delDlg!.path
                setDelDlg(null)
                void remove(p)
              }}
            >
              {t('Apagar')}
            </Button>
          </>
        }
      >
        {delDlg && (delDlg.isDir ? t('Apagar a pasta "{name}" e tudo que há dentro dela? Isso não pode ser desfeito.', { name: delDlg.name }) : t('Apagar o arquivo "{name}"? Isso não pode ser desfeito.', { name: delDlg.name }))}
      </Dialog>
      {children['']?.length === 0 && <EmptyState title={t('Pasta vazia')}>{t('Crie um arquivo para começar.')}</EmptyState>}
    </ToolWindowFrame>
  )
}
