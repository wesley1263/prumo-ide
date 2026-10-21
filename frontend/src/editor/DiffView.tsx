// S21 Diff: lado a lado ou unificado, navegação entre diferenças (F7 / Shift+F7) e, no diff do disco, reverter o
// trecho. Nesse caso o lado direito é o próprio arquivo aberto (editável): reverter é uma edição comum, que o
// Ctrl+Z desfaz e o salvamento automático grava.
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Columns2, FileCode2, Rows2, Undo2 } from 'lucide-react'
import { monaco } from './monaco'
import { useDocs } from './docs'
import { lineDiff, type Hunk } from './lineDiff'
import { revertHunk } from './vcsGutter'
import { api } from '../lib/api'
import { usePrefs, codeLineHeight } from '../state/settings'
import { Button, IconButton } from '../design/controls'
import { Banner } from '../design/feedback'
import { cn } from '../design/cn'
import tokens from '../../../replica/design/tokens.json'
import { t } from '../i18n'

// Modo escolhido vale para os próximos diffs.
let sideBySide = true

interface Props {
  projectId: string
  path: string
  rev?: string
  oldPath?: string
}

const KIND: Record<Hunk['kind'], string> = { added: t('adicionado'), deleted: t('apagado'), modified: t('modificado') }

export function DiffView({ projectId, path, rev, oldPath }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const ed = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const fontSize = usePrefs((s) => s['editor.fontSize'])
  const [split, setSplit] = useState(sideBySide)
  const [hunks, setHunks] = useState<Hunk[]>([])
  const [current, setCurrent] = useState(0)
  const [binary, setBinary] = useState(false)
  const [editable, setEditable] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const e = monaco.editor.createDiffEditor(host.current!, {
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      fontFamily: tokens.font.mono,
      fontSize: usePrefs.getState()['editor.fontSize'],
      lineHeight: codeLineHeight(usePrefs.getState()['editor.fontSize']),
      renderSideBySide: sideBySide,
      useInlineViewWhenSpaceIsLimited: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      stickyScroll: { enabled: false },
    })
    ed.current = e
    if (import.meta.env.DEV) (window as unknown as { __prumoDiffEditor?: unknown }).__prumoDiffEditor = e
    return () => {
      const m = e.getModel()
      e.setModel(null) // o widget larga os modelos antes de eles sumirem
      e.dispose()
      // O lado direito pode ser o modelo do arquivo aberto: esse fica.
      for (const x of [m?.original, m?.modified]) if (x && x.uri.scheme === 'inmemory') x.dispose()
      ed.current = null
    }
  }, [])

  useEffect(() => {
    ed.current?.updateOptions({ fontSize, lineHeight: codeLineHeight(fontSize) })
  }, [fontSize])

  useEffect(() => {
    sideBySide = split
    ed.current?.updateOptions({ renderSideBySide: split })
  }, [split])

  // Carrega as duas versões. No diff do disco, a direita é o modelo do editor (as edições aparecem nos dois).
  useEffect(() => {
    const e = ed.current
    if (!e) return
    let stale = false
    const subs: monaco.IDisposable[] = []
    setError(null)
    const load = rev?.startsWith('cmp:') ? api.Git.RefDiff(projectId, 'HEAD', rev.slice(4), path, oldPath) : rev ? api.Git.CommitDiff(projectId, rev, path, oldPath) : api.Git.Diff(projectId, path)
    load.then(
      async (d) => {
        if (stale) return
        const lang = monaco.languages.getLanguages().find((l) => l.extensions?.some((x) => path.endsWith(x)))?.id ?? 'plaintext'
        setBinary(d.binary)
        const original = monaco.editor.createModel(d.binary ? t('Arquivos binários diferem.') : d.left, lang)
        let modified: monaco.editor.ITextModel | null = null
        if (!rev && !d.binary) {
          const docs = useDocs.getState()
          modified = await docs.ensureModel(monaco.Uri.file(docs.root + '/' + path).toString())
        }
        const own = !modified
        if (!modified) modified = monaco.editor.createModel(d.binary ? '' : d.right, lang)
        if (stale) {
          original.dispose()
          if (own) modified.dispose()
          return
        }
        const old = e.getModel()
        e.setModel({ original, modified })
        for (const x of [old?.original, old?.modified]) if (x && x.uri.scheme === 'inmemory') x.dispose()
        const canEdit = !own && !useDocs.getState().docs[path]?.readOnly
        setEditable(canEdit)
        e.getModifiedEditor().updateOptions({ readOnly: !canEdit })
        const recompute = () => setHunks(lineDiff(original.getLinesContent(), modified!.getLinesContent()) ?? [])
        recompute()
        subs.push(modified.onDidChangeContent(recompute))
      },
      (err) => !stale && setError((err as Error).message),
    )
    return () => {
      stale = true
      subs.forEach((s) => s.dispose())
    }
  }, [projectId, path, rev, oldPath])

  useEffect(() => setCurrent((c) => Math.min(c, Math.max(0, hunks.length - 1))), [hunks.length])

  const goTo = (i: number) => {
    const e = ed.current
    const h = hunks[i]
    if (!e || !h) return
    setCurrent(i)
    const m = e.getModifiedEditor()
    const line = Math.max(1, Math.min(h.start, m.getModel()?.getLineCount() ?? 1))
    m.revealLineInCenter(line)
    m.setPosition({ lineNumber: line, column: 1 })
  }

  // F7 / Shift+F7 dentro do diff, como nas IDEs desktop.
  useEffect(() => {
    const e = ed.current
    if (!e) return
    const m = e.getModifiedEditor()
    const a = m.addAction({ id: 'prumo.diff.next', label: t('Próxima diferença'), keybindings: [monaco.KeyCode.F7], run: () => goTo(Math.min(hunks.length - 1, current + 1)) })
    const b = m.addAction({ id: 'prumo.diff.prev', label: t('Diferença anterior'), keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.F7], run: () => goTo(Math.max(0, current - 1)) })
    return () => {
      a.dispose()
      b.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hunks, current])

  const revert = () => {
    const m = ed.current?.getModifiedEditor().getModel()
    const h = hunks[current]
    if (m && h) revertHunk(m, h)
  }
  const openInEditor = () => {
    const h = hunks[current]
    void useDocs.getState().open(path, { line: h ? Math.max(1, h.start) : 1, preview: false })
  }

  const h = hunks[current]
  return (
    <div className="flex h-full flex-col">
      <div role="toolbar" aria-label="Diff" className="flex h-control-lg shrink-0 items-center gap-1 border-b border-border px-2">
        <IconButton label={t('Diferença anterior')} shortcut="Shift+F7" size="sm" icon={<ChevronUp className="size-icon-sm" />} isDisabled={current <= 0} onPress={() => goTo(current - 1)} />
        <IconButton label={t('Próxima diferença')} shortcut="F7" size="sm" icon={<ChevronDown className="size-icon-sm" />} isDisabled={current >= hunks.length - 1} onPress={() => goTo(current + 1)} />
        <span role="status" className="px-1 text-xs tabular-nums text-text-muted">
          {binary ? t('binário') : hunks.length === 0 ? t('Sem diferenças') : t('{i} de {n} · {kind}', { i: current + 1, n: hunks.length, kind: KIND[h?.kind ?? 'modified'] })}
        </span>
        <span className="flex-1" />
        {editable && (
          <Button size="sm" icon={<Undo2 className="size-icon-sm" />} isDisabled={!h} onPress={revert}>
            {t('Reverter trecho')}
          </Button>
        )}
        {!rev && (
          <IconButton label={t('Abrir no editor')} size="sm" icon={<FileCode2 className="size-icon-sm" />} onPress={openInEditor} />
        )}
        <div role="radiogroup" aria-label={t('Modo do diff')} className="ml-1 flex items-center rounded-md border border-border p-0.5">
          {(
            [
              [true, t('Lado a lado'), <Columns2 key="c" className="size-icon-sm" />],
              [false, t('Unificado'), <Rows2 key="r" className="size-icon-sm" />],
            ] as const
          ).map(([v, label, icon]) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={split === v}
              title={label}
              onClick={() => setSplit(v)}
              className={cn('flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-focus', split === v ? 'bg-selection text-text' : 'text-text-muted hover:bg-hover')}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      </div>
      {error && <Banner level="danger">{t('Não foi possível ler o diff: {error}', { error })}</Banner>}
      <div className="relative min-h-0 flex-1">
        <div ref={host} className="absolute inset-0" />
      </div>
    </div>
  )
}
