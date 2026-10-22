// Visualização renderizada de arquivos .md (alternativa ao texto cru do Monaco). Lê o modelo aberto e acompanha as edições.
import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { Marked } from 'marked'
import DOMPurify from 'dompurify'
import { monaco } from './monaco'

/** Abas .md que o usuário mandou mostrar como texto (o padrão é a visualização). */
export const useMarkdownView = create<{ source: Set<string>; toggle: (key: string) => void }>((set) => ({
  source: new Set(),
  toggle: (key) =>
    set((s) => {
      const next = new Set(s.source)
      if (!next.delete(key)) next.add(key)
      return { source: next }
    }),
}))

export const isMarkdown = (key: string) => /\.(md|markdown)$/i.test(key)

const marked = new Marked({
  gfm: true,
  renderer: {
    // Títulos com id no estilo do GitHub, para os links de índice (#secao) funcionarem.
    heading({ tokens, depth }) {
      const slug = this.parser.parseInline(tokens).replace(/<[^>]+>/g, '').trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-')
      return `<h${depth} id="${slug}">${this.parser.parseInline(tokens)}</h${depth}>\n`
    },
  },
})

/** Markdown -> HTML já sanitizado (sem scripts, handlers inline nem javascript:). */
export function renderMarkdown(src: string): string {
  return DOMPurify.sanitize(marked.parse(src, { async: false }), { USE_PROFILES: { html: true } })
}

export function MarkdownPreview({ uri }: { uri: string }) {
  const [text, setText] = useState(() => monaco.editor.getModel(monaco.Uri.parse(uri))?.getValue() ?? '')
  useEffect(() => {
    const model = monaco.editor.getModel(monaco.Uri.parse(uri))
    setText(model?.getValue() ?? '')
    if (!model) return
    let timer: ReturnType<typeof setTimeout>
    const sub = model.onDidChangeContent(() => {
      clearTimeout(timer)
      timer = setTimeout(() => setText(model.getValue()), 150)
    })
    return () => {
      clearTimeout(timer)
      sub.dispose()
    }
  }, [uri])
  const html = useMemo(() => renderMarkdown(text), [text])
  return (
    <div
      data-testid="markdown-preview"
      className="prumo-md h-full overflow-auto bg-bg px-8 py-6 text-text"
      // Links não navegam o webview da IDE; âncoras (#secao) rolam dentro da própria visualização.
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a')
        if (!a) return
        e.preventDefault()
        const href = a.getAttribute('href') ?? ''
        if (href.startsWith('#')) e.currentTarget.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`)?.scrollIntoView()
      }}
    >
      <article className="mx-auto max-w-3xl" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
