// S14 Testes: árvore pacote → teste → subteste com status e tempo, saída do teste selecionado,
// rodar de novo (tudo ou só os que falharam) e ir para o código.
import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CircleSlash, ListX, Play, RotateCw, Square, XCircle, Bug, Repeat } from 'lucide-react'
import { create } from 'zustand'
import { api, type TestNode, type TestRun } from '../lib/api'
import { on } from '../lib/events'
import { IconButton } from '../design/controls'
import { EmptyState, TreeView, toast, type TreeNode } from '../design/feedback'
import { cn } from '../design/cn'
import { ToolWindowFrame } from '../shell/ToolWindows'
import { useApp } from '../state/app'
import { useDebug } from '../state/debug'
import { useDocs } from '../editor/docs'
import { keyLabel } from '../lib/keymap'
import { lang, t } from '../i18n'

const idOf = (n: Pick<TestNode, 'package' | 'name'>) => `${n.package}\u0000${n.name}`

function StatusIcon({ status }: { status: TestNode['status'] }) {
  if (status === 'passed') return <CheckCircle2 className="size-icon-sm text-success" aria-label={t('passou')} />
  if (status === 'failed') return <XCircle className="size-icon-sm text-danger" aria-label={t('falhou')} />
  if (status === 'skipped') return <CircleSlash className="size-icon-sm text-text-subtle" aria-label={t('pulado')} />
  return <span className="size-icon-sm animate-spin rounded-pill border-2 border-hover border-t-accent-text" aria-label={t('rodando')} />
}

const seconds = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1).replace('.', lang === 'en' ? '.' : ',')} s` : `${ms} ms`)

/** Monta a hierarquia: pacote na raiz, testes embaixo, subtestes pelo "/" do nome. */
function buildTree(run: TestRun, onlyFailed: boolean): TreeNode[] {
  const byId = new Map<string, TreeNode & { status: string }>()
  const roots: Array<TreeNode & { status: string }> = []
  const keep = (n: TestNode) => !onlyFailed || n.status === 'failed'
  const toNode = (n: TestNode): TreeNode & { status: string } => ({
    id: idOf(n),
    status: n.status,
    label: n.name === '' ? n.package : n.name.split('/').pop()!,
    textValue: `${n.name || n.package}, ${n.status === 'passed' ? t('passou') : n.status === 'failed' ? t('falhou') : n.status === 'skipped' ? t('pulado') : t('rodando')}${n.summary ? ', ' + n.summary : ''}`,
    icon: <StatusIcon status={n.status} />,
    // Benchmark e fuzz: o resultado (ns/op, execs) no lugar do tempo; o fuzz atualiza enquanto roda.
    secondary: n.summary ?? (n.status === 'running' ? undefined : seconds(n.elapsedMs)),
    isLeaf: true,
    children: [],
    className: n.status === 'failed' ? 'text-danger' : undefined,
  })
  for (const n of run.nodes) {
    if (n.name !== '' && !keep(n)) continue
    const node = toNode(n)
    byId.set(node.id, node)
    if (n.name === '') {
      roots.push(node)
      continue
    }
    const slash = n.name.lastIndexOf('/')
    const parentId = slash < 0 ? idOf({ package: n.package, name: '' }) : idOf({ package: n.package, name: n.name.slice(0, slash) })
    const parent = byId.get(parentId)
    if (parent) {
      parent.isLeaf = false
      parent.children!.push(node)
    } else roots.push(node)
  }
  return roots
}

/** Rodar de novo ao salvar: liga pelo botão da janela Testes; vale para a última execução de testes. */
export const useAutoRerun = create<{ on: boolean }>(() => ({ on: false }))

const isLive = (r?: { state: string }) => !!r && (r.state === 'building' || r.state === 'running')
const lastTestRun = () => useApp.getState().runs.find((r) => r.kind === 'test')

/** Salvou um .go do projeto com o rerun ligado: roda de novo (se ainda estiver rodando, assim que terminar). */
export function installAutoRerun(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending = false
  const fire = () => {
    const r = lastTestRun()
    if (!useAutoRerun.getState().on || !r) return
    if (isLive(r)) {
      pending = true
      return
    }
    pending = false
    void useApp.getState().runConfig(r.configId)
  }
  const offDocs = useDocs.subscribe((s, prev) => {
    if (!useAutoRerun.getState().on || s.docs === prev.docs) return
    const saved = Object.entries(s.docs).some(([key, d]) => key.endsWith('.go') && !key.startsWith('ext:') && prev.docs[key] && prev.docs[key].mtime !== d.mtime)
    if (!saved) return
    clearTimeout(timer)
    timer = setTimeout(fire, 600)
  })
  const offRuns = useApp.subscribe((s, prev) => {
    if (pending && s.runs !== prev.runs && !isLive(lastTestRun())) fire()
  })
  const offToggle = useAutoRerun.subscribe((s) => !s.on && (pending = false))
  return () => {
    clearTimeout(timer)
    offDocs()
    offRuns()
    offToggle()
  }
}

export function TestsPanel() {
  const project = useApp((s) => s.project)!
  const runs = useApp((s) => s.runs)
  const runConfig = useApp((s) => s.runConfig)
  const stopRun = useApp((s) => s.stopRun)
  const testRuns = runs.filter((r) => r.kind === 'test')
  const [activeId, setActiveId] = useState<string | null>(null)
  const active = testRuns.find((r) => r.id === activeId) ?? testRuns[0]
  const [result, setResult] = useState<TestRun | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [onlyFailed, setOnlyFailed] = useState(false)
  const autoRerun = useAutoRerun((s) => s.on)

  // Uma execução nova vira a ativa.
  useEffect(() => {
    if (testRuns[0] && testRuns[0].id !== activeId) {
      setActiveId(testRuns[0].id)
      setSelected(null)
      setExpanded(new Set())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testRuns[0]?.id])

  // Árvore da execução ativa: carrega agora e a cada aviso do backend.
  useEffect(() => {
    if (!active) return
    let off = false
    const load = () =>
      api.Tests.Get(active.id)
        .then((r) => {
          if (off) return
          setResult(r)
          // O aviso de fim (run:state) pode se perder com o barramento cheio: a árvore já diz que acabou.
          if (!isLive(r) && isLive(active)) {
            useApp.setState((st) => ({ runs: st.runs.map((x) => (x.id === r.runId && isLive(x) ? { ...x, state: r.state } : x)) }))
          }
        })
        .catch(() => {})
    load()
    const offEv = on('test:update', (e) => e.runId === active.id && load())
    // Enquanto roda, confere de tempos em tempos (o último test:update também pode se perder).
    const poll = isLive(active) ? setInterval(load, 1500) : undefined
    return () => {
      off = true
      offEv()
      clearInterval(poll)
    }
  }, [active?.id, active?.state])

  // Pacotes e testes com falha ficam abertos; ao terminar, seleciona a primeira falha.
  useEffect(() => {
    if (!result) return
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const n of result.nodes) {
        if (n.name === '') next.add(idOf(n))
        if (n.status === 'failed' && n.name.includes('/')) next.add(idOf({ package: n.package, name: n.name.split('/').slice(0, -1).join('/') }))
      }
      return next
    })
    if (!selected && result.state !== 'running' && result.state !== 'building') {
      const firstFail = result.nodes.find((n) => n.status === 'failed' && n.name !== '')
      if (firstFail) setSelected(idOf(firstFail))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  const tree = useMemo(() => (result ? buildTree(result, onlyFailed) : []), [result, onlyFailed])
  const selNode = result?.nodes.find((n) => idOf(n) === selected)
  const live = active && (active.state === 'building' || active.state === 'running')

  const goTo = async (id: string) => {
    const n = result?.nodes.find((x) => idOf(x) === id)
    if (!n || !active || n.name === '') return
    try {
      const loc = await api.Tests.Locate(project.id, active.id, n.package, n.name)
      const key = loc.file.startsWith('/') ? 'ext:' + loc.file : loc.file
      useDocs.getState().open(key, { line: loc.line, col: 1, preview: false })
    } catch (e) {
      toast('warning', t('Não achei o teste no código'), String((e as Error).message))
    }
  }
  // Rodar ou depurar só este teste (ou subteste: "TestA/caso 1"), pelo arquivo onde ele está.
  const runOne = async (id: string, debug: boolean) => {
    const n = result?.nodes.find((x) => idOf(x) === id)
    if (!n || !active || n.name === '') return
    try {
      const loc = await api.Tests.Locate(project.id, active.id, n.package, n.name)
      if (loc.file.startsWith('/')) return toast('info', t('Teste fora do projeto'), loc.file)
      if (debug) await useDebug.getState().startFile(loc.file, n.name)
      else await useApp.getState().runFile(loc.file, n.name)
    } catch (e) {
      toast('warning', t('Não achei o teste no código'), String((e as Error).message))
    }
  }
  const rerunFailed = async () => {
    if (!active) return
    try {
      await useDocs.getState().autosave()
      const info = await api.Tests.RerunFailed(project.id, active.id)
      useApp.setState({ runs: [info, ...useApp.getState().runs.filter((r) => r.id !== info.id)] }) // o evento run:state pode ter chegado antes
    } catch (e) {
      toast('info', t('Nada para rodar de novo'), String((e as Error).message))
    }
  }

  if (!active) {
    return (
      <ToolWindowFrame side="bottom">
        <EmptyState title={t('Nenhum teste rodou ainda')}>
          {t('Clique no ▶ ao lado de um')} <code className="font-mono">func TestX</code> {t('num arquivo _test.go para rodar um teste, ou no ▶ do pacote.')}
        </EmptyState>
      </ToolWindowFrame>
    )
  }

  const total = result ? result.passed + result.failed + result.skipped : 0
  return (
    <ToolWindowFrame
      side="bottom"
      actions={
        <div role="status" aria-live="polite" className="mr-2 flex items-center gap-3 text-xs">
          <span className="max-w-empty-max truncate text-text">{active.name}</span>
          {result && (
            <span className={cn(result.failed ? 'text-danger' : live ? 'text-text-muted' : 'text-success')}>
              {live ? t('rodando…') + ' ' : ''}
              {t('{passed} passaram, {failed} falharam', { passed: result.passed, failed: result.failed })}
              {result.skipped ? t(', {n} pulados', { n: result.skipped }) : ''}
            </span>
          )}
        </div>
      }
    >
      <div className="flex h-full min-h-0">
        <div role="toolbar" aria-orientation="vertical" aria-label={t('Ações dos testes')} className="flex shrink-0 flex-col gap-0.5 border-r border-border p-1">
          <IconButton label={t('Rodar de novo')} shortcut={keyLabel('Mod+F5')} size="sm" icon={live ? <RotateCw className="size-icon-sm" /> : <Play className="size-icon-sm text-success" />} onPress={() => runConfig(active.configId)} />
          <IconButton label={t('Rodar só os que falharam')} size="sm" isDisabled={!!live || !result?.failed} icon={<ListX className="size-icon-sm text-danger" />} onPress={rerunFailed} />
          <IconButton label={t('Parar')} shortcut={keyLabel('Mod+F2')} size="sm" isDisabled={!live} icon={<Square className={cn('size-icon-sm', live && 'text-danger')} />} onPress={() => stopRun(active.id)} />
          <span className="my-0.5 border-t border-border" aria-hidden />
          <IconButton label={t('Mostrar só falhas')} size="sm" toggled={onlyFailed} icon={<XCircle className="size-icon-sm" />} onPress={() => setOnlyFailed(!onlyFailed)} />
          <IconButton label={t('Rodar de novo ao salvar')} size="sm" toggled={autoRerun} icon={<Repeat className="size-icon-sm" />} onPress={() => useAutoRerun.setState({ on: !autoRerun })} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Barra de progresso fina: verde, vermelha se algo falhou. */}
          <div className="h-0.5 shrink-0 bg-hover" aria-hidden>
            <div className={cn('h-full transition-[width] duration-base', result?.failed ? 'bg-danger' : 'bg-success')} style={{ width: live ? '100%' : total ? '100%' : '0%', opacity: live ? 0.5 : 1 }} />
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <section aria-label={t('Resultados')} className="min-h-0 overflow-auto border-r border-border">
              {tree.length === 0 ? (
                <EmptyState title={live ? t('Compilando…') : onlyFailed ? t('Nenhuma falha') : t('Nenhum teste encontrado')} />
              ) : (
                <TreeView
                  label={t('Resultados dos testes')}
                  roots={tree}
                  expanded={expanded}
                  selected={selected}
                  onSelect={(n) => setSelected(n.id)}
                  onActivate={(n) => goTo(n.id)}
                  onToggle={(n, open) =>
                    setExpanded((e) => {
                      const s = new Set(e)
                      if (open) s.add(n.id)
                      else s.delete(n.id)
                      return s
                    })
                  }
                />
              )}
            </section>
            <section aria-label={t('Saída do teste')} className="flex min-h-0 flex-col">
              {selNode ? (
                <>
                  <div className="flex h-row shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
                    <StatusIcon status={selNode.status} />
                    <span className="truncate text-text">{selNode.name || selNode.package}</span>
                    {selNode.name !== '' && (
                      <span className="ml-auto flex items-center gap-1">
                        <IconButton label={t('Rodar {name}', { name: selNode.name })} size="sm" isDisabled={!!live} icon={<Play className="size-icon-sm text-success" />} onPress={() => void runOne(idOf(selNode), false)} />
                        <IconButton label={t('Depurar {name}', { name: selNode.name })} size="sm" isDisabled={!!live} icon={<Bug className="size-icon-sm" />} onPress={() => void runOne(idOf(selNode), true)} />
                        <button onClick={() => goTo(idOf(selNode))} className="ml-1 text-accent-text underline underline-offset-2 hover:text-text">
                          {t('Ir para o código')}
                        </button>
                      </span>
                    )}
                  </div>
                  <pre role="log" aria-label={t('Saída de {name}', { name: selNode.name || selNode.package })} className="selectable min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-bg px-3 py-2 font-mono text-code text-text">
                    {selNode.output || t('Sem saída.')}
                  </pre>
                </>
              ) : (
                <EmptyState title={t('Selecione um teste')}>{t('A saída dele aparece aqui. Enter ou clique duplo leva ao código.')}</EmptyState>
              )}
            </section>
          </div>
        </div>
      </div>
    </ToolWindowFrame>
  )
}
