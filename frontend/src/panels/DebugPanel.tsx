// S15 Depurar: controles de execução, goroutines e pilha, variáveis (árvore sob demanda), avaliar expressão, console.
import { useCallback, useEffect, useState } from 'react'
import { ArrowDownToLine, CornerDownRight, TextCursorInput, CornerUpLeft, Pause, Play, RedoDot, Square, ChevronDown, ChevronRight, CircleDot, CircleSlash, Pin, X } from 'lucide-react'
import { api, type Frame, type Goroutine, type Variable } from '../lib/api'
import { IconButton, TextField, Checkbox } from '../design/controls'
import { EmptyState, TreeView, type TreeNode } from '../design/feedback'
import { cn } from '../design/cn'
import { ToolWindowFrame } from '../shell/ToolWindows'
import { useDebug } from '../state/debug'
import { useDocs } from '../editor/docs'
import { currentEditor } from '../editor/EditorArea'
import { keyLabel } from '../lib/keymap'
import { Console } from './Console'
import { t, tn } from '../i18n'

const stateText = { starting: t('iniciando'), running: t('rodando'), stopped: t('parado'), terminated: t('encerrado') }

function openFrame(f: Frame) {
  if (!f.file) return
  useDocs.getState().open(f.file.startsWith('/') ? 'ext:' + f.file : f.file, { line: f.line, col: 1, preview: false })
}

/** Árvore de variáveis: escopos na raiz, filhos carregados quando expande. */
function Variables({ sessionId, frame }: { sessionId: string; frame: Frame | null }) {
  const [roots, setRoots] = useState<TreeNode[]>([])
  const [kids, setKids] = useState<Record<string, Variable[]>>({})
  const [refs, setRefs] = useState<Record<string, number>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (id: string, ref: number) => {
      setLoading((l) => new Set(l).add(id))
      try {
        const vs = await api.Debug.Variables(sessionId, ref)
        setKids((k) => ({ ...k, [id]: vs }))
      } catch (e) {
        setError(String((e as Error).message))
      } finally {
        setLoading((l) => {
          const n = new Set(l)
          n.delete(id)
          return n
        })
      }
    },
    [sessionId],
  )

  useEffect(() => {
    setRoots([])
    setKids({})
    setError(null)
    if (!frame) return
    let off = false
    api.Debug.Scopes(sessionId, frame.id)
      .then(async (scopes) => {
        if (off) return
        const r: Record<string, number> = {}
        scopes.forEach((s) => (r[s.name] = s.ref))
        setRefs(r)
        setRoots(scopes.map((s) => ({ id: s.name, label: s.name, textValue: s.name, isLeaf: false })))
        // O primeiro escopo (variáveis locais) já vem aberto.
        if (scopes[0]) {
          setExpanded(new Set([scopes[0].name]))
          await load(scopes[0].name, scopes[0].ref)
        }
      })
      .catch((e) => !off && setError(String(e.message)))
    return () => {
      off = true
    }
  }, [sessionId, frame, load])

  const toNode = (parent: string, v: Variable, i: number): TreeNode => {
    const id = `${parent}/${i}:${v.name}`
    if (v.ref) refs[id] = v.ref
    return {
      id,
      label: (
        <>
          <span className="text-syntax-field">{v.name}</span>
          <span className="text-text-muted"> = </span>
          <span className="selectable">{v.value}</span>
        </>
      ),
      textValue: `${v.name} = ${v.value}`,
      secondary: v.type,
      isLeaf: !v.ref,
      children: kids[id]?.map((c, j) => toNode(id, c, j)),
    }
  }
  const tree = roots.map((r) => ({ ...r, children: kids[r.id]?.map((v, i) => toNode(r.id, v, i)) }))

  if (!frame) return <EmptyState title={t('Sem quadro selecionado')}>{t('Pause o programa ou espere um breakpoint.')}</EmptyState>
  if (error) return <EmptyState title={t('Não foi possível ler as variáveis')}>{error}</EmptyState>
  return (
    <TreeView
      label={t('Variáveis')}
      roots={tree}
      expanded={expanded}
      selected={selected}
      onSelect={(n) => setSelected(n.id)}
      onActivate={() => {}}
      loading={loading}
      onToggle={(n, open) => {
        setExpanded((e) => {
          const s = new Set(e)
          if (open) s.add(n.id)
          else s.delete(n.id)
          return s
        })
        if (open && !kids[n.id] && refs[n.id]) load(n.id, refs[n.id])
      }}
    />
  )
}

type Evaluated = { expr: string; value?: string; type?: string; error?: string }

/** Watches (fixados, reavaliados a cada parada) e avaliações avulsas no quadro atual. */
function Evaluate({ sessionId, frame }: { sessionId: string; frame: Frame | null }) {
  const [expr, setExpr] = useState('')
  const [results, setResults] = useState<Evaluated[]>([])
  const { watches, addWatch, removeWatch } = useDebug()
  const [watchValues, setWatchValues] = useState<Record<string, Evaluated>>({})
  // A cada parada (ou troca de quadro), reavalia os watches.
  useEffect(() => {
    if (!frame) return setWatchValues({})
    let stale = false
    void Promise.all(
      watches.map(async (w): Promise<Evaluated> => {
        try {
          const v = await api.Debug.Evaluate(sessionId, frame.id, w)
          return { expr: w, value: v.value, type: v.type }
        } catch (err) {
          return { expr: w, error: String((err as Error).message) }
        }
      }),
    ).then((list) => !stale && setWatchValues(Object.fromEntries(list.map((x) => [x.expr, x]))))
    return () => {
      stale = true
    }
  }, [sessionId, frame, watches])
  const run = async (pin = false) => {
    const e = expr.trim()
    if (pin) {
      addWatch(e)
      setExpr('')
      return
    }
    if (!e) return
    // Parou, mas a pilha ainda está chegando: avalia assim que o quadro aparecer.
    if (!frame) return setPending(e)
    await evaluate(frame, e)
  }
  const evaluate = async (f: Frame, e: string) => {
    try {
      const v = await api.Debug.Evaluate(sessionId, f.id, e)
      setResults((r) => [{ expr: e, value: v.value, type: v.type }, ...r].slice(0, 30))
    } catch (err) {
      setResults((r) => [{ expr: e, error: String((err as Error).message) }, ...r].slice(0, 30))
    }
    setExpr('')
  }
  const [pending, setPending] = useState<string | null>(null)
  useEffect(() => {
    if (!frame || !pending) return
    setPending(null)
    void evaluate(frame, pending)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, pending])
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-2">
        <TextField
          label={t('Avaliar expressão')}
          hideLabel
          value={expr}
          onChange={setExpr}
          placeholder={frame ? t('Expressão Go: Enter avalia, Ctrl+Enter vira watch') : t('Disponível com o programa parado')}
          onKeyDown={(e) => e.key === 'Enter' && void run(e.ctrlKey || e.metaKey)}
        />
      </div>
      {watches.length > 0 && (
        <ul aria-label={t('Watches')} className="shrink-0 border-b border-border px-2 pb-1 font-mono text-code">
          {watches.map((w) => {
            const r = watchValues[w]
            return (
              <li key={w} className="group flex items-center gap-1 py-0.5">
                <span className="selectable min-w-0 flex-1 truncate">
                  <span className="text-accent-text">{w}</span>
                  <span className="text-text-muted"> = </span>
                  {!r ? <span className="text-text-muted">…</span> : r.error ? <span className="text-danger">{r.error}</span> : <span className="text-text">{r.value}</span>}
                  {r?.type && <span className="text-xs text-text-muted"> {r.type}</span>}
                </span>
                <IconButton label={t('Tirar o watch {expr}', { expr: w })} size="sm" icon={<X className="size-3" />} onPress={() => removeWatch(w)} />
              </li>
            )
          })}
        </ul>
      )}
      <ul aria-label={t('Resultados')} className="min-h-0 flex-1 overflow-auto px-2 font-mono text-code">
        {results.map((r, i) => (
          <li key={i} className="flex items-center gap-1 py-0.5">
            <span className="selectable min-w-0 flex-1 truncate">
              <span className="text-text">{r.expr}</span>
              <span className="text-text-muted"> = </span>
              {r.error ? <span className="text-danger">{r.error}</span> : <span className="text-text">{r.value}</span>}
              {r.type && <span className="text-xs text-text-muted"> {r.type}</span>}
            </span>
            {!watches.includes(r.expr) && <IconButton label={t('Fixar {expr} como watch', { expr: r.expr })} size="sm" icon={<Pin className="size-3" />} onPress={() => addWatch(r.expr)} />}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function DebugPanel() {
  const { sessions, active, frame, control, stop, selectFrame, muted } = useDebug()
  const s = sessions.find((x) => x.id === active)
  const [tab, setTab] = useState<'debugger' | 'console'>('debugger')
  const [autoscroll, setAutoscroll] = useState(true)
  const [goroutines, setGoroutines] = useState<Goroutine[]>([])
  const [thread, setThread] = useState(0)
  const [frames, setFrames] = useState<Frame[]>([])
  const stopped = s?.state === 'stopped'
  const live = !!s && s.state !== 'terminated'

  // Parou: carrega goroutines e a pilha da goroutine que parou; seleciona o primeiro quadro do projeto.
  useEffect(() => {
    if (!s || !stopped) {
      setFrames([])
      return
    }
    let off = false
    const tid = s.threadId
    setThread(tid)
    Promise.all([api.Debug.Goroutines(s.id), api.Debug.Stack(s.id, tid)]).then(([gs, fs]) => {
      if (off) return
      setGoroutines(gs)
      setFrames(fs)
      selectFrame(fs.find((f) => !f.external) ?? fs[0] ?? null)
    })
    return () => {
      off = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.id, s?.state, s?.threadId, s?.line])

  const pickThread = async (tid: number) => {
    if (!s) return
    setThread(tid)
    const fs = await api.Debug.Stack(s.id, tid)
    setFrames(fs)
    const f = fs.find((x) => !x.external) ?? fs[0] ?? null
    selectFrame(f)
    if (f) openFrame(f)
  }

  if (!s) {
    return (
      <ToolWindowFrame side="bottom">
        <EmptyState title={t('Nenhuma depuração em andamento')}>
          {t('Clique no número de uma linha para pôr um breakpoint e, no ▶ do gutter, use o botão direito e escolha Depurar ({key} depura a configuração escolhida).', { key: keyLabel('Shift+F9') ?? '' })}
        </EmptyState>
      </ToolWindowFrame>
    )
  }

  return (
    <ToolWindowFrame
      side="bottom"
      actions={
        <div className="mr-2 flex items-center gap-2 text-xs">
          <span className="max-w-empty-max truncate text-text">{s.name}</span>
          <span className={cn('rounded-xs px-1.5', stopped ? 'bg-warning-bg text-warning' : live ? 'bg-success-bg text-success' : 'bg-hover text-text-muted')}>
            {stateText[s.state]}
            {stopped && s.reason ? ` (${s.reason === 'breakpoint' ? 'breakpoint' : s.reason === 'step' ? t('passo') : s.reason === 'pause' ? t('pausa') : s.reason})` : ''}
          </span>
        </div>
      }
    >
      <div className="flex h-full min-h-0">
        <div role="toolbar" aria-orientation="vertical" aria-label={t('Controles da depuração')} className="flex shrink-0 flex-col gap-0.5 border-r border-border p-1">
          <IconButton label={t('Continuar')} shortcut="F9" size="sm" isDisabled={!stopped} icon={<Play className="size-icon-sm text-success" />} onPress={() => control('resume')} />
          <IconButton label={t('Pausar')} size="sm" isDisabled={!live || stopped} icon={<Pause className="size-icon-sm" />} onPress={() => control('pause')} />
          <IconButton label={t('Parar')} shortcut={keyLabel('Mod+F2')} size="sm" isDisabled={!live} icon={<Square className={cn('size-icon-sm', live && 'text-danger')} />} onPress={stop} />
          <span className="my-0.5 border-t border-border" aria-hidden />
          <IconButton label={t('Passar por cima')} shortcut="F8" size="sm" isDisabled={!stopped} icon={<RedoDot className="size-icon-sm" />} onPress={() => control('stepOver')} />
          <IconButton label={t('Entrar')} shortcut="F7" size="sm" isDisabled={!stopped} icon={<CornerDownRight className="size-icon-sm" />} onPress={() => control('stepInto')} />
          <IconButton label={t('Sair da função')} shortcut="Shift+F8" size="sm" isDisabled={!stopped} icon={<CornerUpLeft className="size-icon-sm" />} onPress={() => control('stepOut')} />
          <IconButton
            label={t('Rodar até o cursor')}
            shortcut="Alt+F9"
            size="sm"
            isDisabled={!stopped}
            icon={<TextCursorInput className="size-icon-sm" />}
            onPress={() => void useDebug.getState().runToCursor(useDocs.getState().active, currentEditor()?.getPosition()?.lineNumber)}
          />
          <span className="my-1 h-px w-5 bg-border" aria-hidden />
          <IconButton label={t('Ver breakpoints')} shortcut={keyLabel('Mod+Shift+F8')} size="sm" icon={<CircleDot className="size-icon-sm" />} onPress={() => useDebug.getState().openDialog()} />
          <IconButton
            label={t('Silenciar breakpoints')}
            size="sm"
            toggled={muted}
            icon={<CircleSlash className="size-icon-sm" />}
            onPress={() => void useDebug.getState().setMuted(!muted)}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div role="tablist" aria-label={t('Visões da depuração')} className="flex h-control shrink-0 items-center gap-1 border-b border-border px-2">
            {(['debugger', 'console'] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={tab === v}
                onClick={() => setTab(v)}
                className={cn('h-control-sm rounded-md px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-focus', tab === v ? 'bg-selection text-text' : 'text-text-muted hover:bg-hover')}
              >
                {v === 'debugger' ? t('Depurador') : t('Console')}
              </button>
            ))}
            {tab === 'console' && (
              <IconButton label={t('Rolar até o fim')} size="sm" toggled={autoscroll} className="ml-auto" icon={<ArrowDownToLine className="size-icon-sm" />} onPress={() => setAutoscroll(!autoscroll)} />
            )}
          </div>
          {tab === 'console' ? (
            <Console id={s.id} label={t('Saída de {name}', { name: s.name })} autoscroll={autoscroll} onAutoscroll={setAutoscroll} />
          ) : !stopped ? (
            <EmptyState title={s.state === 'terminated' ? t('Depuração encerrada') : s.state === 'starting' ? t('Compilando para depurar…') : t('Rodando')}>
              {s.state === 'running' && t('O programa para no próximo breakpoint, ou use Pausar.')}
              {s.state === 'terminated' && (s.exitCode !== null ? t('O programa terminou com código {code}.', { code: s.exitCode }) : t('Veja a saída na aba Console.'))}
            </EmptyState>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
              <section aria-label={t('Pilha')} className="flex min-h-0 flex-col border-r border-border">
                <GoroutineList goroutines={goroutines} selected={thread} onPick={pickThread} />
                <ul role="listbox" aria-label={t('Quadros da pilha')} className="min-h-0 flex-1 basis-0 overflow-auto py-1">
                  {frames.map((f) => (
                    <li
                      key={f.id}
                      role="option"
                      aria-selected={frame?.id === f.id}
                      tabIndex={0}
                      onClick={() => (selectFrame(f), openFrame(f))}
                      onKeyDown={(e) => e.key === 'Enter' && (selectFrame(f), openFrame(f))}
                      className={cn(
                        'flex h-row cursor-default items-center gap-2 px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-focus',
                        frame?.id === f.id ? 'bg-selection' : 'hover:bg-hover',
                        f.external && 'text-text-muted',
                      )}
                    >
                      <span className="truncate">{f.name}</span>
                      <span className="ml-auto shrink-0 truncate text-xs text-text-muted">
                        {f.file.split('/').pop()}:{f.line}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
              <section aria-label={t('Variáveis')} className="min-h-0 overflow-auto border-r border-border">
                <Variables sessionId={s.id} frame={frame} />
              </section>
              <section aria-label={t('Avaliar')} className="min-h-0">
                <Evaluate sessionId={s.id} frame={frame} />
              </section>
            </div>
          )}
        </div>
      </div>
    </ToolWindowFrame>
  )
}

/** Goroutines agrupadas pela função onde estão; as do runtime ficam escondidas até pedir. */
function GoroutineList({ goroutines, selected, onPick }: { goroutines: Goroutine[]; selected: number; onPick: (id: number) => void }) {
  const [filter, setFilter] = useState('')
  const [system, setSystem] = useState(false)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const f = filter.trim().toLowerCase()
  const visible = goroutines.filter((g) => (system || !g.system || g.current) && (!f || g.name.toLowerCase().includes(f) || String(g.id) === f))
  const hidden = goroutines.length - visible.length
  const groups = new Map<string, Goroutine[]>()
  const noFn = t('(sem função)')
  for (const g of visible) groups.set(g.function || noFn, [...(groups.get(g.function || noFn) ?? []), g])
  // A que parou primeiro; depois os grupos maiores.
  const ordered = [...groups.entries()].sort((a, b) => Number(b[1].some((g) => g.current)) - Number(a[1].some((g) => g.current)) || b[1].length - a[1].length || a[0].localeCompare(b[0]))
  return (
    <div className="flex min-h-0 flex-1 basis-0 flex-col border-b border-border">
      <div className="flex items-center gap-2 px-2 py-1">
        <input
          aria-label={t('Filtrar goroutines')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('Filtrar goroutines')}
          className="h-control-sm min-w-0 flex-1 rounded-sm border border-border-input bg-bg px-1.5 text-xs text-text placeholder:text-text-muted outline-none focus:border-focus"
        />
        <Checkbox isSelected={system} onChange={setSystem} className="shrink-0 text-xs">
          Runtime
        </Checkbox>
      </div>
      <ul role="tree" aria-label="Goroutines" className="min-h-0 overflow-auto pb-1">
        {ordered.map(([fn, list]) => {
          const open = !closed.has(fn)
          return (
            <li key={fn} role="treeitem" aria-expanded={open} aria-selected={false} aria-label={tn(list.length, '{fn}, {n} goroutine', '{fn}, {n} goroutines', { fn })}>
              <button
                type="button"
                onClick={() =>
                  setClosed((c) => {
                    const n = new Set(c)
                    if (n.has(fn)) n.delete(fn)
                    else n.add(fn)
                    return n
                  })
                }
                className="flex h-row w-full items-center gap-1 px-2 text-left text-xs text-text-muted outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-focus"
              >
                {open ? <ChevronDown className="size-3 shrink-0" aria-hidden /> : <ChevronRight className="size-3 shrink-0" aria-hidden />}
                <span className="truncate font-mono text-text" title={fn}>
                  {fn.slice(fn.lastIndexOf('/') + 1)}
                </span>
                <span className="shrink-0">({list.length})</span>
              </button>
              {open && (
                <ul role="group">
                  {list.map((g) => (
                    <li
                      key={g.id}
                      role="treeitem"
                      aria-selected={g.id === selected}
                      aria-label={g.current ? t('Goroutine {id}, parou aqui', { id: g.id }) : t('Goroutine {id}', { id: g.id })}
                      tabIndex={0}
                      onClick={() => onPick(g.id)}
                      onKeyDown={(e) => e.key === 'Enter' && onPick(g.id)}
                      className={cn(
                        'flex h-row cursor-default items-center gap-2 pl-6 pr-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-focus',
                        g.id === selected ? 'bg-selection text-text' : 'text-text hover:bg-hover',
                      )}
                    >
                      Go {g.id}
                      {g.current && <span className="rounded-xs bg-warning-bg px-1 text-2xs text-warning">{t('parou aqui')}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
        {visible.length === 0 && <li className="px-2 py-1 text-xs text-text-muted">{t('Nenhuma goroutine com esse filtro.')}</li>}
      </ul>
      {hidden > 0 && !system && !f && <p className="px-2 pb-1 text-2xs text-text-muted">{t('{n} do runtime escondidas', { n: hidden })}</p>}
    </div>
  )
}
