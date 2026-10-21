// S24 Git > Log (Alt+9): histórico com grafo, filtros (texto, autor, branch, arquivo) e detalhes do commit com os
// arquivos alterados (duplo clique abre o diff daquele commit). O grafo vem calculado do backend.
// Botão direito (ou a tecla de menu) num commit: cherry-pick, revert, reset do branch atual até ele e copiar o hash.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Copy, FileClock, RefreshCw, X } from 'lucide-react'
import { Button as AriaButton } from 'react-aria-components'
import { create } from 'zustand'
import { api, type Branches, type CommitDetails, type LogCommit, type LogFilter, type LogPage } from '../lib/api'
import { on } from '../lib/events'
import { Button, IconButton, Menu, TextField } from '../design/controls'
import { ContextMenu } from '../design/ContextMenu'
import { Dialog, EmptyState, Spinner, toast } from '../design/feedback'
import { afterDiskChange, useGitUi } from '../state/git'
import { useRebaseUi } from '../git/RebaseDialog'
import { cn } from '../design/cn'
import { ToolWindowFrame } from '../shell/ToolWindows'
import { useLayout } from '../shell/layout'
import { useApp } from '../state/app'
import { useDocs } from '../editor/docs'
import { lang, t } from '../i18n'

const ROW = 24 // h-row
const LANE = 14 // largura de uma coluna do grafo
const PAGE = 500

// Cores das colunas do grafo (spec do CommitGraph: derivadas dos tokens).
const LANE_COLORS = ['accent-text', 'success', 'warning', 'danger', 'vcs-modified', 'syntax-keyword', 'syntax-type', 'syntax-param'].map((c) => `var(--color-${c})`)

const EMPTY: LogFilter = { text: '', author: '', branch: '', path: '', follow: false }

interface LogUi {
  filter: LogFilter
  selected: string | null
  /** Commit a mostrar assim que aparecer na lista (vindo do blame). */
  reveal: string | null
}

export const useGitLog = create<LogUi>(() => ({ filter: EMPTY, selected: null, reveal: null }))

/** Abre o Log filtrado pelo histórico de um arquivo (atravessa renomes). */
export function showFileHistory(path: string) {
  useGitLog.setState({ filter: { ...EMPTY, path, follow: true }, selected: null })
  useLayout.getState().show('git')
}

/** Abre o Log no commit (clique na anotação do blame). */
export function showCommit(hash: string) {
  const { filter } = useGitLog.getState()
  useGitLog.setState({ reveal: hash, selected: hash, filter: filter.path || filter.text || filter.author ? filter : EMPTY })
  useLayout.getState().show('git')
}

const dateFmt = new Intl.DateTimeFormat(lang, { day: '2-digit', month: '2-digit', year: 'numeric' })
const timeFmt = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' })
export function formatDate(ms: number) {
  const d = new Date(ms)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return t('Hoje {time}', { time: timeFmt.format(d) })
  const y = new Date(today.getTime() - 86_400_000)
  if (d.toDateString() === y.toDateString()) return t('Ontem {time}', { time: timeFmt.format(d) })
  return `${dateFmt.format(d)} ${timeFmt.format(d)}`
}

const refStyle: Record<LogCommit['refs'][number]['kind'], string> = {
  head: 'bg-warning-bg text-warning',
  local: 'bg-success-bg text-success',
  remote: 'bg-selection text-accent-text',
  tag: 'border border-border text-text-muted',
}

function Graph({ c, width }: { c: LogCommit; width: number }) {
  const x = (col: number) => col * LANE + LANE / 2
  const y = (v: number) => (v * ROW) / 2
  return (
    <svg width={Math.max(1, width) * LANE} height={ROW} className="shrink-0" aria-hidden>
      {c.lines.map((s, i) => {
        const [x1, y1, x2, y2] = [x(s.x1), y(s.y1), x(s.x2), y(s.y2)]
        const d = x1 === x2 ? `M${x1} ${y1}L${x2} ${y2}` : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`
        return <path key={i} d={d} fill="none" stroke={LANE_COLORS[s.color % LANE_COLORS.length]} strokeWidth={2} />
      })}
      <circle cx={x(c.node)} cy={ROW / 2} r={4} fill={LANE_COLORS[c.color % LANE_COLORS.length]} stroke="var(--color-surface)" strokeWidth={1.5} />
    </svg>
  )
}

const inputCls =
  'h-control-sm min-w-0 rounded-md border border-border-input bg-bg px-2 text-xs text-text placeholder:text-text-muted outline-none focus:border-focus focus:ring-2 focus:ring-focus'

export function GitLogPanel() {
  const project = useApp((s) => s.project)!
  const isRepo = useApp((s) => s.git?.isRepo)
  const { filter, selected, reveal } = useGitLog()
  const setFilter = (f: Partial<LogFilter>) => useGitLog.setState((s) => ({ filter: { ...s.filter, ...f } }))
  const [text, setText] = useState(filter.text)
  const [author, setAuthor] = useState(filter.author)
  const [page, setPage] = useState<LogPage | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const [error, setError] = useState<string | null>(null)
  const [branches, setBranches] = useState<Branches | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => setText(filter.text), [filter.text])
  useEffect(() => setAuthor(filter.author), [filter.author])
  // Campos de texto filtram depois de uma pausa na digitação.
  useEffect(() => {
    const timer = setTimeout(() => (text !== filter.text || author !== filter.author) && setFilter({ text, author }), 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, author])

  useEffect(() => setLimit(PAGE), [filter])
  useEffect(() => {
    if (!isRepo) return
    let stale = false
    api.Git.Log(project.id, filter, limit)
      .then((p) => {
        if (stale) return
        setPage(p)
        setError(null)
      })
      .catch((e) => !stale && setError((e as Error).message))
    return () => {
      stale = true
    }
  }, [project.id, filter, limit, tick, isRepo])

  // Commits novos (commit, update, troca de branch): recarrega.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = on('git:status', ({ projectId }) => {
      if (projectId !== project.id) return
      clearTimeout(timer)
      timer = setTimeout(() => setTick((n) => n + 1), 400)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [project.id])

  useEffect(() => {
    if (isRepo) api.Git.Branches(project.id).then(setBranches, () => {})
  }, [project.id, tick, isRepo])

  // Commit pedido pelo blame: carrega mais até achar (ou até o máximo).
  useEffect(() => {
    if (!reveal || !page) return
    if (page.commits.some((c) => c.hash === reveal)) {
      useGitLog.setState({ selected: reveal, reveal: null })
    } else if (page.hasMore && limit < 5000) {
      setLimit((l) => Math.min(5000, l * 2))
    } else {
      useGitLog.setState({ reveal: null })
      toast('info', t('Commit fora da lista'), t('Ele não aparece com os filtros atuais.'))
    }
  }, [reveal, page, limit])

  const commits = page?.commits ?? []
  const activeIndex = commits.findIndex((c) => c.hash === selected)
  const [menu, setMenu] = useState<{ x: number; y: number; c: LogCommit } | null>(null)
  const [hardReset, setHardReset] = useState<LogCommit | null>(null)
  const [tagFor, setTagFor] = useState<LogCommit | null>(null)
  const [tagName, setTagName] = useState('')
  const [tagMsg, setTagMsg] = useState('')
  const [tagError, setTagError] = useState<string>()
  const createTag = async () => {
    if (!tagFor) return
    try {
      await api.Git.CreateTag(project.id, tagName.trim(), tagFor.hash, tagMsg)
      toast('success', t('Tag {name} criada', { name: tagName.trim() }), tagFor.hash.slice(0, 7))
      setTagFor(null)
    } catch (e) {
      setTagError((e as Error).message)
    }
  }
  const commitAction = async (id: string, c: LogCommit) => {
    if (id === 'rebase') return useRebaseUi.setState({ base: c })
    if (id === 'tag-new') {
      setTagName('')
      setTagMsg('')
      setTagError(undefined)
      return setTagFor(c)
    }
    if (id.startsWith('tag-del:')) {
      const name = id.slice(8)
      return api.Git.DeleteTag(project.id, name).then(
        () => toast('success', t('Tag {name} apagada', { name }), t('Só a local; a do remoto, se houver, continua.')),
        (e) => toast('danger', t('Não foi possível apagar a tag'), (e as Error).message),
      )
    }
    if (id === 'copy') {
      await navigator.clipboard?.writeText(c.hash).catch(() => {})
      return toast('success', t('Hash copiado'), c.hash.slice(0, 7))
    }
    if (id === 'reset-hard') return setHardReset(c)
    const short = c.hash.slice(0, 7)
    try {
      const res =
        id === 'cherry-pick'
          ? await api.Git.CherryPick(project.id, c.hash)
          : id === 'revert'
            ? await api.Git.Revert(project.id, c.hash)
            : await api.Git.Reset(project.id, c.hash, id === 'reset-soft' ? 'soft' : id === 'reset-mixed' ? 'mixed' : 'hard')
      await afterDiskChange()
      if (res.conflicts?.length) {
        useGitUi.getState().setConflictsOpen(true)
        toast('warning', t('Conflito no {op} de {hash}', { op: id === 'revert' ? 'revert' : 'cherry-pick', hash: short }), t('Resolva os arquivos e continue (ou cancele) pela janela de conflitos.'))
      } else if (!res.ok) toast('warning', t('Não foi feito'), res.message)
      else toast('success', res.message)
    } catch (e) {
      toast('danger', t('O git recusou'), (e as Error).message)
    }
  }
  const select = (i: number) => commits[i] && useGitLog.setState({ selected: commits[i].hash })

  const filtered = !!(filter.text || filter.author || filter.branch || filter.path)
  const branchItems = [
    { id: '*', label: t('Todas as branches') },
    ...(branches?.local ?? []).map((b) => ({ id: b.name, label: b.name, separatorBefore: false })),
    ...(branches?.remote ?? []).map((b, i) => ({ id: b.name, label: b.name, separatorBefore: i === 0 })),
  ]

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1">
      <input aria-label={t('Filtrar por mensagem')} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Mensagem')} className={cn(inputCls, 'w-[14rem]')} />
      <input aria-label={t('Filtrar por autor')} value={author} onChange={(e) => setAuthor(e.target.value)} placeholder={t('Autor')} className={cn(inputCls, 'w-[9rem]')} />
      <Menu
        label={t('Branch')}
        trigger={
          <AriaButton
            aria-label={t('Branch: {name}', { name: filter.branch || t('todas') })}
            className="flex h-control-sm items-center gap-1 rounded-md px-2 text-xs text-text outline-none data-[hovered]:bg-hover data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus"
          >
            {t('Branch: {name}', { name: filter.branch || t('todas') })} <ChevronDown className="size-3 text-text-muted" aria-hidden />
          </AriaButton>
        }
        items={branchItems}
        onAction={(id) => setFilter({ branch: id === '*' ? '' : id })}
      />
      {filter.path && (
        <span className="flex h-control-sm items-center gap-1 rounded-md bg-selection pl-2 text-xs text-text">
          <FileClock className="size-3" aria-hidden />
          {t('Arquivo: {path}', { path: filter.path })}
          <IconButton label={t('Tirar o filtro de arquivo')} size="sm" icon={<X className="size-3" />} onPress={() => setFilter({ path: '', follow: false })} />
        </span>
      )}
      {filtered && (
        <button type="button" className="text-xs text-accent-text hover:underline" onClick={() => useGitLog.setState({ filter: EMPTY })}>
          {t('Limpar filtros')}
        </button>
      )}
      <span className="ml-auto text-xs text-text-muted">{page && t('{n} commits', { n: `${page.commits.length}${page.hasMore ? '+' : ''}` })}</span>
      <IconButton label={t('Recarregar')} size="sm" icon={<RefreshCw className="size-icon-sm" />} onPress={() => setTick((n) => n + 1)} />
    </div>
  )

  let body
  if (!isRepo) body = <EmptyState title={t('Sem repositório git')}>{t('O projeto não está dentro de um repositório git.')}</EmptyState>
  else if (error) body = <EmptyState title={t('Não foi possível ler o histórico')}>{error}</EmptyState>
  else if (!page)
    body = (
      <div className="flex h-full items-center justify-center">
        <Spinner label={t('Lendo o histórico')} />
      </div>
    )
  else if (commits.length === 0)
    body = <EmptyState title={filtered ? t('Nenhum commit com esses filtros') : t('Nenhum commit ainda')}>{filtered ? t('Mude ou limpe os filtros.') : t('Faça o primeiro commit pela janela Commit (Ctrl+K).')}</EmptyState>
  else
    body = (
      <div className="flex min-h-0 flex-1">
        <CommitGrid
          commits={commits}
          width={page.width}
          active={activeIndex}
          onSelect={select}
          onMenu={(i, x, y) => {
            select(i)
            setMenu({ x, y, c: commits[i] })
          }}
          onEnd={() => page.hasMore && setLimit((l) => Math.min(5000, l + PAGE))}
        />
        <div className="w-[40%] min-w-[16rem] shrink-0 border-l border-border">{selected ? <Details hash={selected} /> : <EmptyState title={t('Escolha um commit')}>{t('Os detalhes e os arquivos alterados aparecem aqui.')}</EmptyState>}</div>
      </div>
    )

  return (
    <ToolWindowFrame side="bottom">
      <div className="flex h-full flex-col">
        {isRepo && toolbar}
        {body}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={t('Commit {hash}', { hash: menu.c.hash.slice(0, 7) })}
          items={[
            { id: 'cherry-pick', label: t('Cherry-pick no branch atual') },
            { id: 'revert', label: t('Reverter o commit') },
            { id: 'rebase', label: t('Rebase interativo a partir daqui…') },
            { id: 'reset-soft', label: t('Reset até aqui (soft: mantém as mudanças preparadas)'), separatorBefore: true },
            { id: 'reset-mixed', label: t('Reset até aqui (mixed: mantém as mudanças no disco)') },
            { id: 'reset-hard', label: t('Reset até aqui (hard: descarta as mudanças)…'), danger: true },
            { id: 'tag-new', label: t('Nova tag aqui…'), separatorBefore: true },
            ...menu.c.refs.filter((r) => r.kind === 'tag').map((r) => ({ id: 'tag-del:' + r.name, label: t('Apagar a tag {name}', { name: r.name }), danger: true })),
            { id: 'copy', label: t('Copiar o hash'), separatorBefore: true },
          ]}
          onAction={(id) => void commitAction(id, menu.c)}
          onClose={() => setMenu(null)}
        />
      )}
      <Dialog
        title={t('Nova tag em {hash}', { hash: tagFor?.hash.slice(0, 7) ?? '' })}
        isOpen={!!tagFor}
        onOpenChange={(o) => !o && setTagFor(null)}
        footer={
          <>
            <Button onPress={() => setTagFor(null)}>{t('Cancelar')}</Button>
            <Button variant="primary" isDisabled={!tagName.trim()} onPress={() => void createTag()}>
              {t('Criar tag')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <TextField label={t('Nome da tag')} value={tagName} onChange={(v) => (setTagName(v), setTagError(undefined))} error={tagError} placeholder={t('ex.: v1.2.0')} autoFocus onKeyDown={(e) => e.key === 'Enter' && tagName.trim() && void createTag()} />
          <TextField label={t('Mensagem (opcional)')} value={tagMsg} onChange={setTagMsg} description={t('Com mensagem, a tag é anotada (guarda autor e data).')} />
        </div>
      </Dialog>
      <Dialog
        title={t('Reset hard?')}
        isOpen={!!hardReset}
        onOpenChange={(o) => !o && setHardReset(null)}
        footer={
          <>
            <Button onPress={() => setHardReset(null)}>{t('Cancelar')}</Button>
            <Button
              variant="danger"
              onPress={() => {
                const c = hardReset!
                setHardReset(null)
                void commitAction('reset-hard-ok', c)
              }}
            >
              {t('Descartar e mover')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">
          {t('O branch atual vai para')} <span className="font-mono">{hardReset?.hash.slice(0, 7)}</span>{' '}
          {t('({subject}) e as mudanças não commitadas e os commits depois dele somem do branch.', { subject: hardReset?.subject ?? '' })}
        </p>
      </Dialog>
    </ToolWindowFrame>
  )
}

function CommitGrid({
  commits,
  width,
  active,
  onSelect,
  onMenu,
  onEnd,
}: {
  commits: LogCommit[]
  width: number
  active: number
  onSelect: (i: number) => void
  onMenu: (i: number, x: number, y: number) => void
  onEnd: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState(0)
  const [height, setHeight] = useState(200)
  useLayoutEffect(() => {
    const el = box.current!
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    const el = box.current
    if (!el || active < 0) return
    const top = active * ROW
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight
  }, [active])
  const from = Math.max(0, Math.floor(scroll / ROW) - 5)
  const to = Math.min(commits.length, Math.ceil((scroll + height) / ROW) + 5)
  useEffect(() => {
    if (to >= commits.length - 20) onEnd()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, commits.length])

  return (
    <div
      ref={box}
      role="grid"
      aria-label={t('Commits')}
      aria-rowcount={commits.length}
      aria-activedescendant={active >= 0 ? `log-row-${active}` : undefined}
      tabIndex={0}
      data-autofocus
      onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') onSelect(Math.min(commits.length - 1, active + 1))
        else if (e.key === 'ArrowUp') onSelect(Math.max(0, active - 1))
        else if (e.key === 'Home') onSelect(0)
        else if (e.key === 'End') onSelect(commits.length - 1)
        else if (e.key === 'ContextMenu' && active >= 0) {
          const r = document.getElementById(`log-row-${active}`)?.getBoundingClientRect()
          onMenu(active, (r?.left ?? 0) + 40, (r?.bottom ?? 0))
        } else return
        e.preventDefault()
      }}
      className="relative min-w-0 flex-1 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
    >
      <div style={{ height: commits.length * ROW }} className="relative" role="rowgroup">
        {commits.slice(from, to).map((c, k) => {
          const i = from + k
          return (
            <div
              key={c.hash}
              id={`log-row-${i}`}
              role="row"
              aria-rowindex={i + 1}
              aria-selected={i === active}
              aria-label={`${c.subject}, ${c.author}, ${formatDate(c.date)}${c.refs.length ? ', ' + c.refs.map((r) => r.name).join(', ') : ''}`}
              onClick={() => onSelect(i)}
              onContextMenu={(e) => {
                e.preventDefault()
                onMenu(i, e.clientX, e.clientY)
              }}
              style={{ top: i * ROW, height: ROW }}
              className={cn('absolute inset-x-0 flex cursor-default items-center gap-2 pr-3 text-sm', i === active ? 'bg-selection' : 'hover:bg-hover')}
            >
              <div role="gridcell" className="flex min-w-0 flex-1 items-center gap-2">
                <Graph c={c} width={width} />
                {c.refs.map((r) => (
                  <span key={r.kind + r.name} className={cn('shrink-0 rounded-xs px-1 text-2xs', refStyle[r.kind])}>
                    {r.name}
                  </span>
                ))}
                <span className="truncate text-text">{c.subject}</span>
              </div>
              <div role="gridcell" className="w-[9rem] shrink-0 truncate text-xs text-text-muted">
                {c.author}
              </div>
              <div role="gridcell" className="w-[8.5rem] shrink-0 text-right text-xs tabular-nums text-text-muted">
                {formatDate(c.date)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const kindStyle: Record<string, { cls: string; label: string }> = {
  added: { cls: 'text-vcs-added', label: t('adicionado') },
  modified: { cls: 'text-vcs-modified', label: t('modificado') },
  deleted: { cls: 'text-vcs-deleted line-through', label: t('apagado') },
  renamed: { cls: 'text-vcs-modified', label: t('renomeado') },
}

function Details({ hash }: { hash: string }) {
  const project = useApp((s) => s.project)!
  const openDiff = useDocs((s) => s.openDiff)
  const [d, setD] = useState<CommitDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let stale = false
    setD(null)
    setError(null)
    api.Git.CommitDetails(project.id, hash).then(
      (x) => !stale && setD(x),
      (e) => !stale && setError((e as Error).message),
    )
    return () => {
      stale = true
    }
  }, [project.id, hash])
  const [subject, ...rest] = useMemo(() => (d?.message ?? '').split('\n'), [d])

  if (error) return <EmptyState title={t('Não foi possível ler o commit')}>{error}</EmptyState>
  if (!d)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label={t('Carregando o commit')} />
      </div>
    )
  return (
    <section aria-label={t('Detalhes do commit')} className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-border px-3 py-2">
        <p className="text-sm font-semibold text-text">{subject}</p>
        {rest.join('\n').trim() && <p className="selectable mt-1 whitespace-pre-wrap text-xs text-text">{rest.join('\n').trim()}</p>}
        <p className="mt-2 flex items-center gap-1 text-xs text-text-muted">
          <span className="selectable font-mono">{d.hash.slice(0, 10)}</span>
          <IconButton
            label={t('Copiar hash')}
            size="sm"
            icon={<Copy className="size-3" />}
            onPress={() => void navigator.clipboard?.writeText(d.hash).then(() => toast('success', t('Hash copiado')))}
          />
          · {d.author} &lt;{d.email}&gt; · {formatDate(d.date)}
        </p>
        {d.branches.length > 0 && <p className="mt-1 text-xs text-text-muted">{t('Em: {branches}', { branches: d.branches.join(', ') })}</p>}
      </div>
      <ul aria-label={t('Arquivos alterados')} className="flex flex-col py-1">
        {d.files.map((f) => {
          const k = kindStyle[f.kind] ?? kindStyle.modified
          const open = () => !f.outside && openDiff(f.path, { rev: d.hash, oldPath: f.oldPath || undefined })
          return (
            <li key={f.path}>
              <button
                type="button"
                disabled={f.outside}
                onDoubleClick={open}
                onKeyDown={(e) => e.key === 'Enter' && open()}
                title={f.outside ? t('Fora da pasta do projeto') : t('Duplo clique ou Enter: ver o diff')}
                aria-label={`${f.path}, ${k.label}${f.oldPath ? t(', antes {path}', { path: f.oldPath }) : ''}`}
                className="flex h-row w-full items-center gap-2 px-3 text-left text-sm outline-none hover:bg-hover focus-visible:bg-selection disabled:opacity-60"
              >
                <span className={cn('truncate', k.cls)}>{f.path.split('/').pop()}</span>
                <span className="min-w-0 truncate text-xs text-text-muted">{f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''}</span>
                {f.oldPath && <span className="shrink-0 text-xs text-text-muted">← {f.oldPath}</span>}
              </button>
            </li>
          )
        })}
        {d.files.length === 0 && <li className="px-3 py-1 text-xs text-text-muted">{t('Nenhum arquivo alterado (commit vazio ou merge sem mudanças).')}</li>}
      </ul>
    </section>
  )
}
