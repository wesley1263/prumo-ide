// Bookmarks: F11 marca a linha, Ctrl+F11 marca com mnemônico (0–9, A–Z), Ctrl+<dígito> pula, Shift+F11 lista.
// A marca é uma decoração no modelo (acompanha as edições); a linha nova vai para o estado do projeto.
import { create } from 'zustand'
import { monaco } from './monaco'
import { currentEditor } from './EditorArea'
import { useDocs } from './docs'

export interface Bookmark {
  key: string // arquivo, relativo ao projeto
  line: number
  mnemonic?: string
  description?: string
}

export const MNEMONICS = [...'1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ']

export const useBookmarks = create<{ list: Bookmark[]; dialog: boolean; mnemonicFor: { key: string; line: number } | null }>(() => ({
  list: [],
  dialog: false,
  mnemonicFor: null,
}))

const set = (list: Bookmark[]) => useBookmarks.setState({ list })
const here = () => {
  const ed = currentEditor()
  const key = useDocs.getState().active
  const line = ed?.getPosition()?.lineNumber
  return key && line && !key.startsWith('ext:') && ed?.getModel()?.uri.scheme === 'file' ? { key, line } : null
}

/** F11: marca ou desmarca a linha do cursor. */
export function toggleBookmark() {
  const h = here()
  if (!h) return
  const { list } = useBookmarks.getState()
  const i = list.findIndex((b) => b.key === h.key && b.line === h.line)
  set(i >= 0 ? list.filter((_, j) => j !== i) : [...list, h])
}

/** Ctrl+F11: pergunta o mnemônico da linha do cursor. */
export function askMnemonic() {
  const h = here()
  if (h) useBookmarks.setState({ mnemonicFor: h })
}

/** Grava o mnemônico (tira de quem o tinha); "" tira o mnemônico mas mantém a marca. */
export function setMnemonic(at: { key: string; line: number }, mnemonic: string) {
  const list = useBookmarks.getState().list.map((b) => (mnemonic && b.mnemonic === mnemonic ? { ...b, mnemonic: undefined } : b))
  const i = list.findIndex((b) => b.key === at.key && b.line === at.line)
  const mine = { ...(i >= 0 ? list[i] : at), mnemonic: mnemonic || undefined }
  set(i >= 0 ? list.map((b, j) => (j === i ? mine : b)) : [...list, mine])
}

export function removeBookmark(b: Bookmark) {
  set(useBookmarks.getState().list.filter((x) => x !== b))
}

export function describeBookmark(b: Bookmark, description: string) {
  set(useBookmarks.getState().list.map((x) => (x === b ? { ...x, description: description || undefined } : x)))
}

export function goToBookmark(b: Bookmark) {
  void useDocs.getState().open(b.key, { line: b.line, col: 1, preview: false })
}

/** Ctrl+<dígito>: vai ao bookmark com esse mnemônico. */
export function jumpToMnemonic(m: string) {
  const b = useBookmarks.getState().list.find((x) => x.mnemonic === m)
  if (b) goToBookmark(b)
}

// ---------------------------------------------------------------- decorações

const decor = new Map<string, { ids: string[]; marks: Bookmark[] }>() // uri → decorações e bookmarks na ordem

function keyOf(m: monaco.editor.ITextModel): string | null {
  for (const d of Object.values(useDocs.getState().docs)) if (d.uri === m.uri.toString()) return d.key
  return null
}

function apply(m: monaco.editor.ITextModel) {
  const key = keyOf(m)
  const mine = key ? useBookmarks.getState().list.filter((b) => b.key === key) : []
  const old = decor.get(m.uri.toString())
  const ids = m.deltaDecorations(
    old?.ids ?? [],
    mine.map((b) => ({
      range: new monaco.Range(Math.min(b.line, m.getLineCount()), 1, Math.min(b.line, m.getLineCount()), 1),
      options: {
        // Faixa própria na margem de glifos (a da esquerda é do ▶ de rodar).
        glyphMarginClassName: b.mnemonic ? `goide-bookmark goide-bookmark-m goide-bm-${b.mnemonic}` : 'goide-bookmark',
        glyphMargin: { position: monaco.editor.GlyphMarginLane.Right },
        glyphMarginHoverMessage: { value: `Bookmark${b.mnemonic ? ' ' + b.mnemonic : ''}${b.description ? ': ' + b.description : ''}` },
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    })),
  )
  decor.set(m.uri.toString(), { ids, marks: mine })
}

/** A decoração andou com a edição: leva a linha nova para a lista. */
function follow(m: monaco.editor.ITextModel) {
  const d = decor.get(m.uri.toString())
  if (!d || m.isDisposed()) return
  let changed = false
  const moved = new Map<Bookmark, number>()
  d.ids.forEach((id, i) => {
    const r = m.getDecorationRange(id)
    if (r && r.startLineNumber !== d.marks[i].line) moved.set(d.marks[i], r.startLineNumber)
  })
  if (!moved.size) return
  const list = useBookmarks.getState().list.map((b) => {
    const line = moved.get(b)
    if (line === undefined) return b
    changed = true
    return { ...b, line }
  })
  // Duas marcas na mesma linha (a de baixo foi apagada): fica uma.
  if (changed) set(list.filter((b, i) => list.findIndex((x) => x.key === b.key && x.line === b.line) === i))
}

// Os mnemônicos aparecem dentro da marca: uma regra por caractere.
function mnemonicCss() {
  if (document.getElementById('goide-bm-css')) return
  const st = document.createElement('style')
  st.id = 'goide-bm-css'
  st.textContent = MNEMONICS.map((c) => `.goide-bm-${c}::after{content:'${c}'}`).join('\n')
  document.head.appendChild(st)
}

export function installBookmarks(): () => void {
  mnemonicCss()
  const models = () => monaco.editor.getModels().filter((m) => m.uri.scheme === 'file')
  const all = () => models().forEach(apply)
  all()
  const subs = new Map<string, monaco.IDisposable>()
  let timer: ReturnType<typeof setTimeout> | undefined
  const watch = (m: monaco.editor.ITextModel) => {
    subs.get(m.uri.toString())?.dispose()
    subs.set(
      m.uri.toString(),
      m.onDidChangeContent(() => {
        clearTimeout(timer)
        timer = setTimeout(() => !m.isDisposed() && follow(m), 150)
      }),
    )
  }
  models().forEach(watch)
  const created = monaco.editor.onDidCreateModel((m) => {
    watch(m)
    setTimeout(() => !m.isDisposed() && apply(m), 0) // o doc é registrado logo depois do modelo
  })
  const offList = useBookmarks.subscribe((s, prev) => s.list !== prev.list && all())
  const offDocs = useDocs.subscribe((s, prev) => s.docs !== prev.docs && Object.keys(s.docs).length !== Object.keys(prev.docs).length && all())
  return () => {
    created.dispose()
    offList()
    offDocs()
    subs.forEach((d) => d.dispose())
    clearTimeout(timer)
    decor.clear()
  }
}
