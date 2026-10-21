// Documentação fixada (Ctrl+Q duas vezes): a doc do símbolo sob o cursor, atualizada enquanto ele anda.
import { useEffect, useState } from 'react'
import { monaco } from '../editor/monaco'
import { hoverAt } from '../editor/lsp/adapter'
import { currentEditor, useCursor } from '../editor/EditorArea'
import { useDocs } from '../editor/docs'
import { ToolWindowFrame } from '../shell/ToolWindows'
import { EmptyState } from '../design/feedback'
import { t } from '../i18n'

type Block = { code: true; lang: string; text: string; html?: string } | { code: false; text: string }

/** Markdown do gopls em blocos: código (colorido pelo Monaco) e texto (parágrafos). */
function parse(md: string): Block[] {
  const out: Block[] = []
  const re = /```(\w*)\n([\s\S]*?)```/g
  let last = 0
  for (let m; (m = re.exec(md)); ) {
    if (m.index > last) out.push({ code: false, text: md.slice(last, m.index) })
    out.push({ code: true, lang: m[1] || 'go', text: m[2].replace(/\n$/, '') })
    last = re.lastIndex
  }
  if (last < md.length) out.push({ code: false, text: md.slice(last) })
  return out.filter((b) => b.text.trim())
}

/** Texto do markdown sem marcação: `código` fica em fonte mono, links viram só o texto. */
function Text({ text }: { text: string }) {
  const clean = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\\([\\`*_{}[\]()#+.!-])/g, '$1')
  return (
    <>
      {clean
        .split(/\n{2,}/)
        .filter((p) => p.trim())
        .map((p, i) => (
          <p key={i} className="mb-2 whitespace-pre-wrap text-sm text-text">
            {p.split(/(`[^`]+`)/).map((seg, k) =>
              seg.startsWith('`') && seg.endsWith('`') ? (
                <code key={k} className="rounded-xs bg-surface-raised px-1 font-mono text-xs">
                  {seg.slice(1, -1)}
                </code>
              ) : (
                <span key={k}>{seg.replace(/^---$/m, '')}</span>
              ),
            )}
          </p>
        ))}
    </>
  )
}

export function DocumentationPanel() {
  const line = useCursor((s) => s.line)
  const col = useCursor((s) => s.col)
  const active = useDocs((s) => s.active)
  const [blocks, setBlocks] = useState<Block[] | null>(null)
  useEffect(() => {
    let stale = false
    const timer = setTimeout(async () => {
      const m = currentEditor()?.getModel()
      if (!m || m.getLanguageId() !== 'go') return !stale && setBlocks([])
      const md = await hoverAt(m.uri.toString(), line - 1, col - 1)
      const bs = parse(md)
      // Código colorido com o tema do editor.
      await Promise.all(bs.map(async (b) => b.code && (b.html = await monaco.editor.colorize(b.text, b.lang, { tabSize: 4 }))))
      if (!stale) setBlocks(bs)
    }, 250)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [line, col, active])
  return (
    <ToolWindowFrame>
      {!blocks ? null : blocks.length === 0 ? (
        <EmptyState title={t('Sem documentação aqui')}>{t('Ponha o cursor num nome (função, tipo, variável) para ver a documentação dele.')}</EmptyState>
      ) : (
        <article aria-label={t('Documentação do símbolo')} className="selectable px-3 py-2">
          {blocks.map((b, i) =>
            b.code ? (
              <pre key={i} className="mb-2 overflow-x-auto rounded-md bg-bg p-2 font-mono text-code" dangerouslySetInnerHTML={{ __html: b.html ?? '' }} />
            ) : (
              <Text key={i} text={b.text} />
            ),
          )}
        </article>
      )}
    </ToolWindowFrame>
  )
}
