// S06 Buscar em tudo: arquivos (índice do backend), símbolos (gopls) e ações (registro de atalhos).
// Shift duas vezes abre em "Tudo"; Ctrl+Shift+N, Ctrl+Alt+Shift+N e Ctrl+Shift+A abrem direto na aba.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Dialog as AriaDialog, Modal, ModalOverlay } from 'react-aria-components'
import { Box, Braces, File, Search, SquareFunction, Type, Variable, Zap } from 'lucide-react'
import { api, type FileHit } from '../lib/api'
import { allActions, keyLabel, type Action } from '../lib/keymap'
import { workspaceSymbols, type WorkspaceSymbol } from '../editor/lsp/adapter'
import { useDocs } from '../editor/docs'
import { useApp } from '../state/app'
import { cn } from '../design/cn'
import { Kbd } from '../design/controls'
import { fold, splitLine, useSearchUi, type EverywhereTab } from './state'
import { lang, t } from '../i18n'

const TABS: Array<{ id: EverywhereTab; label: string; keys?: string }> = [
  { id: 'all', label: t('Tudo') },
  { id: 'files', label: t('Arquivos'), keys: 'Mod+Shift+N' },
  { id: 'symbols', label: t('Símbolos'), keys: 'Mod+Alt+Shift+N' },
  { id: 'actions', label: t('Ações'), keys: 'Mod+Shift+A' },
]

interface Item {
  id: string
  group: 'files' | 'symbols' | 'actions'
  label: string
  marks?: number[] // índices destacados em label
  detail?: string
  hint?: string // à direita (atalho, pacote)
  icon: ReactNode
  run: () => void
}

const GROUP_TITLE = { files: t('Arquivos'), symbols: t('Símbolos'), actions: t('Ações') }
const ALL_LIMIT = { files: 8, symbols: 8, actions: 6 }

// SymbolKind do LSP → ícone e nome lido pelo leitor de tela.
function symbolIcon(kind: number): { icon: ReactNode; name: string } {
  const c = 'size-icon-sm shrink-0'
  switch (kind) {
    case 6:
      return { icon: <SquareFunction className={cn(c, 'text-accent-text')} aria-hidden />, name: t('método') }
    case 12:
      return { icon: <SquareFunction className={cn(c, 'text-accent-text')} aria-hidden />, name: t('função') }
    case 5:
    case 23:
      return { icon: <Box className={cn(c, 'text-warning')} aria-hidden />, name: t('struct') }
    case 11:
      return { icon: <Braces className={cn(c, 'text-success')} aria-hidden />, name: t('interface') }
    case 13:
    case 14:
    case 8:
    case 7:
      return { icon: <Variable className={cn(c, 'text-text-muted')} aria-hidden />, name: kind === 14 ? t('constante') : kind === 8 ? t('campo') : t('variável') }
    default:
      return { icon: <Type className={cn(c, 'text-text-muted')} aria-hidden />, name: t('tipo') }
  }
}

function Marked({ text, marks }: { text: string; marks?: number[] }) {
  if (!marks?.length) return <>{text}</>
  const set = new Set(marks)
  const out: ReactNode[] = []
  let run = ''
  let bold = false
  const flush = (k: number) => {
    if (!run) return
    out.push(bold ? <b key={k} className="font-semibold text-accent-text">{run}</b> : <span key={k}>{run}</span>)
    run = ''
  }
  for (let i = 0; i < text.length; i++) {
    const b = set.has(i)
    if (b !== bold) {
      flush(i)
      bold = b
    }
    run += text[i]
  }
  flush(text.length)
  return <>{out}</>
}

function fileItem(path: string, marks: number[], open: () => void): Item {
  const cut = path.lastIndexOf('/') + 1
  return {
    id: 'f:' + path,
    group: 'files',
    label: path.slice(cut),
    marks: marks.filter((m) => m >= cut).map((m) => m - cut),
    detail: cut ? path.slice(0, cut - 1) : undefined,
    icon: <File className="size-icon-sm shrink-0 text-text-muted" aria-hidden />,
    run: open,
  }
}

/** Ação com o título que casa com a consulta (palavras em qualquer ordem, sem acento). */
function matchAction(a: Action, words: string[]): number {
  const title = fold(a.title)
  let score = 0
  for (const w of words) {
    const i = title.indexOf(w)
    if (i < 0) return -1
    score += i === 0 || title[i - 1] === ' ' ? 2 : 1
  }
  return score
}

export function SearchEverywhere() {
  const tab = useSearchUi((s) => s.everywhere)
  const close = useSearchUi((s) => s.closeEverywhere)
  return (
    <ModalOverlay isOpen={!!tab} onOpenChange={(o) => !o && close()} isDismissable className="fixed inset-0 z-popup flex justify-center bg-transparent pt-[15vh]">
      <Modal className="h-fit max-w-[calc(100vw-2rem)] outline-none">
        <AriaDialog aria-label={t('Buscar em tudo')} className="flex max-h-popup-search-max-height w-popup-search-width max-w-full flex-col overflow-hidden rounded-lg border border-border bg-surface-raised shadow-pop outline-none">
          {tab && <Body tab={tab} />}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  )
}

function Body({ tab }: { tab: EverywhereTab }) {
  const project = useApp((s) => s.project)!
  const recent = useSearchUi((s) => s.recent)
  const { openEverywhere, closeEverywhere, openFind } = useSearchUi()
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<FileHit[]>([])
  const [symbols, setSymbols] = useState<WorkspaceSymbol[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const { query: q, line, col } = splitLine(query)
  const wantFiles = tab === 'all' || tab === 'files'
  const wantSymbols = tab === 'all' || tab === 'symbols'

  // Arquivos: o índice é do backend (responde rápido, sem esperar o gopls).
  useEffect(() => {
    if (!wantFiles || !q) return setFiles([])
    let stale = false
    const t = setTimeout(() => {
      api.Search.Files(project.id, q, tab === 'files' ? 100 : ALL_LIMIT.files)
        .then((r) => !stale && setFiles(r))
        .catch(() => !stale && setFiles([]))
    }, 40)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [q, tab, project.id, wantFiles])

  // Símbolos: workspace/symbol do gopls; o gopls já faz o fuzzy.
  useEffect(() => {
    if (!wantSymbols || !q) return setSymbols([])
    let stale = false
    setLoading(true)
    const t = setTimeout(() => {
      workspaceSymbols(q)
        .then((r) => !stale && setSymbols(r))
        .catch(() => !stale && setSymbols([]))
        .finally(() => !stale && setLoading(false))
    }, 120)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [q, tab, wantSymbols])

  const finish = (fn: () => void) => {
    closeEverywhere()
    // Depois que o popup devolver o foco (ao editor), para a ação agir no lugar certo.
    setTimeout(fn, 0)
  }
  const openFile = (key: string) => finish(() => void useDocs.getState().open(key, { line, col, preview: false }))

  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    const cap = (g: Item['group'], n: number) => (tab === 'all' ? Math.min(n, ALL_LIMIT[g]) : n)
    if (wantFiles) {
      if (!q) {
        // Vazio: arquivos recentes (o atual por último: o mais útil é voltar ao anterior).
        const active = useDocs.getState().active
        const keys = [...recent.filter((k) => k !== active), ...recent.filter((k) => k === active)]
        for (const k of keys.slice(0, cap('files', 30))) out.push(fileItem(k, [], () => openFile(k)))
      } else {
        for (const h of files.slice(0, cap('files', files.length))) out.push(fileItem(h.path, h.positions, () => openFile(h.path)))
      }
    }
    if (wantSymbols && q) {
      const root = 'file://' + project.rootPath + '/'
      for (const s of symbols.slice(0, cap('symbols', 200))) {
        const uri = decodeURIComponent(s.location.uri)
        const rel = uri.startsWith(root) ? uri.slice(root.length) : uri.replace(/^file:\/\//, '')
        const { icon, name } = symbolIcon(s.kind)
        const ln = s.location.range.start.line + 1
        out.push({
          id: `s:${s.location.uri}:${ln}:${s.name}`,
          group: 'symbols',
          label: s.name,
          detail: `${name} · ${rel}:${ln}`,
          hint: s.containerName,
          icon,
          run: () => finish(() => void useDocs.getState().openUri(s.location.uri, ln, s.location.range.start.character + 1)),
        })
      }
    }
    if (tab === 'actions' || (tab === 'all' && q)) {
      const words = fold(q).split(/\s+/).filter(Boolean)
      const acts = allActions()
        .filter((a) => !a.when || a.when())
        .map((a) => ({ a, score: words.length ? matchAction(a, words) : 0 }))
        .filter((x) => x.score >= 0)
        .sort((x, y) => y.score - x.score || x.a.title.localeCompare(y.a.title, lang))
      for (const { a } of acts.slice(0, cap('actions', acts.length))) {
        out.push({
          id: 'a:' + a.id,
          group: 'actions',
          label: a.title,
          hint: keyLabel(a.keys),
          icon: <Zap className="size-icon-sm shrink-0 text-text-muted" aria-hidden />,
          run: () => finish(a.run),
        })
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, q, files, symbols, recent, wantFiles, wantSymbols, line, col])

  useEffect(() => setActive(0), [q, tab])
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      // Tab troca de aba (o foco fica no campo).
      e.preventDefault()
      const i = TABS.findIndex((t) => t.id === tab)
      openEverywhere(TABS[(i + (e.shiftKey ? TABS.length - 1 : 1)) % TABS.length].id)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(items.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      items[active]?.run()
    }
  }

  const groups = (['files', 'symbols', 'actions'] as const).map((g) => ({ g, items: items.filter((i) => i.group === g) })).filter((x) => x.items.length)
  const emptyText = !q
    ? tab === 'symbols'
      ? t('Digite o nome de uma função, tipo ou método.')
      : tab === 'actions'
        ? t('Nenhuma ação disponível agora.')
        : t('Nenhum arquivo aberto ainda. Digite para buscar.')
    : loading && wantSymbols
      ? t('Buscando…')
      : t('Nada encontrado para "{q}".', { q })

  return (
    <>
      <div role="tablist" aria-label={t('Onde buscar')} className="flex items-center gap-1 border-b border-border px-2 pt-2">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            role="tab"
            type="button"
            tabIndex={-1}
            aria-selected={tb.id === tab}
            title={tb.keys ? keyLabel(tb.keys) : undefined}
            onMouseDown={(e) => e.preventDefault()} // o foco fica no campo
            onClick={() => openEverywhere(tb.id)}
            className={cn(
              'mb-[-1px] rounded-t-md border-b-2 px-3 py-1 text-sm outline-none transition-colors duration-fast',
              tb.id === tab ? 'border-accent bg-selection text-text' : 'border-transparent text-text-muted hover:bg-hover hover:text-text',
            )}
          >
            {tb.label}
          </button>
        ))}
        <span className="ml-auto pb-1 text-xs text-text-muted">
          <Kbd>Tab</Kbd> {t('troca de aba')}
        </span>
      </div>
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="size-icon shrink-0 text-text-muted" aria-hidden />
        <input
          ref={input}
          autoFocus
          role="combobox"
          aria-label={t('Buscar em tudo')}
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder={
            tab === 'files'
              ? t('Nome do arquivo (arquivo.go:linha vai direto à linha)')
              : tab === 'symbols'
                ? t('Nome do símbolo')
                : tab === 'actions'
                  ? t('Nome da ação')
                  : t('Arquivos, símbolos e ações')
          }
          spellCheck={false}
          className="h-control-lg min-w-0 flex-1 bg-transparent text-md text-text outline-none placeholder:text-text-muted"
        />
      </div>
      <div ref={list} id={listId} role="listbox" aria-label={t('Resultados')} className="min-h-0 flex-1 overflow-y-auto py-1">
        {groups.length === 0 && (
          <div role="presentation" className="flex flex-col items-start gap-2 px-4 py-6 text-sm text-text-muted">
            <span>{emptyText}</span>
            {q && !(loading && wantSymbols) && (
              <button type="button" className="text-accent-text underline-offset-2 hover:underline" onClick={() => openFind(false, q)}>
                {t('Buscar "{q}" nos arquivos ({keys})', { q, keys: keyLabel('Mod+Shift+F') ?? '' })}
              </button>
            )}
          </div>
        )}
        {groups.map(({ g, items: gi }) => (
          <div key={g} role="group" aria-label={GROUP_TITLE[g]}>
            {(tab === 'all' || (g === 'files' && !q)) && (
              <div role="presentation" className="px-3 pb-0.5 pt-1.5 text-2xs font-semibold uppercase tracking-wide text-text-muted">
                {g === 'files' && !q ? t('Arquivos recentes') : GROUP_TITLE[g]}
              </div>
            )}
            {gi.map((it) => {
              const idx = items.indexOf(it)
              return (
                <div
                  key={it.id}
                  id={`${listId}-${idx}`}
                  data-index={idx}
                  role="option"
                  aria-selected={idx === active}
                  aria-label={[it.label, it.detail, it.hint].filter(Boolean).join(', ')}
                  onMouseMove={() => idx !== active && setActive(idx)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={it.run}
                  className={cn('mx-1 flex h-row cursor-default items-center gap-2 rounded-sm px-2 text-sm', idx === active ? 'bg-selection' : '')}
                >
                  {it.icon}
                  <span className="shrink-0 text-text">
                    <Marked text={it.label} marks={it.marks} />
                  </span>
                  {it.detail && <span className="min-w-0 truncate text-xs text-text-muted">{it.detail}</span>}
                  {it.hint && <span className="ml-auto shrink-0 pl-2 text-xs text-text-muted">{it.hint}</span>}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 border-t border-border px-3 py-1 text-xs text-text-muted">
        <span>
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> {t('navegar')}
        </span>
        <span>
          <Kbd>Enter</Kbd> {t('abrir')}
        </span>
        <span>
          <Kbd>Esc</Kbd> {t('fechar')}
        </span>
        <button type="button" className="ml-auto text-accent-text hover:underline" onClick={() => openFind(false, q)}>
          {t('Buscar nos arquivos')}
        </button>
      </div>
    </>
  )
}
