// S25 Conflitos (lista de arquivos: o meu, o deles ou mesclar) e S26 merge em 3 painéis:
// à esquerda a sua versão, à direita a que chegou, no meio o resultado (editável). O que não conflita já vem
// mesclado; cada conflito começa com o texto da base e se resolve pelos botões ou editando o meio à mão.
import { useEffect, useRef, useState } from 'react'
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, Combine, FileWarning } from 'lucide-react'
import { monaco } from '../editor/monaco'
import { lineDiff } from '../editor/lineDiff'
import { api, type MergeInput } from '../lib/api'
import { useApp } from '../state/app'
import { useGitUi } from '../state/git'
import { usePrefs, codeLineHeight } from '../state/settings'
import { Button, IconButton } from '../design/controls'
import { Dialog, EmptyState, Spinner, toast } from '../design/feedback'
import { cn } from '../design/cn'
import tokens from '../../design/tokens.json'
import { t } from '../i18n'

const opLabel: Record<string, string> = { merge: 'merge', rebase: 'rebase', 'cherry-pick': 'cherry-pick', revert: 'revert' }

// ---------------------------------------------------------------- S25

export function ConflictsDialog() {
  const open = useGitUi((s) => s.conflictsOpen)
  const git = useApp((s) => s.git)
  const { setConflictsOpen, resolve, openMerge, finish, abort } = useGitUi()
  const files = (git?.files ?? []).filter((f) => f.kind === 'conflict')
  const [busy, setBusy] = useState<string | null>(null)
  const op = git?.operation ?? ''

  const pick = async (path: string, side: 'ours' | 'theirs') => {
    setBusy(path)
    await resolve(path, side)
    setBusy(null)
  }

  return (
    <Dialog
      title={files.length ? t('Conflitos ({n})', { n: files.length }) : t('Conflitos resolvidos')}
      isOpen={open}
      onOpenChange={setConflictsOpen}
      size="md"
      footer={
        <>
          {op && (
            <Button
              variant="secondary"
              onPress={() => {
                setConflictsOpen(false)
                void abort()
              }}
            >
              {t('Abortar {op}', { op: opLabel[op] ?? op })}
            </Button>
          )}
          <Button onPress={() => setConflictsOpen(false)}>{t('Fechar')}</Button>
          {op && (
            <Button variant="primary" isDisabled={files.length > 0} onPress={() => void finish()}>
              {t('Concluir {op}', { op: opLabel[op] ?? op })}
            </Button>
          )}
        </>
      }
    >
      {files.length === 0 ? (
        <p>{op ? t('Todos os arquivos foram resolvidos. Conclua o {op} para criar o commit.', { op: opLabel[op] ?? op }) : t('Nenhum arquivo em conflito.')}</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-text-muted">{t('Para cada arquivo: fique com a sua versão, com a que chegou, ou mescle as duas linha a linha.')}</p>
          <ul aria-label={t('Arquivos em conflito')} className="flex flex-col">
            {files.map((f) => (
              <li key={f.path} className="flex items-center gap-2 border-t border-border py-1.5 first:border-t-0">
                <FileWarning className="size-icon-sm shrink-0 text-danger" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-text">{f.path.split('/').pop()}</span> <span className="text-xs text-text-muted">{f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''}</span>
                </span>
                {busy === f.path ? (
                  <Spinner label={t('Resolvendo')} />
                ) : (
                  <>
                    <Button size="sm" onPress={() => void pick(f.path, 'ours')} aria-label={t('Aceitar o meu: {path}', { path: f.path })}>
                      {t('Aceitar o meu')}
                    </Button>
                    <Button size="sm" onPress={() => void pick(f.path, 'theirs')} aria-label={t('Aceitar o deles: {path}', { path: f.path })}>
                      {t('Aceitar o deles')}
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Combine className="size-icon-sm" />}
                      aria-label={t('Mesclar: {path}', { path: f.path })}
                      onPress={() => {
                        setConflictsOpen(false)
                        openMerge(f.path)
                      }}
                    >
                      {t('Mesclar…')}
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  )
}

// ---------------------------------------------------------------- S26

interface Conflict {
  id: string // decoração no modelo do meio (acompanha as edições)
  ours: string
  base: string
  theirs: string
  resolved: boolean
}

const languageOf = (path: string) => monaco.languages.getLanguages().find((l) => l.extensions?.some((x) => path.endsWith(x)))?.id ?? 'plaintext'

export function MergeView() {
  const path = useGitUi((s) => s.merging)
  const close = () => useGitUi.getState().openMerge(null)
  return (
    <ModalOverlay isOpen={!!path} onOpenChange={(o) => !o && close()} isDismissable={false} className="fixed inset-0 z-dialog flex items-center justify-center bg-overlay p-4">
      <Modal className="h-full w-full outline-none">
        <AriaDialog aria-labelledby="merge-title" className="flex h-full w-full flex-col overflow-hidden rounded-lg bg-surface shadow-dialog outline-none">
          {path && <MergeBody path={path} close={close} />}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  )
}

function MergeBody({ path, close }: { path: string; close: () => void }) {
  const project = useApp((s) => s.project)!
  const [input, setInput] = useState<MergeInput | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.Git.ConflictVersions(project.id, path).then(setInput, (e) => setError((e as Error).message))
  }, [project.id, path])

  const title = (
    <Heading id="merge-title" slot="title" className="text-md text-text">
      {t('Mesclar {path}', { path })}
    </Heading>
  )
  if (error)
    return (
      <div className="flex h-full flex-col p-4">
        {title}
        <EmptyState title={t('Não foi possível abrir o conflito')} actions={<Button onPress={close}>{t('Fechar')}</Button>}>
          {error}
        </EmptyState>
      </div>
    )
  if (!input)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label={t('Carregando as versões')} />
      </div>
    )
  if (input.binary || input.kind === 'deleted-by-us' || input.kind === 'deleted-by-them') return <SideOnly input={input} title={title} close={close} />
  return <ThreeWay input={input} title={title} close={close} />
}

/** Sem mesclagem linha a linha (binário ou apagado de um lado): escolher um lado. */
function SideOnly({ input, title, close }: { input: MergeInput; title: React.ReactNode; close: () => void }) {
  const resolve = useGitUi((s) => s.resolve)
  const why = input.binary
    ? t('Arquivo binário: não dá para mesclar linha a linha.')
    : input.kind === 'deleted-by-them'
      ? t('{a} apagou o arquivo; {b} o alterou.', { a: input.theirsLabel, b: input.oursLabel.toLowerCase() })
      : t('{a} apagou o arquivo; {b} o alterou.', { a: input.oursLabel, b: input.theirsLabel.toLowerCase() })
  const done = async (side: 'ours' | 'theirs') => (await resolve(input.path, side)) && close()
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {title}
      <p className="text-sm text-text">{why}</p>
      <div className="flex gap-2">
        <Button onPress={() => void done('ours')}>{input.kind === 'deleted-by-us' ? t('Apagar (como na sua versão)') : t('Aceitar o meu')}</Button>
        <Button onPress={() => void done('theirs')}>{input.kind === 'deleted-by-them' ? t('Apagar (como na versão que chegou)') : t('Aceitar o deles')}</Button>
        <span className="flex-1" />
        <Button onPress={close}>{t('Cancelar')}</Button>
      </div>
    </div>
  )
}

function ThreeWay({ input, title, close }: { input: MergeInput; title: React.ReactNode; close: () => void }) {
  const resolve = useGitUi((s) => s.resolve)
  const fontSize = usePrefs((s) => s['editor.fontSize'])
  const hosts = { ours: useRef<HTMLDivElement>(null), result: useRef<HTMLDivElement>(null), theirs: useRef<HTMLDivElement>(null) }
  const eds = useRef<{ ours?: monaco.editor.IStandaloneCodeEditor; result?: monaco.editor.IStandaloneCodeEditor; theirs?: monaco.editor.IStandaloneCodeEditor }>({})
  const [conflicts, setConflicts] = useState<Conflict[]>([])
  const [current, setCurrent] = useState(0)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  // Cria os três editores e o resultado inicial (texto mesclado + base no lugar de cada conflito).
  useEffect(() => {
    const lang = languageOf(input.path)
    const opts = (readOnly: boolean, aria: string): monaco.editor.IStandaloneEditorConstructionOptions => ({
      readOnly,
      automaticLayout: true,
      fontFamily: tokens.font.mono,
      fontSize,
      lineHeight: codeLineHeight(fontSize),
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      stickyScroll: { enabled: false },
      glyphMargin: false,
      folding: false,
      lineNumbersMinChars: 3,
      ariaLabel: aria,
    })
    const uri = (side: string) => monaco.Uri.from({ scheme: 'inmemory', path: `/merge/${side}/${input.path}` })
    const oursModel = monaco.editor.createModel(input.ours, lang, uri('ours'))
    const theirsModel = monaco.editor.createModel(input.theirs, lang, uri('theirs'))
    let text = ''
    const marks: Array<{ start: number; end: number; c: Omit<Conflict, 'id' | 'resolved'> }> = []
    for (const ch of input.chunks) {
      if (!ch.conflict) {
        text += ch.text
        continue
      }
      const start = text.length
      text += ch.base
      marks.push({ start, end: text.length, c: { ours: ch.ours, base: ch.base, theirs: ch.theirs } })
    }
    const resultModel = monaco.editor.createModel(text, lang, uri('result'))
    const ids = resultModel.deltaDecorations(
      [],
      marks.map((m) => ({ range: rangeOf(resultModel, m.start, visualEnd(m.c.base, m.start, m.end)), options: conflictDeco(false) })),
    )
    setConflicts(marks.map((m, i) => ({ id: ids[i], ...m.c, resolved: false })))

    const o = monaco.editor.create(hosts.ours.current!, { ...opts(true, input.oursLabel), model: oursModel })
    const r = monaco.editor.create(hosts.result.current!, { ...opts(false, t('Resultado da mesclagem')), model: resultModel })
    const th = monaco.editor.create(hosts.theirs.current!, { ...opts(true, input.theirsLabel), model: theirsModel })
    eds.current = { ours: o, result: r, theirs: th }
    // O que cada lado mudou em relação à base, marcado no próprio painel.
    const baseLines = input.base.split('\n')
    for (const [ed, model] of [
      [o, oursModel],
      [th, theirsModel],
    ] as const) {
      const hunks = lineDiff(baseLines, model.getLinesContent()) ?? []
      ed.createDecorationsCollection(
        hunks
          .filter((h) => h.kind !== 'deleted')
          .map((h) => ({ range: new monaco.Range(h.start, 1, h.start + h.count - 1, 1), options: { isWholeLine: true, className: 'prumo-merge-changed' } })),
      )
    }
    return () => {
      o.dispose()
      r.dispose()
      th.dispose()
      oursModel.dispose()
      theirsModel.dispose()
      resultModel.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input])

  const result = () => eds.current.result?.getModel()

  // Leva o conflito atual para a vista nos três painéis.
  const reveal = (i: number) => {
    const c = conflicts[i]
    const r = eds.current.result
    const m = result()
    if (!c || !r || !m) return
    const range = m.getDecorationRange(c.id)
    if (range) {
      r.revealRangeInCenter(range)
      r.setPosition(range.getStartPosition())
    }
    for (const [ed, txt] of [
      [eds.current.ours, c.ours],
      [eds.current.theirs, c.theirs],
    ] as const) {
      const first = txt.split('\n').find((l) => l.trim())
      const hit = first && ed?.getModel()?.findMatches(first, false, false, true, null, false, 1)[0]
      if (hit && ed) ed.revealRangeInCenter(hit.range)
    }
  }
  useEffect(() => {
    if (conflicts.length) reveal(current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, conflicts.length])

  const unresolved = conflicts.filter((c) => !c.resolved).length

  const accept = (choice: 'ours' | 'theirs' | 'both') => {
    const m = result()
    const c = conflicts[current]
    if (!m || !c) return
    const range = m.getDecorationRange(c.id)
    if (!range) return
    const text = choice === 'ours' ? c.ours : choice === 'theirs' ? c.theirs : c.ours + c.theirs
    const startOff = m.getOffsetAt(range.getStartPosition())
    // A decoração não inclui a quebra da última linha (senão o destaque vaza para a linha de baixo): a troca inclui.
    let endOff = m.getOffsetAt(range.getEndPosition())
    if (c.base.endsWith('\n')) endOff += 1
    m.pushEditOperations([], [{ range: rangeOf(m, startOff, endOff), text }], () => null)
    const [id] = m.deltaDecorations([c.id], [{ range: rangeOf(m, startOff, visualEnd(text, startOff, startOff + text.length)), options: conflictDeco(true) }])
    const next = conflicts.map((x, i) => (i === current ? { ...x, id, resolved: true } : x))
    setConflicts(next)
    const after = next.findIndex((x, i) => i > current && !x.resolved)
    const before = next.findIndex((x) => !x.resolved)
    if (after >= 0) setCurrent(after)
    else if (before >= 0) setCurrent(before)
  }

  const apply = async () => {
    const m = result()
    if (!m) return
    setBusy(true)
    const ok = await resolve(input.path, 'content', m.getValue())
    setBusy(false)
    if (ok) {
      toast('success', t('{path} resolvido', { path: input.path }))
      close()
      // Volta para a lista: pode haver outros arquivos, e de lá se conclui o merge.
      useGitUi.getState().setConflictsOpen(true)
    }
  }

  const c = conflicts[current]
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        {title}
        <span role="status" className="text-xs text-text-muted">
          {conflicts.length === 0
            ? t('Sem conflitos: tudo mesclou sozinho.')
            : unresolved
              ? t('{n} de {total} conflito(s) por resolver', { n: unresolved, total: conflicts.length })
              : t('Todos os conflitos resolvidos')}
        </span>
        <span className="flex-1" />
        {conflicts.length > 0 && (
          <div role="toolbar" aria-label={t('Conflito atual')} className="flex items-center gap-1">
            <IconButton label={t('Conflito anterior')} size="sm" icon={<ChevronUp className="size-icon-sm" />} isDisabled={current === 0} onPress={() => setCurrent((i) => i - 1)} />
            <span className="text-xs tabular-nums text-text-muted">
              {current + 1}/{conflicts.length}
            </span>
            <IconButton label={t('Próximo conflito')} size="sm" icon={<ChevronDown className="size-icon-sm" />} isDisabled={current >= conflicts.length - 1} onPress={() => setCurrent((i) => i + 1)} />
            <Button size="sm" icon={<ArrowRight className="size-icon-sm" />} isDisabled={!c || c.resolved} onPress={() => accept('ours')}>
              {t('Aceitar o meu')}
            </Button>
            <Button size="sm" isDisabled={!c || c.resolved} onPress={() => accept('both')}>
              {t('Aceitar os dois')}
            </Button>
            <Button size="sm" icon={<ArrowLeft className="size-icon-sm" />} isDisabled={!c || c.resolved} onPress={() => accept('theirs')}>
              {t('Aceitar o deles')}
            </Button>
          </div>
        )}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-3 divide-x divide-border">
        {(
          [
            ['ours', input.oursLabel, t('somente leitura')],
            ['result', t('Resultado'), t('editável')],
            ['theirs', input.theirsLabel, t('somente leitura')],
          ] as const
        ).map(([k, label, hint]) => (
          <section key={k} aria-label={label} className="flex min-h-0 min-w-0 flex-col">
            <div className={cn('truncate px-3 py-1 text-xs', k === 'result' ? 'font-semibold text-text' : 'text-text-muted')}>
              {label} <span className="font-normal text-text-muted">· {hint}</span>
            </div>
            <div ref={hosts[k]} className="min-h-0 flex-1" data-merge-pane={k} />
          </section>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-border px-4 py-2">
        <span className="text-xs text-text-muted">{t('Os botões resolvem o conflito marcado; dá para editar o resultado à mão.')}</span>
        <span className="flex-1" />
        <Button onPress={close}>{t('Cancelar')}</Button>
        <Button variant="primary" loading={busy} onPress={() => (unresolved ? setConfirm(true) : void apply())}>
          {t('Aplicar')}
        </Button>
      </div>
      <Dialog
        title={t('Ainda há conflitos sem resolver')}
        isOpen={confirm}
        onOpenChange={setConfirm}
        footer={
          <>
            <Button onPress={() => setConfirm(false)}>{t('Voltar')}</Button>
            <Button
              variant="primary"
              onPress={() => {
                setConfirm(false)
                void apply()
              }}
            >
              {t('Aplicar mesmo assim')}
            </Button>
          </>
        }
      >
        {t('{n} conflito(s) ficam com o texto da base (o que existia antes das duas mudanças). O arquivo será marcado como resolvido.', { n: unresolved })}
      </Dialog>
    </div>
  )
}

/** Fim visual de um trecho de linhas inteiras: antes da última quebra de linha. */
const visualEnd = (text: string, start: number, end: number) => (text.endsWith('\n') && end > start ? end - 1 : end)

function rangeOf(m: monaco.editor.ITextModel, start: number, end: number) {
  const a = m.getPositionAt(start)
  const b = m.getPositionAt(end)
  return new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column)
}

function conflictDeco(resolved: boolean): monaco.editor.IModelDecorationOptions {
  return {
    className: resolved ? 'prumo-merge-resolved' : 'prumo-merge-conflict',
    isWholeLine: true,
    // Conflito vazio (as duas versões adicionaram, base vazia) ainda precisa aparecer e crescer ao digitar nele.
    showIfCollapsed: true,
    stickiness: monaco.editor.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges,
    overviewRuler: { color: resolved ? 'var(--color-success)' : 'var(--color-danger)', position: monaco.editor.OverviewRulerLane.Full },
  }
}
