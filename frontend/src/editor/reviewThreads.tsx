// Conversas de revisão de um pull request do GitHub dentro do diff, como no VS Code: cada conversa (e cada
// comentário pendente) aparece logo abaixo da linha, num espaço aberto entre as linhas do editor (view zone);
// o "+" na margem, ou "Comentar nesta linha" no menu de contexto, abre o campo para um comentário novo, que
// vai na hora ou fica na revisão pendente.
import { useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { monaco } from './monaco'
import { api, type DraftComment, type ReviewComment } from '../lib/api'
import { Button, TextArea } from '../design/controls'
import { toast } from '../design/feedback'
import { useApp } from '../state/app'
import { usePullRequests } from '../git/pullRequests'
import { GhMarkdown, when } from '../git/prUi'
import { groupThreads } from './PullRequestView'
import { t } from '../i18n'

type Side = 'RIGHT' | 'LEFT'
interface Anchor {
  side: Side
  line: number
}
const anchorKey = (a: Anchor) => `${a.side}:${a.line}`

/** Liga as conversas do pull request n ao diff do arquivo path. ready muda quando os modelos são trocados. */
export function useReviewThreads(ed: monaco.editor.IStandaloneDiffEditor | null, n: number | null, path: string, split: boolean, ready: number) {
  const detail = usePullRequests((s) => (n == null ? undefined : s.details[n]?.data))
  const drafts = usePullRequests((s) => (n == null ? undefined : s.drafts[n]))
  const [composer, setComposer] = useState<Anchor | null>(null)
  const composerRef = useRef(composer)
  composerRef.current = composer

  // "+" na margem ao passar o mouse e "Comentar nesta linha" no menu de contexto.
  useEffect(() => {
    if (!ed || n == null) return
    const subs: monaco.IDisposable[] = []
    const sides: [monaco.editor.IStandaloneCodeEditor, Side][] = [
      [ed.getModifiedEditor(), 'RIGHT'],
      [ed.getOriginalEditor(), 'LEFT'],
    ]
    for (const [e, side] of sides) {
      e.updateOptions({ glyphMargin: true })
      const hover = e.createDecorationsCollection()
      subs.push(
        e.onMouseMove((ev) => {
          const line = ev.target.position?.lineNumber
          const inGutter = ev.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || ev.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS
          hover.set(line && inGutter ? [{ range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: 'prumo-pr-add-comment', glyphMarginHoverMessage: { value: t('Comentar nesta linha') } } }] : [])
        }),
        e.onMouseLeave(() => hover.clear()),
        e.onMouseDown((ev) => {
          if (ev.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return
          const line = ev.target.position?.lineNumber
          if (line) setComposer({ side, line })
        }),
        e.addAction({
          id: 'prumo.pr.comment',
          label: t('Comentar nesta linha'),
          contextMenuGroupId: 'navigation',
          contextMenuOrder: 0,
          run: (x) => {
            const line = x.getPosition()?.lineNumber
            if (line) setComposer({ side, line })
          },
        }),
        { dispose: () => hover.clear() },
      )
    }
    return () => subs.forEach((s) => s.dispose())
  }, [ed, n])

  // As conversas e os pendentes deste arquivo, agrupados pela linha.
  useEffect(() => {
    if (!ed || n == null) return
    const comments = (detail?.reviewComments ?? []).filter((c) => c.path === path && c.line > 0)
    const groups = new Map<string, { anchor: Anchor; threads: ReviewComment[][]; drafts: DraftComment[]; composer: boolean }>()
    const group = (a: Anchor) => {
      const k = anchorKey(a)
      if (!groups.has(k)) groups.set(k, { anchor: a, threads: [], drafts: [], composer: false })
      return groups.get(k)!
    }
    for (const th of groupThreads(comments)) group({ side: th[0].side, line: th[0].line }).threads.push(th)
    for (const d of drafts ?? []) if (d.path === path) group({ side: d.side, line: d.line }).drafts.push(d)
    if (composer) group(composer).composer = true

    const modified = ed.getModifiedEditor()
    const original = ed.getOriginalEditor()
    // No diff unificado o lado antigo não tem editor: a conversa vai para a linha correspondente do novo.
    const toModified = (line: number) => {
      let delta = 0
      for (const c of ed.getLineChanges() ?? []) {
        if (line < c.originalStartLineNumber) break
        if (c.originalEndLineNumber && line <= c.originalEndLineNumber) return Math.max(0, c.modifiedStartLineNumber - (c.modifiedEndLineNumber ? 1 : 0))
        delta = (c.modifiedEndLineNumber || c.modifiedStartLineNumber) - (c.originalEndLineNumber || c.originalStartLineNumber)
      }
      return line + delta
    }

    // Como o ZoneWidget do VS Code: a view zone só abre o espaço entre as linhas (o Monaco esconde as view
    // zones de leitores de tela), e o conteúdo fica num overlay widget posicionado em cima dela.
    const placed: { editor: monaco.editor.ICodeEditor; zoneId: string; widget: monaco.editor.IOverlayWidget; root: Root; observer: ResizeObserver; layout: monaco.IDisposable }[] = []
    let seq = 0
    for (const g of groups.values()) {
      const onLeft = g.anchor.side === 'LEFT'
      const editor = onLeft && split ? original : modified
      const after = onLeft && !split ? toModified(g.anchor.line) : g.anchor.line
      const node = document.createElement('div')
      node.className = 'prumo-pr-zone'
      const place = () => {
        const l = editor.getLayoutInfo()
        node.style.left = `${l.contentLeft}px`
        node.style.width = `${Math.max(0, l.width - l.contentLeft - l.verticalScrollbarWidth)}px`
      }
      place()
      const widgetId = `prumo.pr.thread.${n}.${++seq}.${anchorKey(g.anchor)}`
      const widget: monaco.editor.IOverlayWidget = { getId: () => widgetId, getDomNode: () => node, getPosition: () => null }
      editor.addOverlayWidget(widget)
      const zone: monaco.editor.IViewZone = {
        afterLineNumber: after,
        heightInPx: 40,
        domNode: document.createElement('div'),
        onDomNodeTop: (top) => {
          node.style.top = `${top}px`
        },
      }
      let zoneId = ''
      editor.changeViewZones((acc) => {
        zoneId = acc.addZone(zone)
      })
      const root = createRoot(node)
      root.render(
        <ZoneContent
          number={n}
          path={path}
          anchor={g.anchor}
          threads={g.threads}
          drafts={g.drafts}
          composing={g.composer}
          onCloseComposer={() => setComposer(null)}
        />,
      )
      // A altura do espaço acompanha o conteúdo (respostas abertas, texto digitado).
      const observer = new ResizeObserver(() => {
        const h = node.offsetHeight
        if (h && Math.abs(h - (zone.heightInPx ?? 0)) > 1) {
          zone.heightInPx = h
          editor.changeViewZones((acc) => acc.layoutZone(zoneId))
        }
      })
      observer.observe(node)
      placed.push({ editor, zoneId, widget, root, observer, layout: editor.onDidLayoutChange(place) })
    }
    return () => {
      for (const p of placed) {
        p.observer.disconnect()
        p.layout.dispose()
        p.editor.changeViewZones((acc) => acc.removeZone(p.zoneId))
        p.editor.removeOverlayWidget(p.widget)
        // Desmontar fora do ciclo do React (o efeito pode estar rodando dentro de uma renderização).
        queueMicrotask(() => p.root.unmount())
      }
    }
  }, [ed, n, path, split, ready, detail, drafts, composer])
}

function ZoneContent(props: {
  number: number
  path: string
  anchor: Anchor
  threads: ReviewComment[][]
  drafts: DraftComment[]
  composing: boolean
  onCloseComposer: () => void
}) {
  const { number, path, anchor, threads, drafts, composing, onCloseComposer } = props
  const removeDraft = usePullRequests((s) => s.removeDraft)
  return (
    // Cliques e teclas ficam aqui dentro: não vão para o editor por baixo.
    <div className="flex flex-col gap-2 border-y border-border bg-surface px-4 py-2 font-sans" onKeyDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      {threads.map((th) => (
        <Thread key={th[0].id} number={number} comments={th} />
      ))}
      {drafts.map((d) => (
        <div key={`${d.line}:${d.body}`} role="note" aria-label={t('Comentário pendente na linha {line}', { line: d.line })} className="rounded-md border border-warning bg-warning-bg px-2 py-1.5">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-warning">{t('Pendente')}</span>
            <span className="text-text-muted">{t('vai junto com a revisão')}</span>
            <Button size="sm" variant="ghost" className="ml-auto" onPress={() => removeDraft(number, d)}>
              {t('Descartar')}
            </Button>
          </div>
          <GhMarkdown text={d.body} />
        </div>
      ))}
      {composing && <Composer number={number} path={path} anchor={anchor} onClose={onCloseComposer} />}
    </div>
  )
}

function Thread({ number, comments }: { number: number; comments: ReviewComment[] }) {
  const project = useApp((s) => s.project)!
  const [replying, setReplying] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    setBusy(true)
    try {
      await api.GitHub.Reply(project.id, number, comments[0].id, text)
      setText('')
      setReplying(false)
      await usePullRequests.getState().loadDetail(number)
    } catch (e) {
      toast('danger', t('Não foi possível responder'), String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label={t('Conversa na linha {line}', { line: comments[0].line })} className="rounded-md border border-border bg-bg">
      <ul className="flex flex-col divide-y divide-border">
        {comments.map((c) => (
          <li key={c.id} className="px-3 py-1.5">
            <div className="flex items-baseline gap-1.5 text-xs">
              <span className="font-semibold text-text">{c.author.login}</span>
              <span className="ml-auto text-2xs text-text-muted">{when(c.createdAt)}</span>
            </div>
            <GhMarkdown text={c.body} />
          </li>
        ))}
      </ul>
      <div className="border-t border-border px-3 py-1.5">
        {replying ? (
          <div className="flex flex-col gap-1.5">
            <TextArea
              label={t('Responder')}
              hideLabel
              value={text}
              onChange={setText}
              rows={3}
              placeholder={t('Responder (Markdown). Ctrl+Enter envia.')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) void send()
                if (e.key === 'Escape') setReplying(false)
              }}
            />
            <div className="flex justify-end gap-1.5">
              <Button size="sm" onPress={() => setReplying(false)}>
                {t('Cancelar')}
              </Button>
              <Button size="sm" variant="primary" loading={busy} isDisabled={!text.trim()} onPress={() => void send()}>
                {t('Responder')}
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onPress={() => setReplying(true)}>
            {t('Responder')}
          </Button>
        )}
      </div>
    </section>
  )
}

function Composer({ number, path, anchor, onClose }: { number: number; path: string; anchor: Anchor; onClose: () => void }) {
  const project = useApp((s) => s.project)!
  const headSha = usePullRequests((s) => s.details[number]?.data?.headSha ?? '')
  const pending = usePullRequests((s) => s.drafts[number]?.length ?? 0)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const draft: DraftComment = { path, line: anchor.line, side: anchor.side, body: text }
  const single = async () => {
    setBusy(true)
    try {
      await api.GitHub.AddComment(project.id, number, headSha, draft)
      onClose()
      await usePullRequests.getState().loadDetail(number)
    } catch (e) {
      toast('danger', t('Não foi possível comentar'), String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }
  const addToReview = () => {
    usePullRequests.getState().addDraft(number, draft)
    onClose()
  }
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-focus bg-bg px-3 py-2">
      <TextArea
        label={t('Comentário na linha {line}', { line: anchor.line })}
        value={text}
        onChange={setText}
        rows={3}
        placeholder={t('Comentário (Markdown). Ctrl+Enter adiciona à revisão.')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) addToReview()
          if (e.key === 'Escape') onClose()
        }}
      />
      <div className="flex flex-wrap justify-end gap-1.5">
        <Button size="sm" onPress={onClose}>
          {t('Cancelar')}
        </Button>
        <Button size="sm" loading={busy} isDisabled={!text.trim() || !headSha} onPress={() => void single()}>
          {t('Comentar agora')}
        </Button>
        <Button size="sm" variant="primary" isDisabled={!text.trim()} onPress={addToReview}>
          {pending ? t('Adicionar à revisão') : t('Começar uma revisão')}
        </Button>
      </div>
    </div>
  )
}
