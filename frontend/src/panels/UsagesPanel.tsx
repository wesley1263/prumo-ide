// S09 Usos (Alt+F7): os lugares onde o símbolo aparece, agrupados em declaração, escrita e leitura e, dentro de
// cada grupo, por arquivo. Cada busca vira uma aba (as últimas 5). Enter ou duplo clique abre no editor.
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FileCode2, RotateCw, X } from 'lucide-react'
import { create } from 'zustand'
import type { monaco } from '../editor/monaco'
import { findUsages, type Usage } from '../editor/lsp/adapter'
import { useDocs } from '../editor/docs'
import { useLayout } from '../shell/layout'
import { ToolWindowFrame } from '../shell/ToolWindows'
import { IconButton } from '../design/controls'
import { EmptyState, toast } from '../design/feedback'
import { cn } from '../design/cn'
import { keyLabel } from '../lib/keymap'
import { t, tn } from '../i18n'

interface Hit extends Usage {
  path: string // relativo ao projeto (ou o caminho de fora, para a stdlib)
  line: number // 1-based
  col: number
  preview: string
  start: number // trecho do símbolo em preview
  end: number
}

interface Search {
  id: number
  symbol: string
  origin: { uri: string; line: number; character: number }
  hits: Hit[]
}

const useUsages = create<{ searches: Search[]; active: number | null }>(() => ({ searches: [], active: null }))
let seq = 0

const KIND_TITLE: Record<Usage['kind'], string> = { declaration: t('Declaração'), write: t('Escrita'), read: t('Leitura') }

async function collect(uri: string, line: number, character: number): Promise<Hit[] | null> {
  const docs = useDocs.getState()
  const root = 'file://' + docs.root + '/'
  const found = await findUsages(uri, line, character)
  if (!found) return null
  const hits: Hit[] = []
  for (const u of found) {
    const model = await docs.ensureModel(u.uri)
    const text = model?.getLineContent(u.range.start.line + 1) ?? ''
    const lead = text.length - text.trimStart().length
    const decoded = decodeURIComponent(u.uri)
    hits.push({
      ...u,
      path: decoded.startsWith(root) ? decoded.slice(root.length) : decoded.replace(/^file:\/\//, ''),
      line: u.range.start.line + 1,
      col: u.range.start.character + 1,
      preview: text.trim(),
      start: Math.max(0, u.range.start.character - lead),
      end: Math.max(0, (u.range.start.line === u.range.end.line ? u.range.end.character : text.length) - lead),
    })
  }
  const order = { declaration: 0, write: 1, read: 2 }
  hits.sort((a, b) => order[a.kind] - order[b.kind] || a.path.localeCompare(b.path) || a.line - b.line || a.col - b.col)
  return hits
}

/** Alt+F7 no editor: busca os usos do símbolo sob o cursor e mostra a janela. */
export async function showUsages(editor: monaco.editor.ICodeEditor) {
  const model = editor.getModel()
  const pos = editor.getPosition()
  if (!model || !pos) return
  const word = model.getWordAtPosition(pos)
  if (!word) return toast('info', t('Nada para buscar aqui'), t('Ponha o cursor num nome (função, tipo, variável).'))
  const origin = { uri: model.uri.toString(), line: pos.lineNumber - 1, character: pos.column - 1 }
  const hits = await collect(origin.uri, origin.line, origin.character)
  if (!hits) return toast('info', t('O gopls ainda não está pronto'), t('Tente de novo em alguns segundos.'))
  const s: Search = { id: ++seq, symbol: word.word, origin, hits }
  useUsages.setState((st) => ({ searches: [s, ...st.searches].slice(0, 5), active: s.id }))
  useLayout.getState().show('find')
}

async function rerun(s: Search) {
  const hits = await collect(s.origin.uri, s.origin.line, s.origin.character)
  if (hits) useUsages.setState((st) => ({ searches: st.searches.map((x) => (x.id === s.id ? { ...x, hits } : x)) }))
}

type Row = { type: 'group'; kind: Usage['kind']; count: number } | { type: 'file'; key: string; path: string; count: number } | { type: 'hit'; hit: Hit }

export function UsagesPanel() {
  const { searches, active } = useUsages()
  const search = searches.find((s) => s.id === active) ?? searches[0]
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [focus, setFocus] = useState(0)

  useEffect(() => setFocus(0), [search?.id])

  // Linhas visíveis da árvore: grupo → arquivo → ocorrências.
  const rows = useMemo<Row[]>(() => {
    if (!search) return []
    const out: Row[] = []
    for (const kind of ['declaration', 'write', 'read'] as const) {
      const list = search.hits.filter((h) => h.kind === kind)
      if (!list.length) continue
      out.push({ type: 'group', kind, count: list.length })
      if (collapsed.has(kind)) continue
      const files = [...new Set(list.map((h) => h.path))]
      for (const path of files) {
        const inFile = list.filter((h) => h.path === path)
        const key = kind + ':' + path
        out.push({ type: 'file', key, path, count: inFile.length })
        if (collapsed.has(key)) continue
        for (const hit of inFile) out.push({ type: 'hit', hit })
      }
    }
    return out
  }, [search, collapsed])

  const open = (h: Hit) => void useDocs.getState().openUri(h.uri, h.line, h.col)
  const toggle = (k: string) =>
    setCollapsed((c) => {
      const n = new Set(c)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  const keyOfRow = (r: Row) => (r.type === 'group' ? r.kind : r.type === 'file' ? r.key : `${r.hit.uri}:${r.hit.line}:${r.hit.col}`)
  const closeSearch = (id: number) => useUsages.setState((st) => ({ searches: st.searches.filter((s) => s.id !== id), active: st.active === id ? null : st.active }))

  const actions = (
    <div className="flex min-w-0 items-center gap-1">
      <div role="tablist" aria-label={t('Buscas de usos')} className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {searches.map((s) => (
          <div
            key={s.id}
            role="tab"
            tabIndex={0}
            aria-selected={s.id === search?.id}
            onClick={() => useUsages.setState({ active: s.id })}
            onKeyDown={(e) => e.key === 'Enter' && useUsages.setState({ active: s.id })}
            className={cn('group flex h-control-sm shrink-0 items-center gap-1.5 rounded-md px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-focus', s.id === search?.id ? 'bg-selection text-text' : 'text-text-muted hover:bg-hover')}
          >
            {t('Usos de {name}', { name: s.symbol })}
            <span aria-hidden title={t('Fechar')} onClick={(e) => (e.stopPropagation(), closeSearch(s.id))} className="rounded-xs opacity-0 hover:bg-pressed group-hover:opacity-100">
              <X className="size-3" />
            </span>
          </div>
        ))}
      </div>
      {search && <IconButton label={t('Buscar de novo')} size="sm" icon={<RotateCw className="size-icon-sm" />} onPress={() => void rerun(search)} />}
    </div>
  )

  if (!search)
    return (
      <ToolWindowFrame side="bottom" actions={actions}>
        <EmptyState title={t('Nenhuma busca de usos')}>
          {t('Ponha o cursor num nome no editor e use {key} para ver onde ele é declarado, escrito e lido.', { key: keyLabel('Alt+F7') ?? '' })}
        </EmptyState>
      </ToolWindowFrame>
    )

  const total = search.hits.length
  const files = new Set(search.hits.map((h) => h.path)).size
  return (
    <ToolWindowFrame side="bottom" actions={actions}>
      <div className="flex h-full flex-col">
        <p role="status" className="px-3 py-1 text-xs text-text-muted">
          {tn(total, '{n} uso de', '{n} usos de')} <span className="font-mono text-text">{search.symbol}</span> {tn(files, 'em {n} arquivo', 'em {n} arquivos')}
        </p>
        <ul
          role="tree"
          aria-label={t('Usos de {name}', { name: search.symbol })}
          tabIndex={0}
          aria-activedescendant={rows[focus] ? `usage-${focus}` : undefined}
          data-autofocus
          onKeyDown={(e) => {
            const r = rows[focus]
            if (e.key === 'ArrowDown') setFocus((f) => Math.min(rows.length - 1, f + 1))
            else if (e.key === 'ArrowUp') setFocus((f) => Math.max(0, f - 1))
            else if (e.key === 'Enter' && r?.type === 'hit') open(r.hit)
            else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && r && r.type !== 'hit') {
              const k = keyOfRow(r)
              if ((e.key === 'ArrowLeft') !== collapsed.has(k)) toggle(k)
            } else return
            e.preventDefault()
          }}
          className="min-h-0 flex-1 overflow-y-auto pb-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
        >
          {rows.map((r, i) => {
            const base = cn('flex h-row cursor-default items-center gap-1.5 pr-3 text-sm', i === focus && 'bg-selection')
            if (r.type === 'group')
              return (
                <li key={keyOfRow(r)} id={`usage-${i}`} role="treeitem" aria-level={1} aria-expanded={!collapsed.has(r.kind)} aria-selected={i === focus} onClick={() => (setFocus(i), toggle(r.kind))} className={cn(base, 'pl-2 font-semibold text-text')}>
                  {collapsed.has(r.kind) ? <ChevronRight className="size-icon-sm" aria-hidden /> : <ChevronDown className="size-icon-sm" aria-hidden />}
                  {KIND_TITLE[r.kind]} <span className="font-normal text-text-muted">({r.count})</span>
                </li>
              )
            if (r.type === 'file')
              return (
                <li key={r.key} id={`usage-${i}`} role="treeitem" aria-level={2} aria-expanded={!collapsed.has(r.key)} aria-selected={i === focus} onClick={() => (setFocus(i), toggle(r.key))} className={cn(base, 'pl-6 text-text')}>
                  {collapsed.has(r.key) ? <ChevronRight className="size-icon-sm" aria-hidden /> : <ChevronDown className="size-icon-sm" aria-hidden />}
                  <FileCode2 className="size-icon-sm shrink-0 text-accent-text" aria-hidden />
                  <span className="truncate">{r.path}</span>
                  <span className="text-xs text-text-muted">({r.count})</span>
                </li>
              )
            const h = r.hit
            return (
              <li
                key={keyOfRow(r)}
                id={`usage-${i}`}
                role="treeitem"
                aria-level={3}
                aria-selected={i === focus}
                aria-label={t('{path} linha {line}: {preview}', { path: h.path, line: h.line, preview: h.preview })}
                onClick={() => setFocus(i)}
                onDoubleClick={() => open(h)}
                className={cn(base, 'pl-12 font-mono')}
              >
                <span className="w-[3rem] shrink-0 text-right text-xs tabular-nums text-text-muted">{h.line}</span>
                <span className="min-w-0 truncate whitespace-pre text-text">
                  {h.preview.slice(0, h.start)}
                  <mark className={cn('rounded-xs text-text', h.kind === 'write' ? 'bg-diff-modified-bg' : 'bg-search-match-bg')}>{h.preview.slice(h.start, h.end)}</mark>
                  {h.preview.slice(h.end)}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </ToolWindowFrame>
  )
}
