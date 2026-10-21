// Refatorações pelo gopls: inline (Ctrl+Alt+N), mudar assinatura (Ctrl+F6: mover/remover parâmetro) e
// safe delete (Alt+Delete: só apaga a declaração se ninguém usa; senão mostra quem usa).
import { create } from 'zustand'
import { monaco } from './monaco'
import { currentEditor } from './EditorArea'
import { documentSymbols, findUsages, type DocSymbol, type Usage } from './lsp/adapter'
import { toast } from '../design/feedback'
import { runAction } from './runAction'
import { t } from '../i18n'

/** Pede a ação ao gopls; se nada mudar no arquivo em alguns segundos, avisa. */
function codeAction(kind: string, none: [string, string]) {
  const ed = currentEditor()
  const m = ed?.getModel()
  if (!ed || !m) return
  const timer = setTimeout(() => {
    sub.dispose()
    toast('info', ...none)
  }, 5000)
  const sub = m.onDidChangeContent(() => {
    clearTimeout(timer)
    sub.dispose()
  })
  runAction(ed, 'editor.action.codeAction', { kind, apply: 'first' })
}

export const inlineCall = () => codeAction('refactor.inline.call', [t('Nada para inline aqui'), t('Ponha o cursor numa chamada de função do projeto.')])

/** Ctrl+F6: as reescritas de parâmetro que o gopls oferece no cursor (mover para a esquerda/direita, remover não usado). */
export function changeSignature() {
  const ed = currentEditor()
  if (!ed) return
  runAction(ed, 'editor.action.codeAction', { kind: 'refactor.rewrite', apply: 'never' })
}

// ---------------------------------------------------------------- safe delete

export const useSafeDelete = create<{ blocked: { name: string; usages: Usage[]; root: string } | null }>(() => ({ blocked: null }))

const contains = (r: { start: { line: number; character: number }; end: { line: number; character: number } }, line: number, ch: number) =>
  (line > r.start.line || (line === r.start.line && ch >= r.start.character)) && (line < r.end.line || (line === r.end.line && ch <= r.end.character))

/** O símbolo mais interno cujo nome está sob o cursor. */
function symbolAt(list: DocSymbol[], line: number, ch: number): DocSymbol | null {
  for (const s of list) {
    if (!contains(s.range, line, ch)) continue
    const inner = symbolAt(s.children ?? [], line, ch)
    if (inner) return inner
    if (contains(s.selectionRange, line, ch)) return s
  }
  return null
}

export async function safeDelete(root: string) {
  const ed = currentEditor()
  const m = ed?.getModel()
  const pos = ed?.getPosition()
  if (!ed || !m || !pos) return
  const uri = m.uri.toString()
  const sym = symbolAt(await documentSymbols(uri), pos.lineNumber - 1, pos.column - 1)
  if (!sym) return toast('info', 'Safe delete', t('Ponha o cursor no nome de uma função, tipo, método, campo, constante ou variável do pacote.'))
  const at = sym.selectionRange.start
  const usages = (await findUsages(uri, at.line, at.character)) ?? []
  const others = usages.filter((u) => u.kind !== 'declaration')
  const shortName = sym.name.replace(/^\(\*?\w+\)\./, '')
  if (others.length) return useSafeDelete.setState({ blocked: { name: shortName, usages: others, root } })

  // Ninguém usa: apaga a declaração, o comentário de doc logo acima e uma linha em branco que sobrar.
  let start = sym.range.start.line + 1
  while (start > 1 && /^\s*\/\//.test(m.getLineContent(start - 1))) start--
  let end = sym.range.end.line + 1
  const last = m.getLineCount()
  // Só linhas em branco depois: é a última declaração do arquivo; apaga também as em branco de antes.
  let tail = end
  while (tail < last && m.getLineContent(tail + 1).trim() === '') tail++
  let edit: { range: monaco.Range; text: string }
  if (tail === last && start > 1) {
    while (start > 2 && m.getLineContent(start - 1).trim() === '') start--
    const newline = m.getLineContent(last) === '' ? '\n' : ''
    edit = { range: new monaco.Range(start - 1, m.getLineMaxColumn(start - 1), last, m.getLineMaxColumn(last)), text: newline }
  } else {
    if (end < last && m.getLineContent(end + 1).trim() === '') end++
    edit = { range: new monaco.Range(start, 1, end + 1, 1), text: '' }
  }
  ed.executeEdits('safe-delete', [edit])
  ed.pushUndoStop()
  toast('success', t('{name} apagado', { name: shortName }), t('Nenhum uso no projeto. Ctrl+Z desfaz.'))
}
