// S28 Configurações (Ctrl+Alt+S): páginas com busca, rascunho com Aplicar/OK/Cancelar e validação no campo.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useDocs } from '../editor/docs'
import { lang, resolveLang, storedPref, storePref, t, type LangPref } from '../i18n'
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay, Radio, RadioGroup } from 'react-aria-components'
import { CheckCircle2, Search, XCircle } from 'lucide-react'
import { create } from 'zustand'
import { api, type GoSdk, type SdkDownload, type ToolsStatus } from '../lib/api'
import { allActions, comboFromEvent, keyLabel } from '../lib/keymap'
import { useApp, type Theme } from '../state/app'
import { DEFAULTS, savePrefs, usePrefs, type Prefs } from '../state/settings'
import { Button, Checkbox } from '../design/controls'
import { Banner, Dialog, ProgressBar, Spinner, toast } from '../design/feedback'
import { cn } from '../design/cn'
import { fold } from '../search/state'
import { useAgents } from '../git/CommitAgent'

type PageId = 'appearance' | 'editor' | 'keymap' | 'go' | 'tools' | 'terminal'

export const useSettingsUi = create<{ open: boolean; page: PageId }>(() => ({ open: false, page: 'appearance' }))
export const openSettings = (page?: PageId) => useSettingsUi.setState((s) => ({ open: true, page: page ?? s.page }))

const PAGES: Array<{ id: PageId; title: string; keywords: string[] }> = [
  { id: 'appearance', title: t('Aparência'), keywords: ['tema', 'escuro', 'claro', 'cores', 'idioma', 'language', 'inglês', 'english', 'português'] },
  { id: 'editor', title: t('Editor'), keywords: ['fonte', 'tamanho', 'formatar', 'salvar', 'imports', 'gofmt', 'dicas', 'inlay', 'parâmetros'] },
  { id: 'keymap', title: t('Atalhos'), keywords: ['teclado', 'keymap', 'atalho'] },
  { id: 'go', title: 'Go', keywords: ['sdk', 'goroot', 'versão', 'go'] },
  { id: 'tools', title: t('Ferramentas'), keywords: ['gopls', 'delve', 'dlv', 'git', 'ripgrep', 'instalar', 'depurador', 'ia', 'ai', 'agente', 'claude', 'codex', 'gemini', 'commit'] },
  { id: 'terminal', title: t('Terminal'), keywords: ['shell', 'bash', 'zsh', 'fish'] },
]

interface Draft {
  theme: Theme
  language: LangPref
  fontSize: string // texto do campo (pode estar inválido enquanto digita)
  formatOnSave: boolean
  inlayHints: boolean
  shell: string
}

const fromState = (theme: Theme, p: Prefs): Draft => ({
  theme,
  language: storedPref(),
  fontSize: String(p['editor.fontSize']),
  formatOnSave: p['editor.formatOnSave'],
  inlayHints: p['editor.inlayHints'],
  shell: p['terminal.shell'],
})

function fontSizeError(v: string): string | undefined {
  const n = Number(v)
  if (!/^\d+$/.test(v.trim()) || n < 9 || n > 32) return t('Use um número inteiro entre 9 e 32.')
}

/** Destaca no rótulo o que casa com a busca. */
function Hl({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const i = fold(text).indexOf(fold(q))
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-xs bg-search-match-bg text-text">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

function Field({ label, q, hint, error, children }: { label: string; q: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="text-sm text-text">
        <Hl text={label} q={q} />
      </div>
      {children}
      {error ? <p className="text-xs text-danger">{error}</p> : hint && <p className="text-xs text-text-muted">{hint}</p>}
    </div>
  )
}

const inputCls =
  'h-control rounded-md border border-border-input bg-bg px-2 text-sm text-text placeholder:text-text-muted outline-none focus:border-focus focus:ring-2 focus:ring-focus aria-[invalid=true]:border-danger'

export function SettingsDialog() {
  const open = useSettingsUi((s) => s.open)
  const close = () => useSettingsUi.setState({ open: false })
  return (
    <ModalOverlay isOpen={open} onOpenChange={(o) => !o && close()} isDismissable className="fixed inset-0 z-dialog flex items-center justify-center bg-overlay p-4">
      <Modal className="max-h-full max-w-full outline-none">
        <AriaDialog aria-labelledby="settings-title" className="flex h-[min(85vh,640px)] w-dialog-lg max-w-full flex-col overflow-hidden rounded-lg bg-surface shadow-dialog outline-none">
          {open && <Body close={close} />}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  )
}

function Body({ close }: { close: () => void }) {
  const theme = useApp((s) => s.theme)
  const setTheme = useApp((s) => s.setTheme)
  const prefs = usePrefs()
  const page = useSettingsUi((s) => s.page)
  const setPage = (p: PageId) => useSettingsUi.setState({ page: p })
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState<Draft>(() => fromState(theme, prefs))
  const [saved, setSaved] = useState<Draft>(() => fromState(theme, prefs))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Busca: páginas cujo título, palavras-chave ou (nos atalhos) ações casam.
  const actionTitles = useMemo(() => allActions().map((a) => a.title), [])
  const visible = PAGES.filter((p) => {
    if (!q.trim()) return true
    const f = fold(q.trim())
    const words = [p.title, ...p.keywords, ...(p.id === 'keymap' ? actionTitles : [])]
    return words.some((w) => fold(w).includes(f))
  })
  const current = visible.find((p) => p.id === page) ?? visible[0]

  const fsError = fontSizeError(draft.fontSize)
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)

  const apply = async (): Promise<boolean> => {
    if (fsError) {
      setPage('editor')
      return false
    }
    setBusy(true)
    setError(null)
    try {
      const changes: Partial<Prefs> = {}
      if (draft.fontSize !== saved.fontSize) changes['editor.fontSize'] = Number(draft.fontSize)
      if (draft.formatOnSave !== saved.formatOnSave) changes['editor.formatOnSave'] = draft.formatOnSave
      if (draft.inlayHints !== saved.inlayHints) changes['editor.inlayHints'] = draft.inlayHints
      if (draft.shell.trim() !== saved.shell) changes['terminal.shell'] = draft.shell.trim()
      await savePrefs(changes)
      if (draft.theme !== saved.theme) setTheme(draft.theme)
      if (draft.language !== saved.language) {
        await api.Settings.Set('appearance.language', draft.language)
        storePref(draft.language)
        if (resolveLang(draft.language) !== lang) {
          await useDocs.getState().autosave() // recarregar não perde o que foi digitado
          location.reload()
          return true
        }
      }
      const next = { ...draft, shell: draft.shell.trim() }
      setSaved(next)
      setDraft(next)
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))

  return (
    <>
      <div className="flex min-h-0 flex-1">
        <nav aria-label={t('Categorias')} className="flex w-settings-nav-width shrink-0 flex-col gap-2 border-r border-border bg-chrome p-2">
          <Heading id="settings-title" slot="title" className="px-2 pt-1 text-md text-text">
            {t('Configurações')}
          </Heading>
          <label className="relative flex items-center">
            <Search className="pointer-events-none absolute left-2 size-icon-sm text-text-muted" aria-hidden />
            <input aria-label={t('Buscar nas configurações')} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Buscar')} className={cn(inputCls.replace('px-2', 'pl-8 pr-2'), 'w-full')} />
          </label>
          <ul className="flex flex-col gap-0.5">
            {visible.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  aria-current={p.id === current?.id ? 'page' : undefined}
                  onClick={() => setPage(p.id)}
                  className={cn(
                    'flex h-row w-full items-center rounded-sm px-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus',
                    p.id === current?.id ? 'bg-selection text-text' : 'text-text hover:bg-hover',
                  )}
                >
                  {p.title}
                  {p.id === 'editor' && fsError && <span className="ml-auto size-1.5 rounded-pill bg-danger" aria-label={t('valor inválido')} />}
                </button>
              </li>
            ))}
          </ul>
          {visible.length === 0 && <p className="px-2 text-xs text-text-muted">{t('Nada encontrado para "{q}".', { q })}</p>}
        </nav>
        <section aria-label={current?.title ?? t('Configurações')} className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="mb-3">
              <Banner level="danger" onClose={() => setError(null)}>
                {error}
              </Banner>
            </div>
          )}
          {current && <h3 className="mb-2 text-md font-semibold text-text">{current.title}</h3>}
          {current?.id === 'appearance' && (
            <Field label={t('Tema')} q={q}>
              <RadioGroup aria-label={t('Tema')} value={draft.theme} onChange={(v) => set('theme', v as Theme)} orientation="horizontal" className="flex gap-2">
                {(
                  [
                    ['dark', t('Escuro')],
                    ['light', t('Claro')],
                  ] as const
                ).map(([v, l]) => (
                  <Radio
                    key={v}
                    value={v}
                    className="cursor-default rounded-md border border-border px-3 py-1 text-sm text-text outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus data-[selected]:border-accent data-[selected]:bg-selection"
                  >
                    {l}
                  </Radio>
                ))}
              </RadioGroup>
            </Field>
          )}
          {current?.id === 'appearance' && (
            <Field label={t('Idioma')} q={q} hint={t('A janela recarrega para trocar o idioma (os arquivos abertos são salvos antes).')}>
              <RadioGroup aria-label={t('Idioma')} value={draft.language} onChange={(v) => set('language', v as LangPref)} orientation="horizontal" className="flex gap-2">
                {(
                  [
                    ['system', t('Seguir o sistema')],
                    ['pt-BR', 'Português (Brasil)'],
                    ['en', 'English'],
                  ] as const
                ).map(([v, l]) => (
                  <Radio
                    key={v}
                    value={v}
                    className="cursor-default rounded-md border border-border px-3 py-1 text-sm text-text outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus data-[selected]:border-accent data-[selected]:bg-selection"
                  >
                    {l}
                  </Radio>
                ))}
              </RadioGroup>
            </Field>
          )}
          {current?.id === 'editor' && (
            <>
              <Field label={t('Tamanho da fonte')} q={q} hint={t('Padrão: {n}. Vale também para o terminal.', { n: DEFAULTS['editor.fontSize'] })} error={fsError}>
                <input
                  aria-label={t('Tamanho da fonte')}
                  inputMode="numeric"
                  value={draft.fontSize}
                  onChange={(e) => set('fontSize', e.target.value)}
                  aria-invalid={!!fsError}
                  className={cn(inputCls, 'w-[6rem]')}
                />
              </Field>
              <Field label={t('Ao salvar')} q={q}>
                <Checkbox isSelected={draft.formatOnSave} onChange={(v) => set('formatOnSave', v)}>
                  <Hl text={t('Formatar e organizar imports com Ctrl+S')} q={q} />
                </Checkbox>
              </Field>
              <Field label={t('Dicas inline')} q={q} hint={t('Nomes de parâmetros e tipos que o gopls mostra dentro do código.')}>
                <Checkbox isSelected={draft.inlayHints} onChange={(v) => set('inlayHints', v)}>
                  <Hl text={t('Mostrar dicas inline (inlay hints)')} q={q} />
                </Checkbox>
              </Field>
            </>
          )}
          {current?.id === 'keymap' && <KeymapPage q={q} />}
          {current?.id === 'go' && <GoPage q={q} />}
          {current?.id === 'tools' && <ToolsPage q={q} />}
          {current?.id === 'terminal' && (
            <Field label="Shell" q={q} hint={t('Vazio usa o shell do sistema ($SHELL). Vale para terminais novos.')}>
              <input aria-label="Shell" value={draft.shell} onChange={(e) => set('shell', e.target.value)} placeholder={t('padrão do sistema')} spellCheck={false} className={cn(inputCls, 'w-[20rem] font-mono')} />
            </Field>
          )}
        </section>
      </div>
      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        {dirty && <span className="text-xs text-text-muted">{t('Alterações não aplicadas')}</span>}
        <span className="ml-auto" />
        <Button onPress={close}>{t('Cancelar')}</Button>
        <Button isDisabled={!dirty || busy} onPress={() => void apply()}>
          {t('Aplicar')}
        </Button>
        <Button variant="primary" isDisabled={busy} onPress={async () => (!dirty || (await apply())) && close()}>
          OK
        </Button>
      </div>
    </>
  )
}

function KeymapPage({ q }: { q: string }) {
  const [filter, setFilter] = useState('')
  const overrides = usePrefs((s) => s['keymap.overrides'])
  const [recording, setRecording] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ id: string; keys: string; other: { id: string; title: string } } | null>(null)
  const f = fold(filter || q)
  const actions = allActions()
  const list = actions.filter((a) => !f || fold(a.title).includes(f) || fold(a.keys ?? '').includes(f)).sort((a, b) => a.title.localeCompare(b.title, lang))
  const save = (next: Record<string, string>) => void savePrefs({ 'keymap.overrides': next })
  const assign = (id: string, keys: string, force = false) => {
    const other = actions.find((a) => a.id !== id && a.keys === keys)
    if (other && !force) return setConflict({ id, keys, other: { id: other.id, title: other.title } })
    const next = { ...overrides, [id]: keys }
    if (other) next[other.id] = '' // tira da outra ação
    const def = actions.find((a) => a.id === id)?.defaultKeys
    if (def === keys) delete next[id] // voltou ao padrão
    save(next)
    setConflict(null)
  }
  const reset = (id: string) => {
    const { [id]: _, ...rest } = overrides
    save(rest)
  }
  return (
    <>
      <p className="mb-2 text-xs text-text-muted">{t('Clique em "Alterar" e aperte a combinação nova (Esc cancela). Vale na hora.')}</p>
      <div className="mb-2 flex items-center gap-2">
        <input aria-label={t('Filtrar ações')} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('Filtrar por ação ou tecla')} className={cn(inputCls, 'w-[18rem]')} />
        {Object.keys(overrides).length > 0 && (
          <Button size="sm" onPress={() => save({})}>
            {t('Restaurar todos')}
          </Button>
        )}
      </div>
      {conflict && (
        <div className="mb-2">
          <Banner
            level="warning"
            actions={
              <>
                <Button size="sm" onPress={() => assign(conflict.id, conflict.keys, true)}>
                  {t('Usar mesmo assim')}
                </Button>
                <Button size="sm" onPress={() => setConflict(null)}>
                  {t('Cancelar')}
                </Button>
              </>
            }
          >
            {t('{keys} já é de "{title}". Usar mesmo assim tira o atalho de lá.', { keys: keyLabel(conflict.keys) ?? conflict.keys, title: conflict.other.title })}
          </Banner>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-text-muted">
            <th className="py-1 font-normal">{t('Ação')}</th>
            <th className="py-1 font-normal">{t('Atalho')}</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody>
          {list.map((a) => (
            <tr key={a.id} className="border-t border-border">
              <td className="py-1 text-text">
                <Hl text={a.title} q={filter || q} />
              </td>
              <td className="py-1 font-mono text-xs text-text-muted">
                {recording === a.id ? (
                  <input
                    autoFocus
                    readOnly
                    data-recording-keys
                    aria-label={t('Novo atalho para {title}', { title: a.title })}
                    placeholder={t('aperte as teclas…')}
                    onBlur={() => setRecording(null)}
                    onKeyDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (e.key === 'Escape') return setRecording(null)
                      const combo = comboFromEvent(e)
                      if (!combo) return
                      setRecording(null)
                      assign(a.id, combo)
                    }}
                    className={cn(inputCls, 'h-control-sm w-[10rem] text-xs')}
                  />
                ) : (
                  <>
                    {keyLabel(a.keys) ?? '—'}
                    {a.id in overrides && <span className="ml-1 text-2xs text-warning">{t('(alterado)')}</span>}
                  </>
                )}
              </td>
              <td className="py-1 text-right">
                <Button size="sm" onPress={() => setRecording(a.id)} aria-label={t('Alterar o atalho de {title}', { title: a.title })}>
                  {t('Alterar')}
                </Button>
                {a.id in overrides && (
                  <Button size="sm" onPress={() => reset(a.id)} aria-label={t('Restaurar o atalho de {title}', { title: a.title })}>
                    {t('Restaurar', undefined, 'keymap')}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length === 0 && <p className="py-2 text-sm text-text-muted">{t('Nenhuma ação encontrada.')}</p>}
    </>
  )
}

function GoPage({ q }: { q: string }) {
  const [sdks, setSdks] = useState<GoSdk[] | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api.Sdks.List().then(setSdks, () => setSdks([]))
  }, [])
  const detect = async () => {
    setBusy(true)
    try {
      setSdks(await api.Sdks.Detect())
    } catch (e) {
      toast('danger', t('Não foi possível procurar SDKs'), (e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const choose = async (id: string) => {
    await api.Sdks.SetDefault(id)
    setSdks((l) => l?.map((s) => ({ ...s, isDefault: s.id === id })) ?? null)
    toast('success', t('SDK padrão trocado'), t('Vale para projetos abertos daqui em diante. Reabra o projeto atual para usar o novo.'))
  }
  return (
    <Field label={t('Go SDK padrão')} q={q} hint={t('O GOROOT usado pelo gopls, pelo build, pelos testes e pelo depurador.')}>
      {!sdks ? (
        <Spinner label={t('Carregando')} />
      ) : sdks.length === 0 ? (
        <p className="text-sm text-warning">{t('Nenhum Go encontrado. Instale o Go e clique em Procurar.')}</p>
      ) : (
        <RadioGroup aria-label={t('Go SDK padrão')} value={sdks.find((s) => s.isDefault)?.id ?? null} onChange={(id) => void choose(id)} className="flex flex-col gap-1">
          {sdks.map((s) => (
            <Radio
              key={s.id}
              value={s.id}
              className="flex cursor-default items-center gap-3 rounded-md border border-border px-3 py-1.5 text-sm outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus data-[selected]:border-accent data-[selected]:bg-selection"
            >
              <span className="font-semibold text-text">{s.version || t('versão desconhecida')}</span>
              <span className="min-w-0 truncate font-mono text-xs text-text-muted">{s.goroot}</span>
              <span className="ml-auto text-xs text-text-muted">{s.source}</span>
            </Radio>
          ))}
        </RadioGroup>
      )}
      <div className="flex gap-2 pt-1">
        <Button size="sm" loading={busy} onPress={detect}>
          {t('Procurar SDKs')}
        </Button>
        <SdkDownloadButton onDone={() => void api.Sdks.List().then(setSdks)} />
      </div>
    </Field>
  )
}

/** Baixar uma versão do go.dev: escolhe na lista, acompanha o download e registra o SDK no fim. */
function SdkDownloadButton({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState('')
  const [state, setState] = useState<SdkDownload | null>(null)
  useEffect(() => {
    if (!open) return
    setState(null)
    setError(null)
    api.Sdks.Available().then(
      (l) => {
        const vs = [...new Set(l.filter((r) => r.stable).map((r) => r.version))].slice(0, 30)
        setVersions(vs)
        setVersion(vs[0] ?? '')
      },
      (e) => setError((e as Error).message),
    )
  }, [open])
  useEffect(() => {
    if (!state || state.phase === 'pronto' || state.phase === 'erro') return
    const timer = setTimeout(() => void api.Sdks.DownloadStatus(state.version).then(setState, () => {}), 400)
    return () => clearTimeout(timer)
  }, [state])
  useEffect(() => {
    if (state?.phase === 'pronto') {
      toast('success', t('{name} instalado', { name: state.version }), state.goroot)
      onDone()
      setOpen(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.phase])
  const start = async () => {
    try {
      setState(await api.Sdks.Download(version))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const running = !!state && state.phase !== 'erro' && state.phase !== 'pronto'
  const pct = state && state.total ? Math.round((100 * state.done) / state.total) : 0
  return (
    <>
      <Button size="sm" onPress={() => setOpen(true)}>
        {t('Baixar uma versão…')}
      </Button>
      <Dialog
        title={t('Baixar o Go')}
        isOpen={open}
        onOpenChange={(o) => !o && !running && setOpen(false)}
        dismissable={!running}
        footer={
          <>
            <Button isDisabled={running} onPress={() => setOpen(false)}>
              {t('Cancelar')}
            </Button>
            <Button variant="primary" loading={running} isDisabled={!version || running} onPress={() => void start()}>
              {t('Baixar e instalar')}
            </Button>
          </>
        }
      >
        {error && <p className="mb-2 text-sm text-danger">{error}</p>}
        {state?.phase === 'erro' && <p className="mb-2 text-sm text-danger">{state.error}</p>}
        {!versions && !error ? (
          <Spinner label={t('Lendo as versões do go.dev')} />
        ) : (
          versions && (
            <label className="flex flex-col gap-1 text-sm text-text">
              {t('Versão')}
              <select aria-label={t('Versão')} value={version} disabled={running} onChange={(e) => setVersion(e.target.value)} className="h-control rounded-md border border-border-input bg-bg px-2 text-sm text-text outline-none focus:border-focus focus:ring-2 focus:ring-focus">
                {versions.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
              <span className="text-xs text-text-muted">{t('Vai para ~/sdk/{version}, conferido pelo sha256 do go.dev.', { version })}</span>
            </label>
          )
        )}
        {running && (
          <div className="mt-3 flex items-center gap-3" aria-live="polite">
            <ProgressBar label={t('Andamento do download')} value={pct} />
            <span className="w-[6rem] text-xs tabular-nums text-text-muted">{state.phase === 'baixando' ? `${pct}%` : state.phase}</span>
          </div>
        )}
      </Dialog>
    </>
  )
}

const TOOLS: Array<{ key: keyof ToolsStatus; label: string; installable?: 'gopls' | 'dlv'; purpose: string }> = [
  { key: 'go', label: 'go', purpose: t('build, testes, módulos') },
  { key: 'git', label: 'git', purpose: t('controle de versão') },
  { key: 'gopls', label: 'gopls', installable: 'gopls', purpose: t('completar, navegar, refatorar') },
  { key: 'dlv', label: 'Delve (dlv)', installable: 'dlv', purpose: t('depurador') },
  { key: 'rg', label: 'ripgrep (rg)', purpose: t('opcional') },
]

function ToolsPage({ q }: { q: string }) {
  const [status, setStatus] = useState<ToolsStatus | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)
  const load = () => api.Tools.Status().then(setStatus, () => {})
  useEffect(() => void load(), [])
  const install = async (name: 'gopls' | 'dlv') => {
    setInstalling(name)
    try {
      await api.Tools.Install(name)
      toast('success', t('{name} instalado', { name }))
      await load()
    } catch (e) {
      toast('danger', t('Não foi possível instalar {name}', { name }), (e as Error).message)
    } finally {
      setInstalling(null)
    }
  }
  if (!status) return <Spinner label={t('Procurando ferramentas')} />
  return (
    <>
    <ul className="flex flex-col">
      {TOOLS.map((tl) => {
        const tool = status[tl.key]
        const found = !!tool.path
        return (
          <li key={tl.key} className="flex items-center gap-3 border-t border-border py-2 first:border-t-0">
            {found ? <CheckCircle2 className="size-icon shrink-0 text-success" aria-label={t('encontrado')} /> : <XCircle className="size-icon shrink-0 text-danger" aria-label={t('não encontrado')} />}
            <div className="min-w-0 flex-1">
              <div className="text-sm text-text">
                <Hl text={tl.label} q={q} /> <span className="text-xs text-text-muted">· {tl.purpose}</span>
              </div>
              <div className="truncate font-mono text-xs text-text-muted">{found ? `${tool.version ? tool.version + ' · ' : ''}${tool.path}` : t('não encontrado')}</div>
            </div>
            {tl.installable && !found && (
              <Button size="sm" loading={installing === tl.installable} isDisabled={!!installing || !status.go.path} onPress={() => install(tl.installable!)}>
                {t('Instalar')}
              </Button>
            )}
          </li>
        )
      })}
    </ul>
    <AgentSettings q={q} />
    </>
  )
}

/** Mensagens de commit com IA: qual agente da máquina usar, idioma e instruções. Grava na hora. */
function AgentSettings({ q }: { q: string }) {
  const prefs = usePrefs()
  const agents = useAgents((s) => s.list)
  const [command, setCommand] = useState(prefs['commit.agentCommand'])
  const [instructions, setInstructions] = useState(prefs['commit.agentInstructions'])
  const [error, setError] = useState<string>()
  useEffect(() => void useAgents.getState().load(true), [])
  const save = async (changes: Partial<Prefs>) => {
    setError(undefined)
    try {
      await savePrefs(changes)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const choice = prefs['commit.agent']
  const selectCls = 'h-control rounded-md border border-border-input bg-bg px-2 text-sm text-text outline-none focus:border-focus focus:ring-2 focus:ring-focus'
  return (
    <section aria-label={t('Mensagens de commit com IA')} className="mt-4 border-t border-border pt-3">
      <h4 className="text-sm font-semibold text-text">
        <Hl text={t('Mensagens de commit com IA')} q={q} />
      </h4>
      <p className="mt-1 text-xs text-text-muted">{t('O botão ✨ no Commit pede a mensagem ao agente de IA instalado na sua máquina, com o diff só do que está marcado. Nada é enviado sem você clicar.')}</p>
      <Field label={t('Agente')} q={q} error={error}>
        <select aria-label={t('Agente para mensagens de commit')} value={choice} onChange={(e) => void save({ 'commit.agent': e.target.value })} className={selectCls}>
          <option value="auto">{t('Automático (o primeiro instalado)')}</option>
          {(agents ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.available ? a.name : t('{name} (não instalado)', { name: a.name })}
            </option>
          ))}
          <option value="custom">{t('Comando personalizado')}</option>
          <option value="off">{t('Desligado')}</option>
        </select>
        <ul aria-label={t('Agentes encontrados')} className="mt-1 flex flex-col gap-0.5">
          {(agents ?? []).map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-xs">
              {a.available ? <CheckCircle2 className="size-icon-sm text-success" aria-label={t('encontrado')} /> : <XCircle className="size-icon-sm text-text-subtle" aria-label={t('não encontrado')} />}
              <span className="text-text">{a.name}</span>
              <span className="truncate font-mono text-text-muted">{a.available ? a.path : t('não encontrado')}</span>
            </li>
          ))}
        </ul>
      </Field>
      {choice === 'custom' && (
        <Field label={t('Comando do agente')} q={q} hint={t('Programa e argumentos. O pedido, com o diff, vai pela entrada padrão; a resposta é a mensagem.')}>
          <input
            aria-label={t('Comando do agente')}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onBlur={() => command !== prefs['commit.agentCommand'] && void save({ 'commit.agentCommand': command.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && void save({ 'commit.agentCommand': command.trim() })}
            placeholder="ex.: /usr/local/bin/meu-agente --modo commit"
            spellCheck={false}
            className={cn(selectCls, 'font-mono')}
          />
        </Field>
      )}
      <Field label={t('Idioma da mensagem')} q={q}>
        <select aria-label={t('Idioma da mensagem')} value={prefs['commit.agentLanguage']} onChange={(e) => void save({ 'commit.agentLanguage': e.target.value })} className={selectCls}>
          <option value="auto">{t('O mesmo dos commits recentes')}</option>
          <option value="pt-BR">Português (Brasil)</option>
          <option value="en">English</option>
        </select>
      </Field>
      <Field label={t('Instruções extras')} q={q} hint={t('Ex.: "use Conventional Commits", "cite o número da tarefa da branch".')}>
        <textarea
          aria-label={t('Instruções extras')}
          value={instructions}
          rows={2}
          onChange={(e) => setInstructions(e.target.value)}
          onBlur={() => instructions !== prefs['commit.agentInstructions'] && void save({ 'commit.agentInstructions': instructions })}
          className={cn(selectCls, 'h-auto py-1')}
        />
      </Field>
      <Checkbox isSelected={!prefs['commit.agentConsent']} onChange={(v) => void save({ 'commit.agentConsent': !v })}>
        {t('Perguntar antes de enviar o diff ao agente')}
      </Checkbox>
      <Checkbox isSelected={!prefs['agent.editConsent']} onChange={(v) => void save({ 'agent.editConsent': !v })}>
        {t('Perguntar antes de enviar o código do arquivo ao agente (IA no editor)')}
      </Checkbox>
    </section>
  )
}
