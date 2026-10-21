// S27 Anotar (git blame): autor, data e commit de cada linha, numa coluna à esquerda do código, colorida pela
// idade. Clicar na anotação abre o commit no Log (S24). É texto injetado pelo Monaco: não entra no arquivo.
import { monaco } from './monaco'
import { useDocs } from './docs'
import { api, type Blame } from '../lib/api'
import { toast } from '../design/feedback'
import { create } from 'zustand'
import { lang, t } from '../i18n'

interface Annotation {
  ids: string[] // decorações no modelo (sobrevivem à troca de aba: o editor é um só)
  blame: Blame
}

const byUri = new Map<string, Annotation>()

/** Arquivos anotados agora (a UI troca "Anotar" por "Fechar anotações"). */
export const useBlameState = create<{ uris: string[] }>(() => ({ uris: [] }))
const publish = () => useBlameState.setState({ uris: [...byUri.keys()] })

const dateFmt = new Intl.DateTimeFormat(lang, { day: '2-digit', month: '2-digit', year: '2-digit' })
const DAY = 86_400_000

/** 0 = esta semana … 4 = mais de um ano. */
function ageClass(ms: number): number {
  const days = (Date.now() - ms) / DAY
  if (days < 7) return 0
  if (days < 30) return 1
  if (days < 180) return 2
  if (days < 365) return 3
  return 4
}

const AUTHOR = 12
const WIDTH = 32

/** Texto da coluna (largura fixa: a fonte é monoespaçada e o código fica alinhado). */
function label(c: Blame['commits'][number]): string {
  // 32 colunas: múltiplo do tab (4), senão a indentação por tab do código encolhe depois da anotação.
  if (c.pending) return t('não commitado').padEnd(WIDTH)
  const author = c.author.length > AUTHOR ? c.author.slice(0, AUTHOR - 1) + '…' : c.author.padEnd(AUTHOR)
  return `${c.short} ${author} ${dateFmt.format(new Date(c.date))}`.padEnd(WIDTH)
}

export function isAnnotated(model: monaco.editor.ITextModel | null): boolean {
  return !!model && byUri.has(model.uri.toString())
}

export function clearBlame(model: monaco.editor.ITextModel) {
  const a = byUri.get(model.uri.toString())
  if (!a) return
  model.deltaDecorations(a.ids, [])
  byUri.delete(model.uri.toString())
  publish()
}

/** Liga ou desliga a anotação do arquivo aberto no editor. */
export async function toggleBlame(editor: monaco.editor.ICodeEditor) {
  const model = editor.getModel()
  if (!model) return
  if (isAnnotated(model)) return clearBlame(model)
  const docs = useDocs.getState()
  const key = Object.values(docs.docs).find((d) => d.uri === model.uri.toString())?.key
  if (!docs.projectId || !key || key.startsWith('ext:')) return
  // O blame é do arquivo no disco: grava antes o que estiver pendente.
  await docs.autosave()
  let blame: Blame
  try {
    blame = await api.Git.Blame(docs.projectId, key)
  } catch (e) {
    toast('warning', t('Não foi possível anotar'), (e as Error).message)
    return
  }
  if (model.isDisposed()) return
  const ids = model.deltaDecorations(
    [],
    blame.lines.slice(0, model.getLineCount()).map((ci, i) => {
      const c = blame.commits[ci]
      return {
        range: new monaco.Range(i + 1, 1, i + 1, 1),
        options: {
          description: 'goide-blame',
          showIfCollapsed: true, // intervalo vazio no começo da linha: sem isso o Monaco não desenha o texto
          before: {
            content: label(c),
            inlineClassName: `goide-blame goide-blame-age-${c.pending ? 'pending' : ageClass(c.date)}`,
            cursorStops: monaco.editor.InjectedTextCursorStops.None,
            attachedData: c.hash,
          },
          hoverMessage: c.pending ? undefined : { value: `**${c.summary.replace(/[\\`*_[\]]/g, '\\$&')}**\n\n${c.author} · ${dateFmt.format(new Date(c.date))} · \`${c.short}\`` },
        },
      }
    }),
  )
  byUri.set(model.uri.toString(), { ids, blame })
  publish()
}

/** O hash do commit se o clique foi numa anotação. */
export function blameHashAt(e: monaco.editor.IEditorMouseEvent): string | null {
  const t = e.target
  if (t.type !== monaco.editor.MouseTargetType.CONTENT_TEXT) return null
  const data = (t.detail as { injectedText?: { options?: { attachedData?: unknown } } } | undefined)?.injectedText?.options?.attachedData
  return typeof data === 'string' && !/^0+$/.test(data) ? data : null
}

/** Ao fechar o modelo, esquece a anotação. */
export function installBlame(): () => void {
  const sub = monaco.editor.onWillDisposeModel((m) => {
    if (byUri.delete(m.uri.toString())) publish()
  })
  return () => {
    sub.dispose()
    byUri.clear()
    publish()
  }
}
