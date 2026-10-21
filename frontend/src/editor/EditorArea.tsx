// Área central: abas, editor Monaco (um só, troca de modelo por aba), diff e estados vazios.
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { Bug, FileCode2, FileDiff, Play, Undo2, X, Columns2, ShieldCheck } from 'lucide-react'
import { hunkAt, revertHunk, type Hunk } from './vcsGutter'
import { ContextMenu } from '../design/ContextMenu'
import { useDebug } from '../state/debug'
import { monaco, setMonacoTheme } from './monaco'
import { tabKeyOf, useDocs, type Tab } from './docs'
import { useLsp } from './lsp/adapter'
import { cn } from '../design/cn'
import { Banner, EmptyState } from '../design/feedback'
import { Button, Kbd, IconButton } from '../design/controls'
import { useApp } from '../state/app'
import { keyLabel } from '../lib/keymap'
import { usePrefs, codeLineHeight } from '../state/settings'
import { blameHashAt, toggleBlame } from './blame'
import { showCommit, showFileHistory } from '../panels/GitLogPanel'
import { splitRight } from './SplitEditor'
import { DiffView } from './DiffView'
import tokens from '../../../replica/design/tokens.json'
import { t, tn } from '../i18n'

/** Posição do cursor, para a status bar. */
export const useCursor = create<{ line: number; col: number; selected: number }>(() => ({ line: 1, col: 1, selected: 0 }))

let editorRef: monaco.editor.IStandaloneCodeEditor | null = null
export const focusEditor = () => editorRef?.focus()
/** Linha do cursor no editor ativo (atalhos que agem "na linha atual"). */
export const editorCursorLine = () => editorRef?.getPosition()?.lineNumber
// O editor com foco por último: o principal ou o da divisão à direita (as ações agem nele).
let focusedRef: monaco.editor.ICodeEditor | null = null
/** Marca o editor que recebeu foco (ed=null com `unless`: esquece esse editor, que foi fechado). */
export function setFocusedEditor(ed: monaco.editor.ICodeEditor | null, unless?: monaco.editor.ICodeEditor) {
  if (ed) focusedRef = ed
  else if (focusedRef === unless) focusedRef = null
}
/** O editor de código (para ações que agem sobre o arquivo aberto). */
export const currentEditor = () => focusedRef ?? editorRef
/** Texto selecionado no editor (uma linha só; vira a consulta do Buscar nos arquivos). */
export const editorSelectionText = () => {
  const sel = editorRef?.getSelection()
  const m = editorRef?.getModel()
  if (!sel || !m || sel.isEmpty() || sel.startLineNumber !== sel.endLineNumber) return ''
  return m.getValueInRange(sel)
}

const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>()

function Tabs() {
  const { tabs, active, docs, activate, close } = useDocs()
  const activeIsFile = !!active && !active.startsWith('diff:')
  return (
    <div className="flex h-editor-tab shrink-0 items-stretch border-b border-border bg-bg">
    <div role="tablist" aria-label={t('Arquivos abertos')} className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
      {tabs.map((tab: Tab) => {
        const key = tabKeyOf(tab)
        const isActive = key === active
        const doc = tab.kind === 'file' ? docs[tab.key] : undefined
        const title = tab.kind === 'diff' ? (tab.path.split('/').pop() ?? tab.path) : (doc?.title ?? tab.key)
        const suffix = tab.kind === 'diff' ? (tab.rev ? ` (${tab.rev.startsWith('cmp:') ? '↔ ' + tab.rev.slice(4) : tab.rev.slice(0, 7)})` : ' (diff)') : ''
        return (
          <div
            key={key}
            role="tab"
            aria-label={title + suffix + (doc?.dirty ? t(', não salvo') : '')}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            title={tab.kind === 'diff' ? (tab.rev ? (tab.rev.startsWith('cmp:') ? t('Diff: {path} entre a branch atual e {branch}', { path: tab.path, branch: tab.rev.slice(4) }) : t('Diff: {path} no commit {hash}', { path: tab.path, hash: tab.rev.slice(0, 7) })) : t('Diff: {path}', { path: tab.path })) : tab.key.replace(/^ext:/, '')}
            onClick={() => activate(key)}
            onAuxClick={(e) => e.button === 1 && close(key)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && activate(key)}
            className={cn(
              'group relative flex max-w-empty-max shrink-0 cursor-default items-center gap-1.5 px-3 text-sm outline-none',
              isActive ? 'text-text' : 'text-text-muted hover:bg-hover',
              'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-focus',
            )}
          >
            {tab.kind === 'diff' ? <FileDiff className="size-icon-sm shrink-0 text-vcs-modified" /> : <FileCode2 className="size-icon-sm shrink-0 text-accent-text" />}
            <span className={cn('truncate', tab.kind === 'file' && tab.preview && 'italic')}>
              {title + suffix}
            </span>
            <span className="flex size-icon items-center justify-center">
              {doc?.dirty ? (
                <span aria-label={t('não salvo')} className="size-1.5 rounded-pill bg-text-muted group-hover:hidden" />
              ) : null}
              {/* Só mouse: dentro de role=tab não pode haver outro controle. Pelo teclado: Ctrl+F4. */}
              <span
                aria-hidden
                title={t('Fechar {name}', { name: title })}
                onClick={(e) => {
                  e.stopPropagation()
                  close(key)
                }}
                className={cn('rounded-xs text-text-muted hover:bg-pressed hover:text-text', isActive ? 'flex' : 'hidden group-hover:flex', doc?.dirty && 'hidden group-hover:flex')}
              >
                <X className="size-icon-sm" />
              </span>
            </span>
            {isActive && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-pill bg-accent" aria-hidden />}
          </div>
        )
      })}
    </div>
    <IconButton label={t('Dividir à direita')} size="sm" className="mx-1 self-center" icon={<Columns2 className="size-icon-sm" />} isDisabled={!activeIsFile} onPress={() => splitRight()} />
    </div>
  )
}

function EmptyEditor() {
  const shortcuts: Array<[string, string]> = [
    [t('Janela do projeto'), 'Alt+1'],
    [t('Commit'), 'Alt+0'],
    [t('Rodar configuração'), 'Shift+F10'],
    [t('Salvar tudo'), 'Mod+S'],
  ]
  return (
    <div className="flex h-full items-center justify-center bg-bg">
      <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-2 text-sm">
        {shortcuts.map(([label, keys]) => (
          <div key={label} className="contents">
            <dt className="text-right text-text-muted">{label}</dt>
            <dd>
              <Kbd>{keyLabel(keys)}</Kbd>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** Onde há ▶ no gutter: o func main de um pacote main, e cada TestX/BenchmarkX/FuzzX de um _test.go. */
interface RunTarget {
  line: number
  test?: string // nome do teste
  pkg?: boolean // todos os testes do pacote
}
function runTargets(model: monaco.editor.ITextModel): RunTarget[] {
  if (model.getLanguageId() !== 'go') return []
  const text = model.getValue()
  const lines = text.split('\n')
  const out: RunTarget[] = []
  if (model.uri.path.endsWith('_test.go')) {
    // ▶ na linha "package": todos os testes do pacote.
    const pkg = lines.findIndex((l) => /^package \w+/.test(l))
    if (pkg >= 0) out.push({ line: pkg + 1, pkg: true })
    lines.forEach((l, i) => {
      const m = /^func ((?:Test|Benchmark|Fuzz)[A-Za-z0-9_]*)\(/.exec(l)
      if (m) out.push({ line: i + 1, test: m[1] })
    })
  } else if (/^package main\b/m.test(text)) {
    lines.forEach((l, i) => /^func main\(\)/.test(l) && out.push({ line: i + 1 }))
  }
  return out
}

const keyOfModel = (m: monaco.editor.ITextModel) => Object.values(useDocs.getState().docs).find((d) => d.uri === m.uri.toString())?.key

function runTarget(key: string, t: RunTarget, mode: 'run' | 'debug' | 'coverage') {
  if (mode === 'debug') return void useDebug.getState().startFile(key, t.test)
  useApp.getState().runFile(key, t.test, { coverage: mode === 'coverage' })
  window.dispatchEvent(new CustomEvent('goide:show-toolwindow', { detail: t.test || t.pkg ? 'tests' : 'run' }))
}

export function EditorArea() {
  const host = useRef<HTMLDivElement>(null)
  const { tabs, active, docs, reveal } = useDocs()
  const theme = useApp((s) => s.theme)
  const project = useApp((s) => s.project)
  const answerTrust = useApp((s) => s.answerTrust)
  const lsp = useLsp()
  const activeTab = tabs.find((t) => tabKeyOf(t) === active)
  const activeDoc = activeTab?.kind === 'file' ? docs[activeTab.key] : undefined
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const fontSize = usePrefs((s) => s['editor.fontSize'])
  const inlayHints = usePrefs((s) => s['editor.inlayHints'])
  const [gutterMenu, setGutterMenu] = useState<{ x: number; y: number; key: string; target: RunTarget } | null>(null)
  const [vcsMenu, setVcsMenu] = useState<{ x: number; y: number; key: string; hunk: Hunk; model: monaco.editor.ITextModel } | null>(null)

  useEffect(() => setMonacoTheme(theme), [theme])

  // Cria o editor uma vez.
  useEffect(() => {
    const ed = monaco.editor.create(host.current!, {
      model: null,
      automaticLayout: true,
      fontFamily: tokens.font.mono,
      fontSize: usePrefs.getState()['editor.fontSize'],
      lineHeight: codeLineHeight(usePrefs.getState()['editor.fontSize']),
      glyphMargin: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'all',
      smoothScrolling: true,
      'semanticHighlighting.enabled': true,
      inlayHints: { enabled: usePrefs.getState()['editor.inlayHints'] ? 'on' : 'off' },
      fixedOverflowWidgets: true,
      tabSize: 4,
      insertSpaces: false,
      detectIndentation: true,
      bracketPairColorization: { enabled: false },
      guides: { indentation: true },
      padding: { top: 4 },
    })
    editorRef = ed
    // Gancho para os testes e2e (só no modo dev; some do build de produção).
    if (import.meta.env.DEV) (window as unknown as { __goideEditor?: unknown }).__goideEditor = ed
    ed.onDidChangeCursorSelection((e) => {
      const m = ed.getModel()
      useCursor.setState({
        line: e.selection.positionLineNumber,
        col: e.selection.positionColumn,
        selected: m ? m.getValueLengthInRange(e.selection) : 0,
      })
    })
    // Foco saiu do editor (para a árvore, o commit, o console...): grava o que estiver pendente.
    ed.onDidBlurEditorText(() => void useDocs.getState().autosave())
    ed.onDidFocusEditorText(() => setFocusedEditor(ed))
    // Anotar (git blame) e histórico do arquivo, no menu de contexto do editor.
    ed.addAction({
      id: 'goide.annotate',
      label: t('Anotar com git blame (liga/desliga)'),
      contextMenuGroupId: '9_vcs',
      contextMenuOrder: 1,
      run: (e) => void toggleBlame(e),
    })
    ed.addAction({
      id: 'goide.fileHistory',
      label: t('Histórico do arquivo (git)'),
      contextMenuGroupId: '9_vcs',
      contextMenuOrder: 2,
      run: (e) => {
        const m = e.getModel()
        const key = m && keyOfModel(m)
        if (key && !key.startsWith('ext:')) showFileHistory(key)
      },
    })
    ed.onMouseDown((e) => {
      // Clique na anotação do blame: o commit no Log.
      const hash = !e.event.rightButton && blameHashAt(e)
      if (hash) {
        showCommit(hash)
        return
      }
      const m = ed.getModel()
      const line = e.target.position?.lineNumber
      if (!m || !line || e.event.rightButton) return
      const key = keyOfModel(m)
      if (!key || key.startsWith('ext:')) return
      // Clique no número da linha: liga/desliga o breakpoint (só em arquivos Go do projeto).
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS && key.endsWith('.go')) {
        void useDebug.getState().toggle(key, line)
        return
      }
      // Clique no marcador de mudança: reverter o trecho ou ver o diff.
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS) {
        const h = hunkAt(m, line)
        if (h) setVcsMenu({ x: e.event.posx, y: e.event.posy, key, hunk: h, model: m })
        return
      }
      if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return
      const t = runTargets(m).find((r) => r.line === line)
      if (t) runTarget(key, t, 'run')
    })
    // Clique direito no ▶: rodar ou depurar. No número de uma linha com breakpoint: editar o breakpoint.
    ed.onContextMenu((e) => {
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) {
        const m = ed.getModel()
        const line = e.target.position?.lineNumber
        const key = m && keyOfModel(m)
        const bp = useDebug.getState().breakpoints.find((b) => b.kind === 'line' && b.filePath === key && b.line === line)
        if (bp) useDebug.getState().openDialog(bp.id)
        return
      }
      if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return
      const m = ed.getModel()
      const line = e.target.position?.lineNumber
      const key = m && keyOfModel(m)
      const t = m && line ? runTargets(m).find((r) => r.line === line) : undefined
      if (!key || !t) return
      e.event.preventDefault()
      e.event.stopPropagation()
      setGutterMenu({ x: e.event.posx, y: e.event.posy, key, target: t })
    })
    const onFocus = () => ed.focus()
    window.addEventListener('goide:focus-editor', onFocus)
    return () => {
      window.removeEventListener('goide:focus-editor', onFocus)
      editorRef = null
      setFocusedEditor(null, ed)
      ed.dispose()
    }
  }, [])

  // Preferências (S28) sem recriar o editor.
  useEffect(() => {
    editorRef?.updateOptions({ fontSize, lineHeight: codeLineHeight(fontSize), inlayHints: { enabled: inlayHints ? 'on' : 'off' } })
  }, [fontSize, inlayHints])

  // Troca de modelo ao trocar de aba, guardando a posição de rolagem/cursor de cada arquivo.
  const shownKey = useRef<string | null>(null)
  useEffect(() => {
    const ed = editorRef
    if (!ed) return
    if (shownKey.current) viewStates.set(shownKey.current, ed.saveViewState())
    if (!activeDoc) {
      shownKey.current = null
      ed.setModel(null)
      return
    }
    const model = monaco.editor.getModel(monaco.Uri.parse(activeDoc.uri))
    if (ed.getModel() !== model) {
      ed.setModel(model)
      const vs = viewStates.get(activeDoc.key)
      if (vs) ed.restoreViewState(vs)
    }
    ed.updateOptions({ readOnly: activeDoc.readOnly })
    shownKey.current = activeDoc.key
    if (model) {
      const update = () => {
        decorations.current?.clear()
        decorations.current = ed.createDecorationsCollection(
          runTargets(model).map((r) => ({
            range: new monaco.Range(r.line, 1, r.line, 1),
            options: {
              glyphMarginClassName: 'goide-run-glyph',
              glyphMarginHoverMessage: { value: (r.test ? t('Rodar {name}', { name: r.test }) : r.pkg ? t('Rodar os testes do pacote') : t('Rodar este programa')) + t(' · botão direito para depurar') },
            },
          })),
        )
      }
      update()
      const sub = model.onDidChangeContent(() => update())
      return () => sub.dispose()
    }
  }, [activeDoc?.key, activeDoc?.readOnly, activeDoc?.uri])

  // Revelar uma posição pedida (ir para definição, clicar num erro do console...).
  useEffect(() => {
    if (!reveal || !editorRef || reveal.key !== activeDoc?.key) return
    editorRef.setPosition({ lineNumber: reveal.line, column: reveal.col })
    editorRef.revealPositionInCenterIfOutsideViewport({ lineNumber: reveal.line, column: reveal.col })
    editorRef.focus()
  }, [reveal, activeDoc?.key])


  const restricted = project && !project.trusted
  const lspProblem = !restricted && (lsp.state === 'error' ? lsp.message || t('O gopls não respondeu.') : null)

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-bg">
      {tabs.length > 0 && <Tabs />}
      {restricted && (
        <Banner level="warning" actions={<Button size="sm" onPress={() => answerTrust(true)}>{t('Confiar no projeto')}</Button>}>
          {t('Modo restrito: análise de código, execução e commit estão desligados para este projeto.')}
        </Banner>
      )}
      {lspProblem && <Banner level="danger">{t('Análise de código indisponível: {problem}', { problem: lspProblem })}</Banner>}
      {activeDoc?.status === 'binary' && <Banner level="info">{t('Arquivo binário: não dá para mostrar o conteúdo.')}</Banner>}
      {activeDoc?.status === 'tooLarge' && <Banner level="info">{t('Arquivo grande demais para o editor (mais de 5 MB).')}</Banner>}
      {activeDoc?.key.startsWith('ext:') && <Banner level="info">{t('Arquivo de fora do projeto, aberto só para leitura.')}</Banner>}
      <div className="relative min-h-0 flex-1">
        {/* display:none, não visibility: o Monaco força visibility:visible em elementos internos. */}
        <div ref={host} className={cn('absolute inset-0', (!activeDoc || activeTab?.kind !== 'file') && 'hidden')} />
        {activeTab?.kind === 'diff' && project && (
          <div className="absolute inset-0">
            <DiffView key={tabKeyOf(activeTab)} projectId={project.id} path={activeTab.path} rev={activeTab.rev} oldPath={activeTab.oldPath} />
          </div>
        )}
        {!activeTab && (
          <div className="absolute inset-0">
            <EmptyEditor />
          </div>
        )}
        {gutterMenu && (
          <ContextMenu
            x={gutterMenu.x}
            y={gutterMenu.y}
            label={t('Rodar ou depurar')}
            items={[
              { id: 'run', label: gutterMenu.target.test ? t('Rodar {name}', { name: gutterMenu.target.test }) : gutterMenu.target.pkg ? t('Rodar os testes do pacote') : t('Rodar'), shortcut: keyLabel('Shift+F10'), icon: <Play className="size-icon-sm text-success" /> },
              { id: 'debug', label: gutterMenu.target.test ? t('Depurar {name}', { name: gutterMenu.target.test }) : gutterMenu.target.pkg ? t('Depurar os testes do pacote') : t('Depurar'), shortcut: keyLabel('Shift+F9'), icon: <Bug className="size-icon-sm" /> },
              ...(gutterMenu.target.test || gutterMenu.target.pkg
                ? [{ id: 'coverage', label: gutterMenu.target.test ? t('Rodar {name} com cobertura', { name: gutterMenu.target.test }) : t('Rodar os testes do pacote com cobertura'), icon: <ShieldCheck className="size-icon-sm text-success" /> }]
                : []),
            ]}
            onAction={(id) => runTarget(gutterMenu.key, gutterMenu.target, id as 'run' | 'debug' | 'coverage')}
            onClose={() => setGutterMenu(null)}
          />
        )}
        {vcsMenu && (
          <ContextMenu
            x={vcsMenu.x}
            y={vcsMenu.y}
            label={t('Trecho alterado')}
            items={[
              {
                id: 'revert',
                label: vcsMenu.hunk.kind === 'added' ? tn(vcsMenu.hunk.count, 'Remover a linha adicionada', 'Remover as {n} linhas adicionadas') : vcsMenu.hunk.kind === 'deleted' ? t('Restaurar as linhas apagadas') : t('Reverter este trecho'),
                icon: <Undo2 className="size-icon-sm" />,
              },
              { id: 'diff', label: t('Ver o diff do arquivo'), icon: <FileDiff className="size-icon-sm" /> },
            ]}
            onAction={(id) => {
              if (id === 'revert') revertHunk(vcsMenu.model, vcsMenu.hunk)
              if (id === 'diff') useDocs.getState().openDiff(vcsMenu.key)
            }}
            onClose={() => setVcsMenu(null)}
          />
        )}
        {activeTab?.kind === 'file' && !activeDoc && (
          <div className="absolute inset-0">
            <EmptyState title={t('Carregando…')} />
          </div>
        )}
      </div>
    </div>
  )
}
