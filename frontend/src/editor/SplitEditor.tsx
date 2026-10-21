// Editor dividido: um segundo grupo de abas à direita. Usa os mesmos modelos do editor principal (o que se digita
// num lado aparece no outro na hora) e os mesmos providers do gopls; tem as próprias abas, cursor e rolagem.
import { useEffect, useRef } from 'react'
import { FileCode2, X } from 'lucide-react'
import { create } from 'zustand'
import { monaco } from './monaco'
import { useDocs } from './docs'
import { useApp } from '../state/app'
import { usePrefs, codeLineHeight } from '../state/settings'
import { IconButton } from '../design/controls'
import { cn } from '../design/cn'
import { setFocusedEditor } from './EditorArea'
import tokens from '../../design/tokens.json'
import { t } from '../i18n'

interface Split {
  keys: string[] // arquivos (chave do doc) abertos à direita
  active: string | null
  width: number
}

export const useSplit = create<Split>(() => ({ keys: [], active: null, width: 560 }))

/** Abre o arquivo ativo (ou o dado) também à direita. */
export function splitRight(key?: string | null) {
  const k = key ?? useDocs.getState().active
  if (!k || k.startsWith('diff:') || !useDocs.getState().docs[k]) return
  useSplit.setState((s) => {
    // Primeira divisão: metade da área do editor (o resto fica para o editor da esquerda).
    const area = document.querySelector('main')?.clientWidth ?? 0
    const width = s.keys.length === 0 && area > 0 ? Math.max(240, Math.round(area / 2)) : s.width
    return { keys: s.keys.includes(k) ? s.keys : [...s.keys, k], active: k, width }
  })
}

export function closeSplit() {
  useSplit.setState({ keys: [], active: null })
}

function closeTab(key: string) {
  useSplit.setState((s) => {
    const keys = s.keys.filter((k) => k !== key)
    const i = s.keys.indexOf(key)
    return { keys, active: s.active === key ? (keys[Math.min(i, keys.length - 1)] ?? null) : s.active }
  })
}

const views = new Map<string, monaco.editor.ICodeEditorViewState | null>()

export function SplitEditor() {
  const { keys, active } = useSplit()
  const docs = useDocs((s) => s.docs)
  const theme = useApp((s) => s.theme)
  const fontSize = usePrefs((s) => s['editor.fontSize'])
  const host = useRef<HTMLDivElement>(null)
  const ed = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const shown = useRef<string | null>(null)

  useEffect(() => {
    const e = monaco.editor.create(host.current!, {
      model: null,
      automaticLayout: true,
      fontFamily: tokens.font.mono,
      fontSize: usePrefs.getState()['editor.fontSize'],
      lineHeight: codeLineHeight(usePrefs.getState()['editor.fontSize']),
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'all',
      'semanticHighlighting.enabled': true,
      inlayHints: { enabled: usePrefs.getState()['editor.inlayHints'] ? 'on' : 'off' },
      fixedOverflowWidgets: true,
      tabSize: 4,
      insertSpaces: false,
      padding: { top: 4 },
      ariaLabel: t('Editor da direita'),
    })
    ed.current = e
    if (import.meta.env.DEV) (window as unknown as { __prumoSplitEditor?: unknown }).__prumoSplitEditor = e
    e.onDidFocusEditorText(() => setFocusedEditor(e))
    e.onDidBlurEditorText(() => void useDocs.getState().autosave())
    return () => {
      setFocusedEditor(null, e)
      e.dispose()
      ed.current = null
    }
  }, [])

  useEffect(() => {
    ed.current?.updateOptions({ fontSize, lineHeight: codeLineHeight(fontSize) })
  }, [fontSize, theme])

  // Troca o modelo ao trocar de aba, guardando cursor e rolagem de cada arquivo.
  useEffect(() => {
    const e = ed.current
    if (!e) return
    if (shown.current) views.set(shown.current, e.saveViewState())
    const doc = active ? docs[active] : undefined
    const model = doc ? monaco.editor.getModel(monaco.Uri.parse(doc.uri)) : null
    if (e.getModel() !== model) {
      e.setModel(model)
      const vs = active ? views.get(active) : null
      if (vs) e.restoreViewState(vs)
    }
    e.updateOptions({ readOnly: !!doc?.readOnly })
    shown.current = active
  }, [active, docs])

  return (
    <section aria-label={t('Editor dividido')} className="flex h-full min-w-0 flex-col border-l border-border bg-bg">
      <div className="flex h-editor-tab shrink-0 items-stretch border-b border-border">
        <div role="tablist" aria-label={t('Arquivos abertos à direita')} className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {keys.map((k) => {
            const isActive = k === active
            const doc = docs[k]
            const title = doc?.title ?? k.split('/').pop()
            return (
              <div
                key={k}
                role="tab"
                aria-selected={isActive}
                aria-label={title + (doc?.dirty ? t(', não salvo') : '')}
                tabIndex={isActive ? 0 : -1}
                title={k}
                onClick={() => useSplit.setState({ active: k })}
                onAuxClick={(e) => e.button === 1 && closeTab(k)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && useSplit.setState({ active: k })}
                className={cn(
                  'group relative flex max-w-empty-max shrink-0 cursor-default items-center gap-1.5 px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-focus',
                  isActive ? 'text-text' : 'text-text-muted hover:bg-hover',
                )}
              >
                <FileCode2 className="size-icon-sm shrink-0 text-accent-text" aria-hidden />
                <span className="truncate">{title}</span>
                <span
                  aria-hidden
                  title={t('Fechar {name} à direita', { name: title })}
                  onClick={(e) => (e.stopPropagation(), closeTab(k))}
                  className={cn('rounded-xs text-text-muted hover:bg-pressed hover:text-text', isActive ? 'flex' : 'hidden group-hover:flex')}
                >
                  <X className="size-icon-sm" />
                </span>
                {isActive && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-pill bg-accent" aria-hidden />}
              </div>
            )
          })}
        </div>
        <IconButton label={t('Fechar a divisão')} size="sm" className="mx-1 self-center" icon={<X className="size-icon-sm" />} onPress={closeSplit} />
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={host} className="absolute inset-0" />
      </div>
    </section>
  )
}
