// S20 Commit: mudanças do repositório, seleção por arquivo, mensagem e commit.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, FileDiff, History, RefreshCw, Trash2 } from 'lucide-react'
import { ContextMenu } from '../design/ContextMenu'
import { lineDiff, type Hunk } from '../editor/lineDiff'
import { fileState, hunkState, isPartial, partialContent, setHunk, setLine, type Chunks } from '../git/partial'
import { useStashUi } from '../git/Stash'
import { api, type FileChange } from '../lib/api'
import { Button, Checkbox, IconButton, Menu, TextArea, TextField } from '../design/controls'
import { Banner, Dialog, EmptyState, Spinner, toast } from '../design/feedback'
import { usePrefs, savePrefs } from '../state/settings'
import { monaco } from '../editor/monaco'
import { moveToChangelist, rememberMessage, useChangelists, useCommitHistory, useGitUi } from '../state/git'
import { cn } from '../design/cn'
import { ToolWindowFrame } from '../shell/ToolWindows'
import { useApp } from '../state/app'
import { useDocs } from '../editor/docs'
import { keyLabel } from '../lib/keymap'
import { t, tn } from '../i18n'

const kindLabel: Record<FileChange['kind'], string> = {
  modified: t('modificado'),
  added: t('novo'),
  deleted: t('apagado'),
  renamed: t('renomeado'),
  untracked: t('não versionado'),
  conflict: t('em conflito'),
}
const kindClass: Record<FileChange['kind'], string> = {
  modified: 'text-vcs-modified',
  added: 'text-vcs-added',
  deleted: 'text-vcs-deleted line-through',
  renamed: 'text-vcs-modified',
  untracked: 'text-vcs-unversioned',
  conflict: 'text-danger',
}

const SUBJECT_MAX = 72

const hunkRange = (h: Hunk) => `${h.start}${h.count > 1 ? `–${h.start + h.count - 1}` : ''}`
const hunkLabel = (h: Hunk) =>
  h.kind === 'deleted'
    ? tn(h.old.length, '{n} linha apagada antes da {start}', '{n} linhas apagadas antes da {start}', { start: h.start })
    : h.kind === 'added'
      ? t('adicionado: linhas {range}', { range: hunkRange(h) })
      : t('modificado: linhas {range}', { range: hunkRange(h) })

export function CommitPanel() {
  const project = useApp((s) => s.project)!
  const git = useApp((s) => s.git)
  const loading = useApp((s) => s.gitLoading)
  const refreshGit = useApp((s) => s.refreshGit)
  const askTrust = () => useApp.setState({ trustAsked: true })
  const openDiff = useDocs((s) => s.openDiff)
  const saveAll = useDocs((s) => s.saveAll)

  const files = git?.files ?? []
  const conflicted = files.filter((f) => f.kind === 'conflict')
  const tracked = files.filter((f) => f.kind !== 'untracked' && f.kind !== 'conflict')
  const untracked = files.filter((f) => f.kind === 'untracked')

  // Seleção: arquivos versionados entram marcados; não versionados, desmarcados.
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [known, setKnown] = useState<Set<string>>(new Set())
  useEffect(() => {
    setChecked((prev) => {
      const next = new Set<string>()
      for (const f of files) {
        if (prev.has(f.path) || (!known.has(f.path) && f.kind !== 'untracked')) next.add(f.path)
      }
      return next
    })
    setKnown(new Set(files.map((f) => f.path)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [git])

  // Arquivos abertos em trechos (commit parcial).
  const [chunks, setChunks] = useState<Record<string, Chunks>>({})
  const loadChunks = async (path: string) => {
    const d = await api.Git.Diff(project.id, path)
    if (d.binary) return
    const hunks = lineDiff(d.left.split('\n'), d.right.split('\n')) ?? []
    setChunks((c) => {
      const same = c[path]?.hunks.length === hunks.length
      return { ...c, [path]: { left: d.left, right: d.right, hunks, off: same ? c[path].off : new Set(), lines: same ? c[path].lines : {} } }
    })
  }
  const toggleChunks = (path: string) =>
    chunks[path] ? setChunks(({ [path]: _, ...rest }) => rest) : void saveAll({ format: false }).then(() => loadChunks(path))
  // O disco mudou (git:status): relê os trechos abertos.
  useEffect(() => {
    for (const p of Object.keys(chunks)) if (files.some((f) => f.path === p)) void loadChunks(p)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [git])
  const toggleHunk = (path: string, i: number, on: boolean) => setChunks((c) => ({ ...c, [path]: setHunk(c[path], i, on) }))
  const toggleLine = (path: string, i: number, key: string, on: boolean) => setChunks((c) => ({ ...c, [path]: setLine(c[path], i, key, on) }))
  // Trechos abertos linha a linha ("caminho#índice").
  const [lineView, setLineView] = useState<Set<string>>(new Set())
  const toggleLineView = (k: string) =>
    setLineView((v) => {
      const n = new Set(v)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })

  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const [busy, setBusy] = useState(false)
  const [focused, setFocused] = useState<string | null>(null)
  const subject = message.split('\n')[0]
  const selectedFiles = useMemo(() => files.filter((f) => checked.has(f.path)).map((f) => f.path), [files, checked])
  const canCommit = !busy && (selectedFiles.length > 0 || amend) && (message.trim() !== '' || amend)

  const prefs = usePrefs()
  const [vetProblem, setVetProblem] = useState<{ output: string; thenPush: boolean; what: 'vet' | 'tests' } | null>(null)
  const history = useCommitHistory((s) => s.messages)

  const commit = async (thenPush = false, skipChecks = false) => {
    if (!canCommit) return
    if (!project.trusted) return askTrust()
    setBusy(true)
    try {
      await saveAll({ format: false })
      const goFiles = selectedFiles.filter((p) => p.endsWith('.go') && !chunks[p] && files.find((f) => f.path === p)?.kind !== 'deleted')
      if (!skipChecks && prefs['commit.format']) {
        // Formata e organiza os imports (o mesmo do Ctrl+S) antes de commitar.
        const docs = useDocs.getState()
        for (const p of goFiles) {
          await docs.ensureModel(monaco.Uri.file(docs.root + '/' + p).toString())
          await docs.save(p, { format: true })
        }
      }
      if (!skipChecks && prefs['commit.vet'] && goFiles.length) {
        const vet = await api.Runs.Vet(project.id, goFiles)
        if (!vet.ok) {
          setVetProblem({ output: vet.output, thenPush, what: 'vet' })
          return
        }
      }
      if (!skipChecks && prefs['commit.tests'] && goFiles.length) {
        const tests = await api.Runs.TestPackages(project.id, goFiles)
        if (!tests.ok) {
          setVetProblem({ output: tests.output, thenPush, what: 'tests' })
          return
        }
      }
      // Arquivo com trecho desmarcado entra parcial; com todos desmarcados, fica de fora.
      const partial: Record<string, string> = {}
      const toCommit = selectedFiles.filter((p) => !chunks[p] || fileState(chunks[p]) !== 'off')
      for (const p of toCommit) if (chunks[p] && isPartial(chunks[p])) partial[p] = partialContent(chunks[p])
      const res = await api.Git.Commit(project.id, { files: toCommit, message, amend, partial })
      setChunks({})
      toast('success', t('Commit {hash} criado', { hash: res.hash }), res.summary)
      rememberMessage(message)
      setMessage('')
      setAmend(false)
      await refreshGit()
      if (thenPush) useGitUi.getState().openPush()
    } catch (e) {
      toast('danger', t('O commit falhou'), String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  const changelists = useChangelists((s) => s.lists)
  const assigned = new Set(changelists.flatMap((l) => l.files))
  const [clMenu, setClMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  const [newCl, setNewCl] = useState<{ path: string; name: string } | null>(null)
  // Arquivo que deixou de ter mudança sai da changelist (ela continua, vazia).
  useEffect(() => {
    if (!git) return
    const changed = new Set(files.map((f) => f.path))
    const lists = useChangelists.getState().lists
    if (lists.some((l) => l.files.some((f) => !changed.has(f)))) useChangelists.setState({ lists: lists.map((l) => ({ ...l, files: l.files.filter((f) => changed.has(f)) })) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [git])
  const toggleGroup = (group: FileChange[], on: boolean) =>
    setChecked((c) => {
      const n = new Set(c)
      for (const f of group) on ? n.add(f.path) : n.delete(f.path)
      return n
    })

  const Group = ({ title, list, changelist }: { title: string; list: FileChange[]; changelist?: string }) => {
    if (list.length === 0 && !changelist) return null
    const n = list.filter((f) => checked.has(f.path)).length
    return (
      <div role="group" aria-label={title}>
        <div className="flex h-row items-center gap-2 px-3">
          <Checkbox isSelected={list.length > 0 && n === list.length} isIndeterminate={n > 0 && n < list.length} onChange={(on) => toggleGroup(list, on)} aria-label={t('Selecionar {name}', { name: title })}>
            <span className="text-sm font-semibold text-text">{title}</span>
            <span className="text-xs text-text-muted">{tn(list.length, '{n} arquivo', '{n} arquivos')}</span>
          </Checkbox>
          {changelist && (
            <IconButton
              label={t('Apagar a changelist {name}', { name: changelist })}
              size="sm"
              className="ml-auto"
              icon={<Trash2 className="size-icon-sm" />}
              onPress={() => useChangelists.setState({ lists: useChangelists.getState().lists.filter((l) => l.name !== changelist) })}
            />
          )}
        </div>
        {list.map((f) => {
          const name = f.path.split('/').pop()!
          const dir = f.path.slice(0, -name.length - 1)
          return (
            <div key={f.path}>
            <div className={cn('flex h-row items-center gap-2 pl-3 pr-3', focused === f.path ? 'bg-selection-inactive' : 'hover:bg-hover')}>
              {f.kind === 'modified' ? (
                <IconButton
                  label={chunks[f.path] ? t('Fechar os trechos de {path}', { path: f.path }) : t('Escolher trechos de {path}', { path: f.path })}
                  size="sm"
                  icon={chunks[f.path] ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                  onPress={() => toggleChunks(f.path)}
                />
              ) : (
                <span className="w-control-sm shrink-0" aria-hidden />
              )}
              <Checkbox
                isSelected={checked.has(f.path) && (!chunks[f.path] || fileState(chunks[f.path]) !== 'off')}
                isIndeterminate={checked.has(f.path) && !!chunks[f.path] && fileState(chunks[f.path]) === 'mixed'}
                onChange={(on) => {
                  toggleGroup([f], on)
                  if (chunks[f.path]) setChunks((c) => ({ ...c, [f.path]: { ...c[f.path], off: on ? new Set() : new Set(c[f.path].hunks.map((_, i) => i)), lines: {} } }))
                }}
                aria-label={t('Incluir {path} ({kind})', { path: f.path, kind: kindLabel[f.kind] })}
              />
              <span
                role="button"
                tabIndex={0}
                title={t('{path} · {kind} · clique duplo para ver o diff', { path: f.path, kind: kindLabel[f.kind] })}
                onClick={() => setFocused(f.path)}
                onDoubleClick={() => openDiff(f.path)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setClMenu({ x: e.clientX, y: e.clientY, path: f.path })
                }}
                onKeyDown={(e) => {
                  if (e.key === 'F6' && f.kind !== 'untracked' && f.kind !== 'conflict') {
                    // F6: mover para outra changelist (como no GoLand).
                    e.preventDefault()
                    const r = e.currentTarget.getBoundingClientRect()
                    setClMenu({ x: r.left + 24, y: r.bottom, path: f.path })
                    return
                  }
                  if (e.key === 'Enter' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd')) {
                    e.preventDefault()
                    openDiff(f.path)
                  }
                }}
                onFocus={() => setFocused(f.path)}
                className="flex min-w-0 flex-1 cursor-default items-center gap-2 rounded-xs outline-none focus-visible:ring-1 focus-visible:ring-focus"
              >
                <span className={cn('truncate text-sm', kindClass[f.kind])}>{name}</span>
                {dir && <span className="truncate text-xs text-text-muted">{dir}</span>}
              </span>
            </div>
            {chunks[f.path] && (
              <ul aria-label={t('Trechos de {path}', { path: f.path })} className="pb-1 pl-14 pr-3">
                {chunks[f.path].hunks.map((h, i) => {
                  const c = chunks[f.path]
                  const st = hunkState(c, i)
                  const now = h.kind === 'deleted' ? [] : c.right.split('\n').slice(h.start - 1, h.start - 1 + h.count)
                  const byLine = lineView.has(`${f.path}#${i}`)
                  const lineOn = (key: string) => checked.has(f.path) && st !== 'off' && !c.lines[i]?.has(key)
                  return (
                    <li key={i} className="flex items-start gap-2 py-0.5">
                      <Checkbox
                        isSelected={checked.has(f.path) && st !== 'off'}
                        isIndeterminate={checked.has(f.path) && st === 'mixed'}
                        onChange={(on) => {
                          if (on && !checked.has(f.path)) toggleGroup([f], true)
                          toggleHunk(f.path, i, on)
                        }}
                        aria-label={t('Incluir o trecho {n} de {path} ({hunk})', { n: i + 1, path: f.path, hunk: hunkLabel(h) })}
                      />
                      <span className="min-w-0 flex-1 font-mono text-xs">
                        <span className="flex items-center gap-1 text-text-muted">
                          <span className="truncate">{hunkLabel(h)}</span>
                          {h.old.length + h.count > 1 && (
                            <Button size="sm" variant="ghost" onPress={() => toggleLineView(`${f.path}#${i}`)} aria-label={byLine ? t('Fechar as linhas do trecho {n} de {path}', { n: i + 1, path: f.path }) : t('Escolher linhas do trecho {n} de {path}', { n: i + 1, path: f.path })}>
                              {byLine ? t('fechar linhas') : t('por linha')}
                            </Button>
                          )}
                        </span>
                        {byLine ? (
                          <span role="group" aria-label={t('Linhas do trecho {n} de {path}', { n: i + 1, path: f.path })} className="flex flex-col">
                            {[...h.old.map((l, k) => ['o' + k, '−', l] as const), ...now.map((l, k) => ['n' + k, '+', l] as const)].map(([key, sign, l]) => (
                              <Checkbox
                                key={key}
                                isSelected={lineOn(key)}
                                onChange={(on) => {
                                  if (on && !checked.has(f.path)) toggleGroup([f], true)
                                  toggleLine(f.path, i, key, on)
                                }}
                                aria-label={sign === '−' ? t('Incluir a linha apagada "{line}"', { line: l.trim() }) : t('Incluir a linha nova "{line}"', { line: l.trim() })}
                              >
                                <span className={cn('truncate', sign === '−' ? 'text-vcs-deleted' : 'text-vcs-added')}>
                                  {sign} {l}
                                </span>
                              </Checkbox>
                            ))}
                          </span>
                        ) : (
                          <>
                            {h.old.slice(0, 2).map((l, k) => (
                              <span key={'o' + k} className="block truncate text-vcs-deleted">
                                − {l}
                              </span>
                            ))}
                            {now.slice(0, 2).map((l, k) => (
                              <span key={'n' + k} className="block truncate text-vcs-added">
                                + {l}
                              </span>
                            ))}
                          </>
                        )}
                      </span>
                    </li>
                  )
                })}
                {chunks[f.path].hunks.length === 0 && <li className="text-xs text-text-muted">{t('Sem diferenças de linha (só espaços ou modo do arquivo).')}</li>}
              </ul>
            )}
            </div>
          )
        })}
      </div>
    )
  }

  let body
  if (!git) {
    body = <EmptyState title={t('Lendo o repositório…')}>{loading && <Spinner label={t('Lendo o repositório')} />}</EmptyState>
  } else if (!git.isRepo) {
    body = <EmptyState title={t('Esta pasta não é um repositório git')}>{t('Inicialize um repositório pelo terminal para versionar o projeto.')}</EmptyState>
  } else if (files.length === 0) {
    body = (
      <EmptyState title={t('Nada para commitar')}>
        {git.branch ? t('Tudo igual ao último commit em {branch}.', { branch: git.branch }) : t('Tudo igual ao último commit.')}
      </EmptyState>
    )
  } else {
    body = (
      <div className="py-1">
        {/* Chamadas como função, não como <Group />: um componente criado a cada render remontaria a lista e o
            arquivo focado perderia o foco (F6, setas). */}
        {Group({ title: t('Em conflito'), list: conflicted })}
        {changelists.map((l) => (
          <Fragment key={l.name}>{Group({ title: l.name, changelist: l.name, list: tracked.filter((f) => l.files.includes(f.path)) })}</Fragment>
        ))}
        {Group({ title: t('Mudanças'), list: tracked.filter((f) => !assigned.has(f.path)) })}
        {Group({ title: t('Não versionados'), list: untracked })}
      </div>
    )
  }

  const clOverlay = (
    <>
      {clMenu && (
        <ContextMenu
          x={clMenu.x}
          y={clMenu.y}
          label={t('Mover {path}', { path: clMenu.path })}
          items={[
            ...changelists.map((l) => ({ id: 'cl:' + l.name, label: t('Mover para {name}', { name: l.name }), disabled: l.files.includes(clMenu.path) })),
            { id: 'default', label: t('Mover para Mudanças'), disabled: !assigned.has(clMenu.path) },
            { id: 'new', label: t('Nova changelist…'), separatorBefore: true },
          ]}
          onAction={(id) => {
            const path = clMenu.path
            setClMenu(null)
            if (id === 'new') setNewCl({ path, name: '' })
            else moveToChangelist(path, id === 'default' ? null : id.slice(3))
          }}
          onClose={() => setClMenu(null)}
        />
      )}
      <Dialog
        title={t('Nova changelist')}
        isOpen={!!newCl}
        onOpenChange={(o) => !o && setNewCl(null)}
        footer={
          <>
            <Button onPress={() => setNewCl(null)}>{t('Cancelar')}</Button>
            <Button
              variant="primary"
              isDisabled={!newCl?.name.trim() || newCl.name.trim() === t('Mudanças') || changelists.some((l) => l.name === newCl.name.trim())}
              onPress={() => {
                moveToChangelist(newCl!.path, newCl!.name.trim())
                setNewCl(null)
              }}
            >
              {t('Criar e mover')}
            </Button>
          </>
        }
      >
        <TextField label={t('Nome da changelist')} value={newCl?.name ?? ''} onChange={(v) => setNewCl((c) => c && { ...c, name: v })} placeholder={t('ex.: refatoração do frete')} autoFocus />
        <p className="mt-2 text-xs text-text-muted">{t('{path} vai para ela. Cada changelist tem sua caixa: dá para commitar uma só.', { path: newCl?.path ?? '' })}</p>
      </Dialog>
    </>
  )

  return (
    <ToolWindowFrame
      side="left"
      actions={
        <>
          <IconButton label={t('Ver diff')} shortcut={keyLabel('Mod+D')} size="sm" icon={<FileDiff className="size-icon-sm" />} isDisabled={!focused} onPress={() => focused && openDiff(focused)} />
          <IconButton label={t('Guardar (stash)…')} size="sm" icon={<Archive className="size-icon-sm" />} isDisabled={!git?.isRepo || files.length === 0} onPress={() => useStashUi.setState({ save: true })} />
          <IconButton label={t('Recuperar stash…')} size="sm" icon={<ArchiveRestore className="size-icon-sm" />} isDisabled={!git?.isRepo} onPress={() => useStashUi.setState({ restore: true })} />
          <IconButton label={t('Atualizar')} size="sm" icon={<RefreshCw className="size-icon-sm" />} onPress={refreshGit} />
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        {git?.operation && (
          <Banner
            level="warning"
            actions={
              <>
                {conflicted.length > 0 ? (
                  <Button size="sm" variant="primary" onPress={() => useGitUi.getState().setConflictsOpen(true)}>
                    {t('Resolver conflitos…')}
                  </Button>
                ) : (
                  <Button size="sm" variant="primary" onPress={() => void useGitUi.getState().finish()}>
                    {t('Concluir {op}', { op: git.operation })}
                  </Button>
                )}
                <Button size="sm" onPress={() => useGitUi.getState().abort()}>
                  {t('Abortar')}
                </Button>
              </>
            }
          >
            {t('{op} em andamento:', { op: git.operation === 'merge' ? 'Merge' : git.operation === 'rebase' ? 'Rebase' : t('Operação') })}{' '}
            {conflicted.length > 0 ? t('{n} arquivo(s) em conflito.', { n: conflicted.length }) : t('conflitos resolvidos, falta concluir.')}
          </Banner>
        )}
        <div className="min-h-0 flex-1 overflow-auto">{body}</div>
        {git?.isRepo && (
          <div className="flex shrink-0 flex-col gap-2 border-t border-border p-3">
            <Checkbox isSelected={amend} onChange={setAmend}>
              {t('Emendar o último commit')}
            </Checkbox>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Checkbox isSelected={prefs['commit.format']} onChange={(v) => void savePrefs({ 'commit.format': v })}>
                {t('Formatar o código (gofmt e imports)')}
              </Checkbox>
              <Checkbox isSelected={prefs['commit.vet']} onChange={(v) => void savePrefs({ 'commit.vet': v })}>
                {t('Analisar com go vet')}
              </Checkbox>
              <Checkbox isSelected={prefs['commit.tests']} onChange={(v) => void savePrefs({ 'commit.tests': v })}>
                {t('Rodar os testes dos pacotes')}
              </Checkbox>
            </div>
            {history.length > 0 && (
              <div className="flex justify-end">
                <Menu
                  label={t('Mensagens recentes')}
                  trigger={<IconButton label={t('Mensagens recentes')} size="sm" icon={<History className="size-icon-sm" />} />}
                  items={history.map((m, i) => ({ id: String(i), label: m.split('\n')[0].slice(0, 80) }))}
                  onAction={(id) => setMessage(history[Number(id)])}
                />
              </div>
            )}
            <TextArea
              label={t('Mensagem do commit')}
              hideLabel
              value={message}
              onChange={setMessage}
              placeholder={t('Mensagem do commit ({key} para commitar)', { key: keyLabel('Mod+Enter') ?? '' })}
              rows={4}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault()
                  commit()
                }
              }}
            />
            {subject.length > SUBJECT_MAX && (
              <p className="text-xs text-warning">{t('A primeira linha tem {n} caracteres; o ideal é até {max}.', { n: subject.length, max: SUBJECT_MAX })}</p>
            )}
            <div className="flex items-center gap-2">
              <Button variant="primary" onPress={() => commit()} isDisabled={!canCommit} loading={busy}>
                {t('Commit')}
              </Button>
              <Button onPress={() => commit(true)} isDisabled={!canCommit}>
                {t('Commit e push…')}
              </Button>
            </div>
          </div>
        )}
      </div>
      <Dialog
        title={vetProblem?.what === 'tests' ? t('Testes falharam') : t('O go vet encontrou problemas')}
        isOpen={!!vetProblem}
        onOpenChange={(o) => !o && setVetProblem(null)}
        size="md"
        footer={
          <>
            <Button onPress={() => setVetProblem(null)}>{t('Voltar')}</Button>
            <Button
              variant="primary"
              onPress={() => {
                const p = vetProblem
                setVetProblem(null)
                void commit(p?.thenPush, true)
              }}
            >
              {t('Commitar mesmo assim')}
            </Button>
          </>
        }
      >
        <pre aria-label={vetProblem?.what === 'tests' ? t('Saída do go test') : t('Saída do go vet')} className="selectable max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-md bg-bg p-2 font-mono text-xs text-text">
          {vetProblem?.output}
        </pre>
      </Dialog>
      {clOverlay}
    </ToolWindowFrame>
  )
}
