// "Pedir código à IA" no editor (Ctrl+\): uma caixa de texto sobre a linha ou a seleção; o agente de IA da máquina
// (o mesmo da mensagem de commit) gera ou altera o trecho, que entra no editor marcado para aceitar ou desfazer.
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Check, Sparkles, Undo2, X } from 'lucide-react'
import { monaco } from './monaco'
import { api } from '../lib/api'
import { useApp } from '../state/app'
import { useDocs } from './docs'
import { savePrefs, usePrefs } from '../state/settings'
import { useAgents, useResolvedAgent } from '../git/CommitAgent'
import { Button, Checkbox, IconButton } from '../design/controls'
import { Spinner, toast } from '../design/feedback'
import { t } from '../i18n'

type Ed = monaco.editor.ICodeEditor

/** O trecho que o pedido vai substituir, e o arquivo em volta dele. */
interface Target {
  range: monaco.Range
  text: string
  before: string
  after: string
}

function targetOf(ed: Ed, model: monaco.editor.ITextModel): Target {
  let sel = ed.getSelection() ?? new monaco.Selection(1, 1, 1, 1)
  let range: monaco.Range
  if (!sel.isEmpty()) {
    range = sel
    // Selecionou linhas inteiras (o fim caiu no começo da linha seguinte): não leva a linha seguinte.
    if (range.endColumn === 1 && range.endLineNumber > range.startLineNumber) {
      const end = range.endLineNumber - 1
      range = new monaco.Range(range.startLineNumber, range.startColumn, end, model.getLineMaxColumn(end))
    }
  } else {
    // Só o cursor: a linha dele inteira (a IA pode devolvê-la junto com o que acrescentar).
    const line = sel.startLineNumber
    range = new monaco.Range(line, 1, line, model.getLineMaxColumn(line))
  }
  const last = model.getLineCount()
  const text = model.getValueInRange(range)
  return {
    range,
    text: text.trim() === '' ? '' : text,
    before: model.getValueInRange(new monaco.Range(1, 1, range.startLineNumber, range.startColumn)),
    after: model.getValueInRange(new monaco.Range(range.endLineNumber, range.endColumn, last, model.getLineMaxColumn(last))),
  }
}

type Phase = 'input' | 'consent' | 'busy' | 'review'

function Box({ ed, model, docKey, target, close, setResult }: {
  ed: Ed
  model: monaco.editor.ITextModel
  docKey: string
  target: Target
  close: () => void
  setResult: (range: monaco.Range | null) => void
}) {
  const agent = useResolvedAgent()
  const consent = usePrefs((s) => s['agent.editConsent'])
  const project = useApp((s) => s.project)
  const answerTrust = useApp((s) => s.answerTrust)
  const [phase, setPhase] = useState<Phase>('input')
  const [text, setText] = useState('')
  const [dontAsk, setDontAsk] = useState(true)
  const [error, setError] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  useEffect(() => void useAgents.getState().load(), [])
  useEffect(() => area.current?.focus(), [phase])

  const blocked = !project?.trusted
    ? t('Confie no projeto para usar a IA no editor.')
    : agent.off
      ? t('A IA está desligada (Configurações → Ferramentas).')
      : !agent.usable
        ? t('Nenhum agente de IA encontrado (Configurações → Ferramentas)')
        : ''

  // Sem campo de texto (IA desligada, projeto restrito): o foco fica na caixa, para o Esc fechar.
  useEffect(() => {
    if (blocked) frame.current?.focus()
  }, [blocked])

  const run = async () => {
    if (!project) return
    setPhase('busy')
    setError('')
    try {
      const res = await api.Tools.AgentEdit(project.id, {
        path: docKey,
        language: model.getLanguageId(),
        before: target.before,
        target: target.text,
        after: target.after,
        instruction: text,
      })
      // Uma edição só (um Ctrl+Z desfaz tudo), com o trecho novo marcado.
      const start = target.range.getStartPosition()
      const startOffset = model.getOffsetAt(start)
      ed.pushUndoStop()
      ed.executeEdits('prumo.ai', [{ range: target.range, text: res.code, forceMoveMarkers: true }])
      ed.pushUndoStop()
      const end = model.getPositionAt(startOffset + res.code.replace(/\n/g, model.getEOL()).length)
      setResult(monaco.Range.fromPositions(start, end))
      setPhase('review')
    } catch (e) {
      const msg = (e as Error).message
      if (/cancelada|canceled/i.test(msg)) return setPhase('input')
      setError(msg)
      setPhase('input')
    }
  }
  const submit = () => {
    if (!text.trim() || blocked) return
    if (!consent) return setPhase('consent')
    void run()
  }
  const accept = () => {
    close()
    ed.focus()
  }
  const undo = () => {
    ed.trigger('prumo.ai', 'undo', null)
    close()
    ed.focus()
  }
  const cancel = () => {
    if (phase === 'busy' && project) void api.Tools.CancelAgentEdit(project.id)
    else {
      close()
      ed.focus()
    }
  }

  const where = target.text ? t('Alterar o trecho com {agent}', { agent: agent.name || t('a IA') }) : t('Gerar código aqui com {agent}', { agent: agent.name || t('a IA') })
  return (
    <div
      ref={frame}
      tabIndex={-1}
      role="dialog"
      aria-label={t('Pedir código à IA')}
      data-testid="ai-edit"
      className="flex w-[34rem] max-w-[80vw] flex-col outline-none gap-2 rounded-lg border border-border-strong bg-surface p-2 text-sm text-text shadow-dialog"
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') {
          e.preventDefault()
          phase === 'review' ? undo() : cancel()
        }
        if (phase === 'review' && e.key === 'Enter') {
          e.preventDefault()
          accept()
        }
      }}
    >
      <div className="flex items-center gap-1.5 text-xs text-text-muted">
        <Sparkles className="size-icon-sm text-accent-text" aria-hidden />
        <span className="flex-1 truncate">{where}</span>
        {phase !== 'review' && <IconButton label={t('Fechar')} size="sm" icon={<X className="size-icon-sm" />} onPress={cancel} />}
      </div>
      {blocked ? (
        <div className="flex items-center gap-2 text-text-muted">
          <span className="flex-1">{blocked}</span>
          {!project?.trusted && <Button size="sm" onPress={() => void answerTrust(true)}>{t('Confiar no projeto')}</Button>}
        </div>
      ) : phase === 'review' ? (
        <div className="flex items-center gap-2">
          <span className="flex-1 text-text-muted">{t('Revise o trecho marcado no editor.')}</span>
          <Button size="sm" icon={<Undo2 className="size-icon-sm" />} onPress={undo}>{t('Desfazer')}</Button>
          <Button size="sm" variant="primary" icon={<Check className="size-icon-sm" />} onPress={accept} autoFocus>{t('Aceitar')}</Button>
        </div>
      ) : phase === 'consent' ? (
        <div className="flex flex-col gap-2">
          <p>
            {agent.vendor
              ? t('O código deste arquivo vai para a {vendor}, pelo {agent} instalado na sua máquina, com a sua conta.', { vendor: agent.vendor, agent: agent.name })
              : t('O código deste arquivo vai para o comando {agent}, com a sua conta.', { agent: agent.name })}
          </p>
          <p className="text-text-muted">{t('Só acontece quando você pede. O agente roda sem ferramentas, fora do projeto: ele só escreve o código, e você revisa antes de aceitar.')}</p>
          <Checkbox isSelected={dontAsk} onChange={setDontAsk}>{t('Não perguntar de novo')}</Checkbox>
          <div className="flex justify-end gap-2">
            <Button size="sm" onPress={() => setPhase('input')}>{t('Cancelar')}</Button>
            <Button
              size="sm"
              variant="primary"
              onPress={() => {
                if (dontAsk) void savePrefs({ 'agent.editConsent': true })
                void run()
              }}
            >
              {t('Enviar')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <textarea
            ref={area}
            rows={Math.min(6, Math.max(2, text.split('\n').length))}
            value={text}
            disabled={phase === 'busy'}
            aria-label={t('O que a IA deve fazer')}
            placeholder={t('Descreva o que gerar ou alterar… (Enter envia, Shift+Enter quebra a linha)')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
            className="w-full resize-none rounded-md border border-border-input bg-bg px-2 py-1 text-text outline-none focus-visible:ring-1 focus-visible:ring-focus disabled:opacity-60"
          />
          <div className="flex items-center gap-2">
            {phase === 'busy' ? (
              <span className="flex flex-1 items-center gap-2 text-text-muted" role="status">
                <Spinner label={t('{agent} está escrevendo o código', { agent: agent.name })} />
                {t('{agent} está escrevendo o código', { agent: agent.name })}
              </span>
            ) : (
              <span className={error ? 'flex-1 text-danger' : 'flex-1 text-text-muted'} role={error ? 'alert' : undefined}>
                {error || t('Esc fecha')}
              </span>
            )}
            {phase === 'busy' ? (
              <Button size="sm" onPress={cancel}>{t('Cancelar a geração')}</Button>
            ) : (
              <Button size="sm" variant="primary" isDisabled={!text.trim()} onPress={submit}>{t('Gerar')}</Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

let open: { ed: Ed; focus: () => void } | null = null

/** Abre a caixa sobre a seleção (ou a linha do cursor) do editor. */
export function openAiEdit(ed: Ed) {
  const model = ed.getModel()
  if (!model) return
  if (open) return open.focus()
  if (ed.getOption(monaco.editor.EditorOption.readOnly)) return toast('info', t('Este arquivo é somente leitura.'))
  const docKey = Object.values(useDocs.getState().docs).find((d) => d.uri === model.uri.toString())?.key ?? model.uri.path
  const target = targetOf(ed, model)
  const node = document.createElement('div')
  node.style.zIndex = '50'
  const root = createRoot(node)
  const marks = ed.createDecorationsCollection([])
  let line = target.range.startLineNumber
  const widget: monaco.editor.IContentWidget = {
    allowEditorOverflow: true,
    getId: () => 'prumo.aiEdit',
    getDomNode: () => node,
    getPosition: () => ({
      position: { lineNumber: line, column: 1 },
      preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE, monaco.editor.ContentWidgetPositionPreference.BELOW],
    }),
  }
  const subs: monaco.IDisposable[] = []
  const close = () => {
    if (open?.ed !== ed) return
    open = null
    subs.forEach((s) => s.dispose())
    marks.clear()
    ed.removeContentWidget(widget)
    setTimeout(() => root.unmount())
  }
  subs.push(ed.onDidChangeModel(close))
  root.render(
    <Box
      ed={ed}
      model={model}
      docKey={docKey}
      target={target}
      close={close}
      setResult={(r) => {
        if (!r) return
        marks.set([{ range: r, options: { isWholeLine: true, className: 'prumo-ai-added' } }])
        line = r.startLineNumber
        ed.layoutContentWidget(widget)
        ed.revealRangeInCenterIfOutsideViewport(r)
      }}
    />,
  )
  ed.addContentWidget(widget)
  open = { ed, focus: () => node.querySelector('textarea')?.focus() }
  setTimeout(() => node.querySelector('textarea')?.focus(), 0)
}
