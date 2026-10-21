// Estrutura do arquivo ativo (janela Estrutura, Alt+7) e o caminho do símbolo sob o cursor (breadcrumbs).
import { create } from 'zustand'
import { monaco } from './monaco'
import { useDocs } from './docs'
import { useCursor } from './EditorArea'
import { documentSymbols, useLsp, type DocSymbol } from './lsp/adapter'

export const useStructure = create<{ key: string | null; symbols: DocSymbol[] }>(() => ({ key: null, symbols: [] }))

const contains = (s: DocSymbol, line: number) => line >= s.range.start.line && line <= s.range.end.line

/** Símbolos do de fora para o de dentro que contêm a linha (1-based). */
export function symbolPath(symbols: DocSymbol[], line1: number): DocSymbol[] {
  const out: DocSymbol[] = []
  let level = symbols
  for (;;) {
    const hit = level.find((s) => contains(s, line1 - 1))
    if (!hit) return out
    out.push(hit)
    level = hit.children ?? []
  }
}

export function useSymbolPath(): DocSymbol[] {
  const symbols = useStructure((s) => s.symbols)
  const key = useStructure((s) => s.key)
  const active = useDocs((s) => s.active)
  const line = useCursor((s) => s.line)
  return key === active ? symbolPath(symbols, line) : []
}

export function installStructure(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let seq = 0
  let sub: monaco.IDisposable | undefined
  const refresh = () => {
    clearTimeout(timer)
    timer = setTimeout(async () => {
      const docs = useDocs.getState()
      const key = docs.active
      const doc = key ? docs.docs[key] : undefined
      if (!doc || !key || !key.endsWith('.go')) return useStructure.setState({ key, symbols: [] })
      const mine = ++seq
      const symbols = await documentSymbols(doc.uri)
      if (mine === seq) useStructure.setState({ key, symbols })
    }, 300)
  }
  const watch = () => {
    sub?.dispose()
    const docs = useDocs.getState()
    const doc = docs.active ? docs.docs[docs.active] : undefined
    const model = doc ? monaco.editor.getModel(monaco.Uri.parse(doc.uri)) : null
    sub = model?.onDidChangeContent(refresh)
    refresh()
  }
  const offDocs = useDocs.subscribe((s, prev) => (s.active !== prev.active || s.docs !== prev.docs) && watch())
  const offLsp = useLsp.subscribe((s, prev) => s.state !== prev.state && s.state === 'ready' && refresh())
  watch()
  return () => {
    offDocs()
    offLsp()
    sub?.dispose()
    clearTimeout(timer)
  }
}
