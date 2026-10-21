// Rodar uma ação do Monaco pegando a promessa quando dá: editor.trigger a descarta, e o cancelamento normal
// (o texto mudou enquanto o gopls respondia) virava erro solto na página. Comandos que não são "ações"
// (editor.action.codeAction) só existem pelo trigger; o cancelamento deles fica com o filtro do main.tsx.
import type { monaco } from './monaco'

export const isCanceled = (e: unknown) => e instanceof Error && (e.name === 'Canceled' || e.message === 'Canceled')

export function runAction(ed: monaco.editor.ICodeEditor | null | undefined, id: string, args?: unknown) {
  if (!ed) return
  const a = ed.getAction(id)
  if (!a) return ed.trigger('goide', id, args ?? {})
  a.run(args).catch((e) => {
    if (!isCanceled(e)) console.error(e)
  })
}
