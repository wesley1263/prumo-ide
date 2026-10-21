// Extrair variável (Ctrl+Alt+V) e função (Ctrl+Alt+M): pede a extração ao gopls e, assim que ela entra, abre o
// rename inline no nome que o gopls inventou (newVar, newFunction), para o usuário dar o nome certo na hora.
import { monaco } from './monaco'
import { currentEditor } from './EditorArea'
import { toast } from '../design/feedback'
import { runAction } from './runAction'
import { t } from '../i18n'

const KIND = { variable: 'refactor.extract.variable', function: 'refactor.extract.function' } as const
const NAME = { variable: /\bnewVar\d*\b/, function: /\bnewFunction\d*\b/ } as const

export function extract(what: keyof typeof KIND) {
  const ed = currentEditor()
  const m = ed?.getModel()
  const sel = ed?.getSelection()
  if (!ed || !m || !sel) return
  if (sel.isEmpty()) return toast('info', t('Selecione o trecho'), what === 'variable' ? t('Selecione a expressão que vira variável.') : t('Selecione as linhas que viram função.'))
  const startLine = sel.startLineNumber
  // Espera a edição do gopls chegar e procura o nome novo perto de onde estava a seleção.
  const timer = setTimeout(() => {
    sub.dispose()
    toast('info', t('Nada para extrair aqui'), t('O gopls não ofereceu essa extração para a seleção.'))
  }, 6000)
  // A extração pode chegar em várias edições: espera elas pararem antes do rename (senão ele é cancelado).
  let settle: ReturnType<typeof setTimeout> | undefined
  const sub = m.onDidChangeContent(() => {
    clearTimeout(timer)
    clearTimeout(settle)
    settle = setTimeout(() => {
      sub.dispose()
      const from = Math.max(1, startLine - 3)
      const hits = m.findMatches(NAME[what].source, new monaco.Range(from, 1, m.getLineCount(), 1), true, true, null, false)
      const hit = hits[0]
      if (!hit) return
      ed.setSelection(hit.range)
      ed.revealRangeInCenter(hit.range)
      ed.focus()
      runAction(ed, 'editor.action.rename')
    }, 200)
  })
  runAction(ed, 'editor.action.codeAction', { kind: KIND[what], apply: 'first' })
}
