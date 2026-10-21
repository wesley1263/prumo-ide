// S07 Buscar nos arquivos / Substituir nos arquivos (Ctrl+Shift+F, Ctrl+Shift+R).
// A busca roda no backend e chega aos poucos (evento search:update + Search.Results); a lista é virtual
// porque pode ter milhares de linhas; embaixo, o arquivo da ocorrência num editor somente leitura.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { CaseSensitive, Regex, Replace, ReplaceAll, WholeWord, X } from 'lucide-react'
import { monaco } from '../editor/monaco'
import { api, type SearchMatch, type SearchOptions } from '../lib/api'
import { on } from '../lib/events'
import { useDocs } from '../editor/docs'
import { useApp } from '../state/app'
import { afterDiskChange } from '../state/git'
import { Button, Checkbox, IconButton } from '../design/controls'
import { Dialog, Spinner, toast } from '../design/feedback'
import { cn } from '../design/cn'
import { keyLabel } from '../lib/keymap'
import { useSearchUi } from './state'
import tokens from '../../design/tokens.json'
import { lang, t, tn } from '../i18n'

const ROW = 24 // h-row
const DEBOUNCE = 250

// Opções lembradas entre aberturas.
let last: Omit<SearchOptions, 'query'> & { useMask: boolean; scope: 'project' | 'dir' } = {
  regex: false,
  caseSensitive: false,
  wholeWords: false,
  mask: '*.go',
  dir: '',
  useMask: false,
  scope: 'project',
}

type Status = { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; truncated: boolean } | { kind: 'error'; message: string }

export function FindInFiles() {
  const find = useSearchUi((s) => s.find)
  const close = useSearchUi((s) => s.closeFind)
  return (
    <ModalOverlay isOpen={!!find} onOpenChange={(o) => !o && close()} isDismissable className="fixed inset-0 z-dialog flex justify-center bg-overlay p-4 pt-[8vh]">
      <Modal className="h-fit max-h-full max-w-full outline-none">
        <AriaDialog
          aria-labelledby="find-title"
          className="flex h-[min(80vh,720px)] w-dialog-lg max-w-full flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-dialog outline-none"
        >
          {find && <Body replace={find.replace} seed={find.seed} />}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  )
}

function Toggle({ label, keys, pressed, onChange, icon }: { label: string; keys: string; pressed: boolean; onChange: (v: boolean) => void; icon: ReactNode }) {
  return <IconButton label={label} shortcut={keys} size="sm" toggled={pressed} icon={icon} onPress={() => onChange(!pressed)} />
}

const inputCls =
  'h-control min-w-0 flex-1 rounded-md border border-border-input bg-bg px-2 text-sm text-text placeholder:text-text-muted outline-none ' +
  'focus:border-focus focus:ring-2 focus:ring-focus'

function Body({ replace: replaceInit, seed }: { replace: boolean; seed: string }) {
  const project = useApp((s) => s.project)!
  const close = useSearchUi((s) => s.closeFind)
  const activeDoc = useDocs.getState().active
  const [replaceMode, setReplaceMode] = useState(replaceInit)
  const [query, setQuery] = useState(seed)
  const [replacement, setReplacement] = useState('')
  const [regex, setRegex] = useState(last.regex)
  const [caseSensitive, setCase] = useState(last.caseSensitive)
  const [wholeWords, setWhole] = useState(last.wholeWords)
  const [useMask, setUseMask] = useState(last.useMask)
  const [mask, setMask] = useState(last.mask)
  const [scope, setScope] = useState(last.scope)
  const [dir, setDir] = useState(last.dir || (activeDoc && !activeDoc.includes(':') ? activeDoc.split('/').slice(0, -1).join('/') : ''))
  const [matches, setMatches] = useState<SearchMatch[]>([])
  const [files, setFiles] = useState(0)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [active, setActive] = useState(0)
  const [confirmAll, setConfirmAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const queryRef = useRef<HTMLInputElement>(null)
  const current = useRef<string | null>(null)
  const [rerun, setRerun] = useState(0)

  useEffect(() => setReplaceMode(replaceInit), [replaceInit])
  useEffect(() => {
    last = { regex, caseSensitive, wholeWords, mask, dir, useMask, scope }
  }, [regex, caseSensitive, wholeWords, mask, dir, useMask, scope])

  const opts: SearchOptions = useMemo(
    () => ({ query, regex, caseSensitive, wholeWords, mask: useMask ? mask : '', dir: scope === 'dir' ? dir.trim().replace(/^\/+|\/+$/g, '') : '' }),
    [query, regex, caseSensitive, wholeWords, useMask, mask, scope, dir],
  )

  // Roda a busca (com debounce) quando a consulta ou as opções mudam.
  useEffect(() => {
    if (!query) {
      current.current = null
      setMatches([])
      setFiles(0)
      setStatus({ kind: 'idle' })
      return
    }
    let cancelled = false
    let next = 0
    let pulling = false
    let timer: ReturnType<typeof setInterval> | undefined
    let off: (() => void) | undefined
    const pull = async () => {
      const id = current.current
      if (!id || pulling) return
      pulling = true
      try {
        for (;;) {
          const r = await api.Search.Results(id, next)
          if (cancelled || current.current !== id) return
          next = r.next
          if (r.matches.length) setMatches((m) => [...m, ...r.matches])
          setFiles(r.files)
          if (r.error) {
            setStatus({ kind: 'error', message: r.error })
            stop()
            return
          }
          if (r.done) {
            setStatus({ kind: 'done', truncated: r.truncated })
            stop()
            return
          }
          if (!r.matches.length) return // espera o próximo aviso
        }
      } catch {
        // busca substituída por outra: nada a fazer
      } finally {
        pulling = false
      }
    }
    const stop = () => {
      clearInterval(timer)
      off?.()
    }
    const timeout = setTimeout(async () => {
      // O backend lê o disco: o que está no editor precisa estar salvo.
      await useDocs.getState().autosave()
      if (cancelled) return
      let id: string
      try {
        id = await api.Search.Text(project.id, opts)
      } catch (e) {
        if (!cancelled) {
          current.current = null
          setMatches([])
          setFiles(0)
          setStatus({ kind: 'error', message: (e as Error).message })
        }
        return
      }
      if (cancelled) return void api.Search.Cancel(id)
      current.current = id
      setMatches([])
      setFiles(0)
      setActive(0)
      setStatus({ kind: 'running' })
      off = on('search:update', (e) => e.id === id && void pull())
      timer = setInterval(pull, 300) // se um aviso se perder
      void pull()
    }, DEBOUNCE)
    return () => {
      cancelled = true
      clearTimeout(timeout)
      stop()
    }
  }, [opts, project.id, rerun]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => void (current.current && api.Search.Cancel(current.current)), [])

  const open = (m: SearchMatch | undefined) => {
    if (!m) return
    close()
    setTimeout(() => void useDocs.getState().open(m.path, { line: m.line, col: m.col, preview: false }), 0)
  }

  const doReplace = async (targets: SearchMatch[]) => {
    if (!targets.length) return
    setBusy(true)
    try {
      await useDocs.getState().autosave()
      const res = await api.Search.Replace(project.id, opts, replacement, targets.map((m) => ({ path: m.path, line: m.line, col: m.col })))
      await afterDiskChange()
      const files = res.paths.length
      toast(
        res.skipped ? 'warning' : 'success',
        t('{a} em {b}', { a: tn(res.replaced, '{n} ocorrência substituída', '{n} ocorrências substituídas'), b: tn(files, '{n} arquivo', '{n} arquivos') }),
        res.skipped ? t('{n} não estavam mais lá (o arquivo mudou depois da busca) e ficaram como estavam.', { n: res.skipped }) : undefined,
      )
      setRerun((n) => n + 1)
    } catch (e) {
      toast('danger', t('Não foi possível substituir'), (e as Error).message)
    } finally {
      setBusy(false)
      // O botão usado ficou desabilitado durante a troca e perdeu o foco: volta para o campo (Esc continua fechando).
      setTimeout(() => queryRef.current?.focus({ preventScroll: true }), 0)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const k = e.code
      if (k === 'KeyC') setCase((v) => !v)
      else if (k === 'KeyW') setWhole((v) => !v)
      else if (k === 'KeyX') setRegex((v) => !v)
      else return
      e.preventDefault()
      return
    }
    const inField = (e.target as HTMLElement).tagName === 'INPUT'
    if (!inField) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(matches.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'PageDown') {
      e.preventDefault()
      setActive((a) => Math.min(matches.length - 1, a + 10))
    } else if (e.key === 'PageUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 10))
    } else if (e.key === 'Enter' && (e.target as HTMLElement).dataset.field !== 'mask' && (e.target as HTMLElement).dataset.field !== 'dir') {
      e.preventDefault()
      open(matches[active])
    }
  }

  const count = matches.length
  const summary =
    status.kind === 'error'
      ? null
      : !query
        ? t('Digite o que buscar.')
        : status.kind === 'running' && !count
          ? t('Buscando…')
          : t('{a} em {b}', {
              a: tn(count, '{n} ocorrência', '{n} ocorrências', { n: count.toLocaleString(lang) + (status.kind === 'running' ? '+' : '') }),
              b: tn(files, '{n} arquivo', '{n} arquivos'),
            })

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2 px-3 pt-3">
        <Heading id="find-title" slot="title" className="text-md text-text">
          {replaceMode ? t('Substituir nos arquivos') : t('Buscar nos arquivos')}
        </Heading>
        <span role="status" className="flex items-center gap-2 text-xs text-text-muted">
          {status.kind === 'running' && <Spinner label={t('Buscando')} decorative />}
          {summary}
        </span>
        <span className="ml-auto" />
        <Checkbox isSelected={replaceMode} onChange={setReplaceMode}>
          {t('Substituir')}
        </Checkbox>
        <IconButton label={t('Fechar')} shortcut="Esc" size="sm" icon={<X className="size-icon-sm" />} onPress={close} />
      </div>

      <div className="flex flex-col gap-2 px-3 py-2">
        <div className="flex items-center gap-1">
          <input
            ref={queryRef}
            autoFocus
            aria-label={t('Texto a buscar')}
            aria-invalid={status.kind === 'error' || undefined}
            aria-describedby={status.kind === 'error' ? 'find-error' : undefined}
            aria-controls="find-results"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            placeholder={regex ? t('Expressão regular (Go/RE2)') : t('Texto')}
            spellCheck={false}
            className={cn(inputCls, 'font-mono', status.kind === 'error' && 'border-danger')}
          />
          <Toggle label={t('Diferenciar maiúsculas')} keys="Alt+C" pressed={caseSensitive} onChange={setCase} icon={<CaseSensitive className="size-icon-sm" />} />
          <Toggle label={t('Palavra inteira')} keys="Alt+W" pressed={wholeWords} onChange={setWhole} icon={<WholeWord className="size-icon-sm" />} />
          <Toggle label={t('Expressão regular')} keys="Alt+X" pressed={regex} onChange={setRegex} icon={<Regex className="size-icon-sm" />} />
        </div>
        {status.kind === 'error' && (
          <p id="find-error" className="text-xs text-danger">
            {status.message}
          </p>
        )}
        {replaceMode && (
          <div className="flex items-center gap-1">
            <input
              aria-label={t('Substituir por')}
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder={regex ? t('Substituir por ($1 usa o grupo 1)') : t('Substituir por')}
              spellCheck={false}
              className={cn(inputCls, 'font-mono')}
            />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <div role="radiogroup" aria-label={t('Escopo')} className="flex items-center rounded-md border border-border p-0.5">
            {(
              [
                ['project', t('Projeto')],
                ['dir', t('Pasta')],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={scope === id}
                onClick={() => setScope(id)}
                className={cn(
                  'rounded-sm px-2 py-0.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus',
                  scope === id ? 'bg-selection text-text' : 'text-text-muted hover:bg-hover',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {scope === 'dir' && (
            <input aria-label={t('Pasta')} data-field="dir" value={dir} onChange={(e) => setDir(e.target.value)} placeholder={t('pasta/relativa')} spellCheck={false} className={cn(inputCls, 'max-w-[16rem] font-mono')} />
          )}
          <div className="flex items-center gap-2">
            <Checkbox isSelected={useMask} onChange={setUseMask}>
              {t('Máscara')}
            </Checkbox>
            <input
              aria-label={t('Máscara de arquivo')}
              data-field="mask"
              value={mask}
              onChange={(e) => {
                setMask(e.target.value)
                setUseMask(true)
              }}
              placeholder="*.go, !*_test.go"
              spellCheck={false}
              className={cn(inputCls, 'w-[12rem] flex-none font-mono', !useMask && 'text-text-muted')}
            />
          </div>
        </div>
        {status.kind === 'done' && status.truncated && (
          <p className="text-xs text-warning">
            {t('Parou nas primeiras {n} ocorrências. Refine a busca (máscara, pasta ou texto mais específico).', { n: count.toLocaleString(lang) })}
          </p>
        )}
      </div>

      <Results matches={matches} active={active} setActive={setActive} onOpen={open} />
      <Preview key={rerun} match={matches[active]} projectId={project.id} />

      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <span className="text-xs text-text-muted">
          {t('{find} busca · {replace} substitui · Enter abre no editor', { find: keyLabel('Mod+Shift+F') ?? '', replace: keyLabel('Mod+Shift+R') ?? '' })}
        </span>
        <span className="ml-auto" />
        {replaceMode && (
          <>
            <Button icon={<Replace className="size-icon-sm" />} isDisabled={!matches[active] || busy || status.kind === 'running'} onPress={() => doReplace([matches[active]])}>
              {t('Substituir')}
            </Button>
            <Button icon={<ReplaceAll className="size-icon-sm" />} isDisabled={!count || busy || status.kind === 'running'} onPress={() => setConfirmAll(true)}>
              {t('Substituir tudo')}
            </Button>
          </>
        )}
        <Button variant="primary" isDisabled={!matches[active]} onPress={() => open(matches[active])}>
          {t('Abrir no editor')}
        </Button>
      </div>

      <Dialog
        title={t('Substituir tudo?')}
        isOpen={confirmAll}
        onOpenChange={setConfirmAll}
        footer={
          <>
            <Button onPress={() => setConfirmAll(false)}>{t('Cancelar')}</Button>
            <Button
              variant="primary"
              onPress={() => {
                setConfirmAll(false)
                void doReplace(matches)
              }}
            >
              {t('Substituir {n}', { n: count.toLocaleString(lang) })}
            </Button>
          </>
        }
      >
        {t('{a} em {b} vão virar "{r}". Dá para desfazer pelo git (Commit → Reverter) ou com Ctrl+Z em cada arquivo aberto.', {
          a: tn(count, '{n} ocorrência', '{n} ocorrências', { n: count.toLocaleString(lang) }),
          b: tn(files, '{n} arquivo', '{n} arquivos'),
          r: replacement,
        })}
      </Dialog>
    </div>
  )
}

/** Lista virtual: só as linhas visíveis existem no DOM. */
function Results({ matches, active, setActive, onOpen }: { matches: SearchMatch[]; active: number; setActive: (i: number) => void; onOpen: (m: SearchMatch) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState(0)
  const [height, setHeight] = useState(200)
  useLayoutEffect(() => {
    const el = box.current!
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Mantém a linha ativa visível.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const top = active * ROW
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight
  }, [active])
  const from = Math.max(0, Math.floor(scroll / ROW) - 5)
  const to = Math.min(matches.length, Math.ceil((scroll + height) / ROW) + 5)

  return (
    <div
      ref={box}
      id="find-results"
      role="listbox"
      aria-label={t('Ocorrências')}
      aria-activedescendant={matches[active] ? `find-row-${active}` : undefined}
      tabIndex={0}
      onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') setActive(Math.min(matches.length - 1, active + 1))
        else if (e.key === 'ArrowUp') setActive(Math.max(0, active - 1))
        else if (e.key === 'Enter' && matches[active]) onOpen(matches[active])
        else return
        e.preventDefault()
      }}
      className="relative min-h-[6rem] flex-1 overflow-y-auto border-y border-border outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
    >
      <div style={{ height: matches.length * ROW }} className="relative">
        {matches.slice(from, to).map((m, k) => {
          const i = from + k
          const file = m.path.split('/').pop()
          return (
            <div
              key={i}
              id={`find-row-${i}`}
              role="option"
              aria-selected={i === active}
              aria-label={t('{preview}, {file} linha {line}', { preview: m.preview.trim(), file: file ?? '', line: m.line })}
              onClick={() => setActive(i)}
              onDoubleClick={() => onOpen(m)}
              style={{ top: i * ROW, height: ROW }}
              className={cn('absolute inset-x-0 flex cursor-default items-center gap-3 px-3 font-mono text-sm', i === active ? 'bg-selection' : 'hover:bg-hover')}
            >
              <span className="min-w-0 flex-1 truncate whitespace-pre text-text">
                {m.preview.slice(0, m.start).trimStart()}
                <mark className="rounded-xs bg-search-match-bg text-text">{m.preview.slice(m.start, m.end)}</mark>
                {m.preview.slice(m.end)}
              </span>
              <span className="shrink-0 font-sans text-xs text-text-muted" title={m.path}>
                {file} {m.line}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** O arquivo da ocorrência num editor somente leitura, com a ocorrência marcada. */
function Preview({ match, projectId }: { match?: SearchMatch; projectId: string }) {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const models = useRef(new Map<string, monaco.editor.ITextModel>())
  const decos = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const [path, setPath] = useState<string | null>(null)

  useEffect(() => {
    const ed = monaco.editor.create(host.current!, {
      model: null,
      readOnly: true,
      domReadOnly: true,
      automaticLayout: true,
      fontFamily: tokens.font.mono,
      fontSize: tokens.type.code.size,
      lineHeight: tokens.type.code.line,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'none',
      lineNumbersMinChars: 4,
      folding: false,
      stickyScroll: { enabled: false },
      contextmenu: false,
      ariaLabel: t('Pré-visualização da ocorrência'),
    })
    editor.current = ed
    decos.current = ed.createDecorationsCollection()
    const ms = models.current
    return () => {
      ed.dispose()
      ms.forEach((m) => m.dispose())
      ms.clear()
    }
  }, [])

  useEffect(() => {
    const ed = editor.current
    if (!ed) return
    if (!match) {
      ed.setModel(null)
      setPath(null)
      return
    }
    let stale = false
    const show = (model: monaco.editor.ITextModel) => {
      if (stale) return
      if (ed.getModel() !== model) ed.setModel(model)
      const range = new monaco.Range(match.line, match.col, match.line, match.col + match.len)
      decos.current!.set([{ range, options: { inlineClassName: 'prumo-find-match', className: 'prumo-find-line', isWholeLine: false } }])
      ed.revealRangeInCenter(range, monaco.editor.ScrollType.Immediate)
      setPath(match.path)
    }
    const cached = models.current.get(match.path)
    if (cached) show(cached)
    else
      api.Files.Read(projectId, match.path)
        .then((fc) => {
          if (stale || fc.binary || fc.tooLarge) return
          const m = monaco.editor.createModel(fc.content, undefined, monaco.Uri.from({ scheme: 'inmemory', path: '/preview/' + match.path }))
          models.current.set(match.path, m)
          show(m)
        })
        .catch(() => {})
    return () => {
      stale = true
    }
  }, [match, projectId])

  return (
    <div className="flex h-[40%] min-h-[8rem] flex-col">
      <div className="truncate px-3 py-1 text-xs text-text-muted">{path ?? t('Nenhuma ocorrência selecionada')}</div>
      <div ref={host} className="min-h-0 flex-1" />
    </div>
  )
}
