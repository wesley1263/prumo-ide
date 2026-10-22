// S03 Janela principal: cabeçalho, barras de ícones, tool windows, editor e status bar.
import { useEffect, type ReactNode } from 'react'
import { HeaderBar } from './HeaderBar'
import { StatusBar } from './StatusBar'
import { FloatingWindows, Stripe, ToolWindowHost } from './ToolWindows'
import { sizeLimits, toolWindows, useLayout, type FloatBox, type Place, type Side } from './layout'
import { Splitter, toast } from '../design/feedback'
import { EditorArea, currentEditor, editorCursorLine, focusEditor } from '../editor/EditorArea'
import { SplitEditor, closeSplit, splitRight, useSplit } from '../editor/SplitEditor'
import { RenamePreview } from '../editor/RenamePreview'
import { BreakpointsDialog } from '../debug/BreakpointsDialog'
import { StashDialog, UnstashDialog, useStashUi } from '../git/Stash'
import { GO_TOOLS, GoGetDialog, runGoTool } from '../run/GoTools'
import { GenerateMenu, ImplementDialog, openGenerate } from '../editor/Generate'
import { extract } from '../editor/extract'
import { RecentLocations } from '../editor/RecentLocations'
import { installNavigation, navigateBack, navigateForward, openRecentLocations } from '../editor/navigation'
import { UsagesPanel, showUsages } from '../panels/UsagesPanel'
import { CoveragePanel } from '../panels/CoveragePanel'
import { NotificationsPanel } from '../panels/NotificationsPanel'
import { StructurePanel } from '../panels/StructurePanel'
import { DocumentationPanel } from '../panels/DocumentationPanel'
import { installStructure } from '../editor/structure'
import { askMnemonic, installBookmarks, jumpToMnemonic, toggleBookmark, useBookmarks, type Bookmark } from '../editor/bookmarks'
import { BookmarksDialog, MnemonicDialog } from '../editor/BookmarksDialog'
import { changeSignature, inlineCall, safeDelete } from '../editor/refactor'
import { SafeDeleteDialog } from '../editor/SafeDeleteDialog'
import { BranchCompareDialog } from '../git/BranchCompare'
import { AddWorktreeDialog, WorktreesDialog } from '../git/Worktrees'
import { RebaseDialog } from '../git/RebaseDialog'
import { AttachDialog, useAttachUi } from '../debug/AttachDialog'
import { installBranchContext, useBranchContexts, type BranchContext } from '../git/branchContext'
import { installRecursion } from '../editor/recursion'
import { installTemplates } from '../editor/templates'
import { installCoverage } from '../editor/coverage'
import { installInlineValues } from '../editor/inlineValues'
import { superMethods } from '../editor/lsp/adapter'
import { useDocs, tabKeyOf } from '../editor/docs'
import { attachLsp } from '../editor/lsp/adapter'
import { installAutosave } from '../editor/autosave'
import { ProjectPanel } from '../panels/ProjectPanel'
import { CommitPanel } from '../panels/CommitPanel'
import { RunPanel } from '../panels/RunPanel'
import { ProblemsPanel } from '../panels/ProblemsPanel'
import { StubPanel } from '../panels/StubPanel'
import { DebugPanel } from '../panels/DebugPanel'
import { TestsPanel, installAutoRerun } from '../panels/TestsPanel'
import { TerminalPanel } from '../panels/TerminalPanel'
import { GitLogPanel, showFileHistory } from '../panels/GitLogPanel'
import { installBlame, toggleBlame } from '../editor/blame'
import { useDebug, isPaused, isDebugging } from '../state/debug'
import { installDebugDecorations } from '../editor/breakpoints'
import { installVcsGutter } from '../editor/vcsGutter'
import { useCommitHistory, useGitUi, useFavoriteBranches, useChangelists, type Changelist } from '../state/git'
import { PushDialog } from '../git/PushDialog'
import { ConflictsDialog, MergeView } from '../git/Conflicts'
import { RunConfigDialog, openRunConfigs } from '../run/RunConfigDialog'
import { useApp, windowForConfig } from '../state/app'
import { api } from '../lib/api'
import { installKeymap, registerActions } from '../lib/keymap'
import { openAiEdit } from '../editor/aiEdit'
import { SearchEverywhere } from '../search/SearchEverywhere'
import { FindInFiles } from '../search/FindInFiles'
import { trackRecentFiles, useSearchUi } from '../search/state'
import { usePrefs } from '../state/settings'
import { openSettings } from '../settings/SettingsDialog'
import { editorSelectionText } from '../editor/EditorArea'
import { t, tn } from '../i18n'

function Panel({ side }: { side: Side }): ReactNode {
  const id = useLayout((s) => s.open[side])
  if (!id) return null
  return <ToolWindowHost value={{ id, place: side }}>{panelFor(id, side)}</ToolWindowHost>
}

function panelFor(id: string, side: Side | 'float'): ReactNode {
  switch (id) {
    case 'project':
      return <ProjectPanel />
    case 'commit':
      return <CommitPanel />
    case 'run':
      return <RunPanel />
    case 'problems':
      return <ProblemsPanel />
    case 'debug':
      return <DebugPanel />
    case 'tests':
      return <TestsPanel />
    case 'terminal':
      return <TerminalPanel />
    case 'git':
      return <GitLogPanel />
    case 'find':
      return <UsagesPanel />
    case 'coverage':
      return <CoveragePanel />
    case 'notifications':
      return <NotificationsPanel />
    case 'structure':
      return <StructurePanel />
    case 'documentation':
      return <DocumentationPanel />
    default:
      return <StubPanel side={side === 'float' ? 'bottom' : side} screen={toolWindows.find((w) => w.id === id)!.screen} />
  }
}

/** Guarda abas e layout do projeto (debounce de 1s) e restaura ao abrir. */
function useWorkspacePersistence(projectId: string) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let ready = false
    api.Workspace.Load(projectId)
      .then(async (ws) => {
        const st = ws as {
          layout?: { open: Record<Side, string | null>; sizes: Record<Side, number>; placement?: Record<string, Place>; floats?: Record<string, FloatBox> }
          tabs?: string[]
          active?: string | null
          watches?: string[]
          commitMessages?: string[]
          bookmarks?: Bookmark[]
          favoriteBranches?: string[] | null
          branchContexts?: Record<string, BranchContext>
          changelists?: Changelist[]
        }
        if (st.layout) useLayout.getState().restore(st.layout)
        useDebug.setState({ watches: st.watches ?? [] })
        useCommitHistory.setState({ messages: st.commitMessages ?? [] })
        useBookmarks.setState({ list: st.bookmarks ?? [] })
        useFavoriteBranches.setState({ list: st.favoriteBranches ?? null })
        useBranchContexts.setState({ byBranch: st.branchContexts ?? {} })
        useChangelists.setState({ lists: st.changelists ?? [] })
        for (const key of st.tabs ?? []) await useDocs.getState().open(key, { preview: false }).catch(() => {})
        if (st.active && useDocs.getState().tabs.some((t) => tabKeyOf(t) === st.active)) useDocs.getState().activate(st.active)
      })
      .finally(() => (ready = true))
    const save = () => {
      if (!ready) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        const { open, sizes, placement, floats } = useLayout.getState()
        const { tabs, active } = useDocs.getState()
        const fileTabs = tabs.filter((t) => t.kind === 'file' && !t.key.startsWith('ext:')).map(tabKeyOf)
        api.Workspace.Save(projectId, { layout: { open, sizes, placement, floats }, watches: useDebug.getState().watches, commitMessages: useCommitHistory.getState().messages, bookmarks: useBookmarks.getState().list, favoriteBranches: useFavoriteBranches.getState().list, branchContexts: useBranchContexts.getState().byBranch, changelists: useChangelists.getState().lists, tabs: fileTabs, active: active && fileTabs.includes(active) ? active : null }).catch(() => {})
      }, 1000)
    }
    const a = useLayout.subscribe(save)
    const b = useDocs.subscribe((s, prev) => (s.tabs !== prev.tabs || s.active !== prev.active) && save())
    const c = useDebug.subscribe((s, prev) => s.watches !== prev.watches && save())
    const d = useCommitHistory.subscribe(save)
    const e = useBookmarks.subscribe((s, prev) => s.list !== prev.list && save())
    const f = useFavoriteBranches.subscribe(save)
    const g = useBranchContexts.subscribe(save)
    const h = useChangelists.subscribe(save)
    return () => {
      a()
      b()
      c()
      d()
      e()
      f()
      g()
      h()
      clearTimeout(timer)
    }
  }, [projectId])
}

let lastQuickDoc = 0

/** Ctrl+U: salta do método concreto para o método da interface que ele implementa. */
async function goToSuper() {
  const ed = currentEditor()
  const m = ed?.getModel()
  const pos = ed?.getPosition()
  if (!ed || !m || !pos) return
  const locs = await superMethods(m.uri.toString(), pos.lineNumber - 1, pos.column - 1)
  if (!locs.length) return toast('info', t('Nenhuma interface acima'), t('O cursor precisa estar num método que implementa uma interface do projeto (ou da stdlib).'))
  const [first, ...rest] = locs
  await useDocs.getState().openUri(first.uri, first.range.start.line + 1, first.range.start.character + 1)
  if (rest.length) toast('info', tn(rest.length, 'Implementa mais {n} interface', 'Implementa mais {n} interfaces'), rest.map((l) => decodeURIComponent(l.uri).split('/').slice(-2).join('/') + ':' + (l.range.start.line + 1)).join('\n'))
}

export function AppShell() {
  const project = useApp((s) => s.project)!
  const { open, sizes, resize } = useLayout()
  const splitOpen = useSplit((s) => s.keys.length > 0)
  const splitWidth = useSplit((s) => s.width)

  // Documentos e gopls do projeto.
  useEffect(() => {
    useDocs.getState().reset(project.id, project.rootPath)
    const detach = attachLsp(project.id, {
      ensureModel: (uri) => useDocs.getState().ensureModel(uri),
      openUri: (uri, line, col) => useDocs.getState().openUri(uri, line, col),
      isProjectUri: (uri) => decodeURIComponent(uri).startsWith('file://' + project.rootPath + '/'),
    })
    return () => {
      detach()
      useDocs.getState().reset(null, '')
    }
    // O LSP reconecta sozinho quando a confiança muda (o hub recusa até lá).
  }, [project.id, project.rootPath])

  useWorkspacePersistence(project.id)
  useEffect(() => installAutosave(), [project.id])
  useEffect(() => installVcsGutter(), [project.id])
  useEffect(() => trackRecentFiles(), [project.id])
  useEffect(() => installBlame(), [project.id])
  useEffect(() => installCoverage(project.id), [project.id])
  useEffect(() => installInlineValues(), [project.id])
  useEffect(() => installStructure(), [project.id])
  useEffect(() => installNavigation(), [project.id])
  useEffect(() => installBookmarks(), [project.id])
  useEffect(() => installRecursion(), [project.id])
  useEffect(() => installTemplates(), [])
  useEffect(() => installAutoRerun(), [project.id])
  useEffect(() => installBranchContext(), [project.id])
  useEffect(() => {
    void useDebug.getState().load(project.id)
    return installDebugDecorations()
  }, [project.id])

  // Ações e atalhos da janela principal.
  useEffect(() => {
    const L = useLayout.getState
    const A = useApp.getState
    const S = useSearchUi.getState
    const toggleKeys = toolWindows
      .filter((w) => w.keys)
      .map((w) => ({ id: `toolwindow.${w.id}`, title: t('Mostrar/esconder {title}', { title: w.title }), keys: w.keys, inTerminal: true, run: () => L().toggle(w.id) }))
    const inEditor = () => !!document.activeElement?.closest('.monaco-editor')
    const off = registerActions([
      ...toggleKeys,
      { id: 'file.saveAll', title: t('Salvar tudo'), keys: 'Mod+S', run: () => useDocs.getState().saveAll({ format: usePrefs.getState()['editor.formatOnSave'] }) },
      { id: 'search.everywhere', title: t('Buscar em tudo'), run: () => S().openEverywhere('all') },
      {
        id: 'vcs.annotate',
        title: t('Anotar com git blame'),
        run: () => {
          const ed = currentEditor()
          if (ed) void toggleBlame(ed)
        },
      },
      {
        id: 'vcs.fileHistory',
        title: t('Histórico do arquivo'),
        run: () => {
          const key = useDocs.getState().active
          if (key && !key.startsWith('ext:') && !key.startsWith('diff:')) showFileHistory(key)
        },
      },
      {
        id: 'find.usages',
        title: t('Buscar usos'),
        keys: 'Alt+F7',
        when: () => !!document.activeElement?.closest('.monaco-editor'),
        run: () => {
          const ed = currentEditor()
          if (ed) void showUsages(ed)
        },
      },
      {
        // Ctrl+Q: a documentação num balão; de novo logo em seguida, fixa na janela Documentação.
        id: 'doc.quick',
        title: t('Documentação rápida (de novo: fixar)'),
        keys: 'Mod+Q',
        when: () => !!document.activeElement?.closest('.monaco-editor'),
        run: () => {
          const now = Date.now()
          if (now - lastQuickDoc < 1500) {
            lastQuickDoc = 0
            L().show('documentation')
            setTimeout(() => currentEditor()?.focus(), 0)
            return
          }
          lastQuickDoc = now
          currentEditor()?.trigger('keyboard', 'editor.action.showHover', {})
        },
      },
      { id: 'refactor.extractVariable', title: t('Extrair variável'), keys: 'Mod+Alt+V', when: () => !!document.activeElement?.closest('.monaco-editor'), run: () => extract('variable') },
      { id: 'refactor.extractFunction', title: t('Extrair função'), keys: 'Mod+Alt+M', when: () => !!document.activeElement?.closest('.monaco-editor'), run: () => extract('function') },
      { id: 'nav.back', title: t('Voltar (navegação)'), keys: 'Mod+Alt+ArrowLeft', run: navigateBack },
      { id: 'nav.forward', title: t('Avançar (navegação)'), keys: 'Mod+Alt+ArrowRight', run: navigateForward },
      { id: 'nav.recentLocations', title: t('Locais recentes'), keys: 'Mod+Shift+E', run: openRecentLocations },
      { id: 'refactor.inline', title: t('Inline (chamada de função)'), keys: 'Mod+Alt+N', when: inEditor, run: inlineCall },
      { id: 'refactor.changeSignature', title: t('Mudar assinatura (mover/remover parâmetro)'), keys: 'Mod+F6', when: inEditor, run: changeSignature },
      { id: 'refactor.safeDelete', title: t('Safe delete'), keys: 'Alt+Delete', when: inEditor, run: () => void safeDelete(project.rootPath) },
      { id: 'bookmark.toggle', title: t('Marcar/desmarcar bookmark'), keys: 'F11', run: toggleBookmark },
      { id: 'bookmark.mnemonic', title: t('Bookmark com mnemônico'), keys: 'Mod+F11', run: askMnemonic },
      { id: 'bookmark.list', title: t('Mostrar bookmarks'), keys: 'Shift+F11', run: () => useBookmarks.setState({ dialog: true }) },
      ...[...'1234567890'].map((d) => ({ id: `bookmark.goto.${d}`, title: t('Ir ao bookmark {d}', { d }), keys: `Mod+${d}`, run: () => jumpToMnemonic(d) })),
      {
        id: 'editor.aiEdit',
        title: t('Pedir código à IA'),
        keys: 'Mod+\\',
        when: inEditor,
        run: () => {
          const ed = currentEditor()
          if (ed) openAiEdit(ed)
        },
      },
      {
        id: 'code.generate',
        title: t('Gerar código (construtor, teste)'),
        keys: 'Alt+Insert',
        when: () => !!document.activeElement?.closest('.monaco-editor'),
        run: () => void openGenerate(),
      },
      {
        id: 'goto.super',
        title: t('Ir para o método da interface (super)'),
        keys: 'Mod+U',
        when: () => !!document.activeElement?.closest('.monaco-editor'),
        run: () => void goToSuper(),
      },
      {
        id: 'run.coverage',
        title: t('Rodar com cobertura'),
        run: () => {
          const id = A().selectedConfig
          const cfg = A().runConfigs.find((c) => c.id === id)
          if (!cfg || cfg.type !== 'go_test') return toast('info', t('Escolha uma configuração Go Test'), t('Ou use o botão direito no ▶ de um teste: "Rodar com cobertura".'))
          void A().runConfig(cfg.id, { coverage: true })
          L().show('tests')
        },
      },
      ...GO_TOOLS.map((g) => ({ id: 'go.' + g.id, title: g.title, run: () => void runGoTool(g.id).catch((e) => toast('danger', t('Não foi possível rodar {title}', { title: g.title }), String(e.message))) })),
      { id: 'vcs.stash', title: t('Guardar mudanças (stash)'), run: () => useStashUi.setState({ save: true }) },
      { id: 'vcs.unstash', title: t('Recuperar stash'), run: () => useStashUi.setState({ restore: true }) },
      { id: 'editor.splitRight', title: t('Dividir à direita'), run: () => splitRight() },
      { id: 'editor.unsplit', title: t('Fechar a divisão'), run: () => closeSplit() },
      { id: 'run.editConfigs', title: t('Editar configurações de execução'), run: () => openRunConfigs() },
      { id: 'settings.open', title: t('Configurações'), keys: 'Mod+Alt+S', inTerminal: true, run: () => openSettings() },
      { id: 'goto.file', title: t('Ir para arquivo'), keys: 'Mod+Shift+N', run: () => S().openEverywhere('files') },
      { id: 'goto.symbol', title: t('Ir para símbolo'), keys: 'Mod+Alt+Shift+N', run: () => S().openEverywhere('symbols') },
      { id: 'goto.action', title: t('Buscar ação'), keys: 'Mod+Shift+A', run: () => S().openEverywhere('actions') },
      { id: 'find.inFiles', title: t('Buscar nos arquivos'), keys: 'Mod+Shift+F', run: () => S().openFind(false, editorSelectionText()) },
      { id: 'find.replaceInFiles', title: t('Substituir nos arquivos'), keys: 'Mod+Shift+R', run: () => S().openFind(true, editorSelectionText()) },
      { id: 'vcs.commit', title: t('Commit'), keys: 'Mod+K', run: () => L().show('commit') },
      { id: 'vcs.push', title: t('Push'), keys: 'Mod+Shift+K', run: () => useGitUi.getState().openPush() },
      { id: 'vcs.update', title: t('Atualizar projeto'), keys: 'Mod+T', run: () => void useGitUi.getState().update('merge') },
      { id: 'vcs.branches', title: t('Branches'), keys: 'Mod+Shift+`', run: () => useGitUi.getState().setBranchesOpen(true) },
      {
        id: 'run.selected',
        title: t('Rodar a configuração escolhida'),
        keys: 'Shift+F10',
        run: () => {
          const id = A().selectedConfig
          if (!id) return toast('info', t('Nenhuma configuração'), t('Clique no ▶ ao lado de func main() para criar uma.'))
          A().runConfig(id)
          L().show(windowForConfig(id))
        },
      },
      {
        id: 'run.rerun',
        title: t('Rodar de novo'),
        keys: 'Mod+F5',
        run: () => {
          const last = A().runs[0]
          if (last) A().runConfig(last.configId)
        },
      },
      {
        id: 'run.stop',
        title: t('Parar'),
        keys: 'Mod+F2',
        run: () => {
          if (isDebugging()) return void useDebug.getState().stop()
          const live = A().runs.find((r) => r.state === 'running' || r.state === 'building')
          if (live) A().stopRun(live.id)
        },
      },
      {
        id: 'debug.selected',
        title: t('Depurar a configuração escolhida'),
        keys: 'Shift+F9',
        run: () => {
          const id = A().selectedConfig
          if (!id) return toast('info', t('Nenhuma configuração'), t('Use o botão direito no ▶ ao lado de func main() e escolha Depurar.'))
          void useDebug.getState().start(id)
        },
      },
      { id: 'debug.breakpoints', title: t('Ver breakpoints'), keys: 'Mod+Shift+F8', run: () => useDebug.getState().openDialog() },
      { id: 'debug.mute', title: t('Silenciar breakpoints (liga/desliga)'), run: () => void useDebug.getState().setMuted(!useDebug.getState().muted) },
      { id: 'debug.resume', title: t('Continuar'), keys: 'F9', when: isPaused, run: () => void useDebug.getState().control('resume') },
      { id: 'debug.stepOver', title: t('Passar por cima'), keys: 'F8', when: isPaused, run: () => void useDebug.getState().control('stepOver') },
      { id: 'debug.stepInto', title: t('Entrar'), keys: 'F7', when: isPaused, run: () => void useDebug.getState().control('stepInto') },
      { id: 'debug.attach', title: t('Anexar o depurador a um processo…'), keys: 'Mod+Alt+F5', run: () => useAttachUi.setState({ open: true }) },
      {
        id: 'debug.runToCursor',
        title: t('Rodar até o cursor'),
        keys: 'Alt+F9',
        when: isPaused,
        run: () => void useDebug.getState().runToCursor(useDocs.getState().active, currentEditor()?.getPosition()?.lineNumber),
      },
      { id: 'debug.stepOut', title: t('Sair da função'), keys: 'Shift+F8', when: isPaused, run: () => void useDebug.getState().control('stepOut') },
      {
        id: 'debug.toggleBreakpoint',
        title: t('Liga/desliga breakpoint'),
        keys: 'Mod+F8',
        run: () => {
          const key = useDocs.getState().active
          const line = editorCursorLine()
          if (key && line && key.endsWith('.go') && !key.startsWith('ext:') && !key.startsWith('diff:')) void useDebug.getState().toggle(key, line)
        },
      },
      {
        id: 'editor.closeTab',
        title: t('Fechar aba'),
        keys: 'Mod+F4',
        run: () => {
          const a = useDocs.getState().active
          if (a) useDocs.getState().close(a)
        },
      },
      {
        id: 'editor.focus',
        title: t('Ir para o editor'),
        keys: 'Escape',
        when: () => !!document.activeElement?.closest('[data-toolwindow]') && !document.querySelector('[role=dialog]'),
        run: () => focusEditor(),
      },
    ])
    const offKeys = installKeymap()
    const onShow = (e: Event) => L().show((e as CustomEvent<string>).detail)
    window.addEventListener('prumo:show-toolwindow', onShow)

    // Shift duas vezes (sem outra tecla no meio): Buscar em tudo. Digitar "AB" não conta.
    let lastShift = 0
    const onShiftUp = (e: KeyboardEvent) => {
      if (e.key !== 'Shift') return
      const now = Date.now()
      if (now - lastShift < 350) {
        lastShift = 0
        if (!S().find && !document.querySelector(`[role=dialog]:not([aria-label="${t('Buscar em tudo')}"])`)) S().openEverywhere('all')
        return
      }
      lastShift = now
    }
    const onOtherKey = (e: KeyboardEvent) => e.key !== 'Shift' && (lastShift = 0)
    window.addEventListener('keyup', onShiftUp, true)
    window.addEventListener('keydown', onOtherKey, true)
    return () => {
      off()
      offKeys()
      window.removeEventListener('prumo:show-toolwindow', onShow)
      window.removeEventListener('keyup', onShiftUp, true)
      window.removeEventListener('keydown', onOtherKey, true)
    }
  }, [])

  return (
    <div className="flex h-full flex-col bg-surface text-text">
      <HeaderBar />
      <div className="flex min-h-0 flex-1">
        <Stripe side="left" />
        {open.left && (
          <>
            <div style={{ width: sizes.left }} className="shrink-0">
              <Panel side="left" />
            </div>
            <Splitter orientation="vertical" label={t('Largura da janela da esquerda')} value={sizes.left} min={sizeLimits.left.min} max={sizeLimits.left.max} defaultValue={sizeLimits.left.def} onChange={(v) => resize('left', v)} />
          </>
        )}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1">
              <EditorArea />
            </div>
            {splitOpen && (
              <>
                <Splitter orientation="vertical" invert label={t('Largura do editor da direita')} value={splitWidth} min={240} max={1400} defaultValue={560} onChange={(v) => useSplit.setState({ width: v })} />
                <div style={{ width: splitWidth }} className="shrink-0">
                  <SplitEditor />
                </div>
              </>
            )}
          </div>
          {open.bottom && (
            <>
              <Splitter orientation="horizontal" invert label={t('Altura da janela de baixo')} value={sizes.bottom} min={sizeLimits.bottom.min} max={sizeLimits.bottom.max} defaultValue={sizeLimits.bottom.def} onChange={(v) => resize('bottom', v)} />
              <div style={{ height: sizes.bottom }} className="shrink-0">
                <Panel side="bottom" />
              </div>
            </>
          )}
        </main>
        {open.right && (
          <>
            <Splitter orientation="vertical" invert label={t('Largura da janela da direita')} value={sizes.right} min={sizeLimits.right.min} max={sizeLimits.right.max} defaultValue={sizeLimits.right.def} onChange={(v) => resize('right', v)} />
            <div style={{ width: sizes.right }} className="shrink-0">
              <Panel side="right" />
            </div>
          </>
        )}
        <Stripe side="right" />
      </div>
      <StatusBar />
      <FloatingWindows render={(id) => panelFor(id, 'float')} />
      <PushDialog />
      <RenamePreview />
      <BreakpointsDialog />
      <StashDialog />
      <GoGetDialog />
      <GenerateMenu />
      <BookmarksDialog />
      <MnemonicDialog />
      <SafeDeleteDialog />
      <BranchCompareDialog />
      <WorktreesDialog />
      <AddWorktreeDialog />
      <RebaseDialog />
      <AttachDialog />
      <ImplementDialog />
      <RecentLocations />
      <UnstashDialog />
      <ConflictsDialog />
      <RunConfigDialog />
      <MergeView />
      <SearchEverywhere />
      <FindInFiles />
    </div>
  )
}
