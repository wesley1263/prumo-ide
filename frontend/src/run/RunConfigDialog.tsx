// S12 Configurações de execução: lista por tipo (Go Build, Go Test) e o formulário da escolhida. As mudanças ficam
// em rascunho até Aplicar/OK; o backend valida campo a campo (RunConfigs.Validate) e o erro aparece no próprio campo.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay, Radio, RadioGroup } from 'react-aria-components'
import { ArrowDown, ArrowUp, Copy, Hammer, FlaskConical, Plus, Trash2, X } from 'lucide-react'
import { create } from 'zustand'
import { api, type BeforeTask, type RunConfig } from '../lib/api'
import { useApp } from '../state/app'
import { Button, Checkbox, IconButton, Menu } from '../design/controls'
import { Banner, EmptyState, toast } from '../design/feedback'
import { cn } from '../design/cn'
import { t } from '../i18n'

export const useRunConfigUi = create<{ open: boolean; focus: string | null }>(() => ({ open: false, focus: null }))
export const openRunConfigs = (focus?: string | null) => useRunConfigUi.setState({ open: true, focus: focus ?? useApp.getState().selectedConfig })

const blank = (projectId: string, type: RunConfig['type'], name: string): RunConfig => ({
  id: '',
  projectId,
  name,
  type,
  temporary: false,
  storeAsProjectFile: false,
  runKind: 'directory',
  packagePath: null,
  files: [],
  directory: '',
  outputDir: null,
  runAfterBuild: true,
  workingDir: null,
  env: {},
  programArgs: '',
  goToolArgs: '',
  useBuildTags: true,
  redirectInputFrom: null,
  emulateTerminal: false,
  testFramework: type === 'go_test' ? 'gotest' : null,
  testPattern: null,
  lastUsedAt: null,
  beforeLaunch: [],
})

// Rascunho: a chave é o id (ou "novo:N" para as que ainda não existem no banco).
type Draft = RunConfig & { key: string }
const keyOf = (c: RunConfig) => c.id

const inputCls =
  'h-control w-full rounded-md border border-border-input bg-bg px-2 text-sm text-text placeholder:text-text-muted outline-none focus:border-focus focus:ring-2 focus:ring-focus aria-[invalid=true]:border-danger'

export function RunConfigDialog() {
  const open = useRunConfigUi((s) => s.open)
  const close = () => useRunConfigUi.setState({ open: false })
  return (
    <ModalOverlay isOpen={open} onOpenChange={(o) => !o && close()} isDismissable className="fixed inset-0 z-dialog flex items-center justify-center bg-overlay p-4">
      <Modal className="max-h-full max-w-full outline-none">
        <AriaDialog aria-labelledby="runcfg-title" className="flex h-[min(85vh,680px)] w-dialog-lg max-w-full flex-col overflow-hidden rounded-lg bg-surface shadow-dialog outline-none">
          {open && <Body close={close} />}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  )
}

function Body({ close }: { close: () => void }) {
  const project = useApp((s) => s.project)!
  const saved = useApp((s) => s.runConfigs)
  const focus = useRunConfigUi((s) => s.focus)
  const [drafts, setDrafts] = useState<Draft[]>(() => saved.map((c) => ({ ...c, key: keyOf(c) })))
  const [removed, setRemoved] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(() => (focus && saved.some((c) => c.id === focus) ? focus : (saved[0]?.id ?? null)))
  const [problems, setProblems] = useState<Record<string, Record<string, string>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  const original = useMemo(() => new Map(saved.map((c) => [c.id, JSON.stringify({ ...c, key: c.id })])), [saved])
  const isDirty = (d: Draft) => !d.id || original.get(d.id) !== JSON.stringify(d)
  const dirty = removed.length > 0 || drafts.some(isDirty)
  const current = drafts.find((d) => d.key === selected)

  const update = (patch: Partial<RunConfig>) => setDrafts((ds) => ds.map((d) => (d.key === selected ? { ...d, ...patch } : d)))

  // Validação no backend enquanto edita (com uma pausa curta).
  useEffect(() => {
    if (!current) return
    const timer = setTimeout(() => {
      const { key, ...cfg } = current
      api.RunConfigs.Validate(project.id, cfg).then(
        (p) => setProblems((all) => ({ ...all, [key]: p })),
        () => {},
      )
    }, 200)
    return () => clearTimeout(timer)
  }, [current, project.id])

  const unique = (base: string) => {
    let name = base
    for (let i = 2; drafts.some((d) => d.name === name); i++) name = `${base} (${i})`
    return name
  }
  const add = (type: RunConfig['type']) => {
    const key = `novo:${++seq.current}`
    const d: Draft = { ...blank(project.id, type, unique(type === 'go_build' ? 'Go Build' : 'Go Test')), key }
    setDrafts((ds) => [...ds, d])
    setSelected(key)
  }
  const duplicate = () => {
    if (!current) return
    const key = `novo:${++seq.current}`
    setDrafts((ds) => [...ds, { ...current, id: '', temporary: false, name: unique(current.name + t(' (cópia)')), key }])
    setSelected(key)
  }
  const remove = () => {
    if (!current) return
    if (current.id) setRemoved((r) => [...r, current.id])
    const rest = drafts.filter((d) => d.key !== current.key)
    setDrafts(rest)
    setSelected(rest[0]?.key ?? null)
  }

  const apply = async (): Promise<boolean> => {
    // Confere tudo antes de gravar qualquer coisa: ou vai tudo, ou nada.
    setBusy(true)
    setError(null)
    try {
      const all: Record<string, Record<string, string>> = {}
      for (const d of drafts.filter(isDirty)) {
        const { key, ...cfg } = d
        all[key] = await api.RunConfigs.Validate(project.id, cfg)
      }
      setProblems((p) => ({ ...p, ...all }))
      const bad = drafts.find((d) => Object.keys(all[d.key] ?? {}).length > 0)
      if (bad) {
        setSelected(bad.key)
        return false
      }
      for (const id of removed) await api.RunConfigs.Delete(project.id, id)
      let firstNew: string | null = null
      const keys = new Map<string, string>()
      for (const d of drafts.filter(isDirty)) {
        const { key, ...cfg } = d
        const s = await api.RunConfigs.Save(project.id, cfg)
        keys.set(key, s.id)
        if (!d.id && !firstNew) firstNew = s.id
      }
      await useApp.getState().refreshRunConfigs()
      const fresh = useApp.getState().runConfigs
      setDrafts(fresh.map((c) => ({ ...c, key: c.id })))
      setRemoved([])
      setSelected((sel) => (sel && keys.get(sel)) || sel)
      if (firstNew) useApp.getState().selectConfig(firstNew)
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const groups: Array<{ type: RunConfig['type']; title: string; icon: ReactNode }> = [
    { type: 'go_build', title: 'Go Build', icon: <Hammer className="size-icon-sm shrink-0 text-accent-text" aria-hidden /> },
    { type: 'go_test', title: 'Go Test', icon: <FlaskConical className="size-icon-sm shrink-0 text-success" aria-hidden /> },
  ]
  const p = (current && problems[current.key]) ?? {}
  const invalid = (d: Draft) => Object.keys(problems[d.key] ?? {}).length > 0

  return (
    <>
      <div className="flex min-h-0 flex-1">
        <nav aria-label={t('Configurações', undefined, 'run')} className="flex w-settings-nav-width shrink-0 flex-col border-r border-border bg-chrome">
          <div className="flex items-center gap-1 p-2">
            <Heading id="runcfg-title" slot="title" className="flex-1 truncate text-md text-text">
              {t('Configurações de execução')}
            </Heading>
          </div>
          <div role="toolbar" aria-label={t('Ações das configurações')} className="flex items-center gap-1 px-2 pb-1">
            <Menu
              label={t('Nova configuração')}
              trigger={<IconButton label={t('Nova configuração')} size="sm" icon={<Plus className="size-icon-sm" />} />}
              items={[
                { id: 'go_build', label: 'Go Build' },
                { id: 'go_test', label: 'Go Test' },
              ]}
              onAction={(id) => add(id as RunConfig['type'])}
            />
            <IconButton label={t('Duplicar')} size="sm" icon={<Copy className="size-icon-sm" />} isDisabled={!current} onPress={duplicate} />
            <IconButton label={t('Apagar')} size="sm" icon={<Trash2 className="size-icon-sm" />} isDisabled={!current} onPress={remove} />
          </div>
          <div role="listbox" aria-label={t('Lista de configurações')} className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
            {groups.map((g) => {
              const list = drafts.filter((d) => d.type === g.type)
              if (!list.length) return null
              return (
                <div key={g.type} role="group" aria-label={g.title}>
                  <div role="presentation" className="flex items-center gap-1.5 px-2 pb-0.5 pt-2 text-2xs font-semibold uppercase tracking-wide text-text-muted">
                    {g.icon}
                    {g.title}
                  </div>
                  {list.map((d) => (
                    <div
                      key={d.key}
                      role="option"
                      tabIndex={0}
                      aria-selected={d.key === selected}
                      aria-label={`${d.name}${d.temporary ? t(', temporária') : ''}${invalid(d) ? t(', com erro') : ''}${isDirty(d) ? t(', alterada') : ''}`}
                      onClick={() => setSelected(d.key)}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSelected(d.key)}
                      className={cn(
                        'flex h-row cursor-default items-center gap-2 rounded-sm px-2 pl-6 text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus',
                        d.key === selected ? 'bg-selection text-text' : 'text-text hover:bg-hover',
                      )}
                    >
                      <span className={cn('truncate', d.temporary && 'italic text-text-muted')}>{d.name}</span>
                      {invalid(d) && <X className="size-3 shrink-0 text-danger" aria-hidden />}
                      {isDirty(d) && <span className="ml-auto size-1.5 shrink-0 rounded-pill bg-accent-text" aria-hidden />}
                    </div>
                  ))}
                </div>
              )
            })}
            {drafts.length === 0 && <p className="px-2 py-2 text-xs text-text-muted">{t('Nenhuma configuração. Use + para criar.')}</p>}
          </div>
        </nav>
        <section aria-label={current ? t('Configuração {name}', { name: current.name }) : t('Configuração')} className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="mb-3">
              <Banner level="danger" onClose={() => setError(null)}>
                {error}
              </Banner>
            </div>
          )}
          {!current ? (
            <EmptyState title={t('Nenhuma configuração escolhida')}>{t('Escolha uma na lista ou crie uma nova (Go Build ou Go Test).')}</EmptyState>
          ) : (
            <Form key={current.key} cfg={current} problems={p} update={update} others={drafts.filter((d) => d.id && d.key !== current.key)} />
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
        <Button
          variant="primary"
          isDisabled={busy}
          onPress={async () => {
            if (!dirty || (await apply())) {
              close()
              if (dirty) toast('success', t('Configurações salvas'))
            }
          }}
        >
          OK
        </Button>
      </div>
    </>
  )
}

function Field({ label, error, hint, children, id }: { label: string; error?: string; hint?: ReactNode; children: ReactNode; id: string }) {
  return (
    <div className="grid grid-cols-[11rem_1fr] items-start gap-x-3 py-1.5">
      <label htmlFor={id} className="pt-1.5 text-sm text-text">
        {label}
      </label>
      <div className="flex min-w-0 flex-col gap-1">
        {children}
        {error ? (
          <p id={id + '-err'} className="text-xs text-danger">
            {error}
          </p>
        ) : (
          hint && <p className="text-xs text-text-muted">{hint}</p>
        )}
      </div>
    </div>
  )
}

function TextInput({ id, value, onChange, error, placeholder, mono }: { id: string; value: string; onChange: (v: string) => void; error?: string; placeholder?: string; mono?: boolean }) {
  return (
    <input
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={!!error}
      aria-describedby={error ? id + '-err' : undefined}
      placeholder={placeholder}
      spellCheck={false}
      className={cn(inputCls, mono && 'font-mono')}
    />
  )
}

const opt = (v: string) => (v.trim() === '' ? null : v.trim())

function Form({ cfg, problems: p, update, others }: { cfg: Draft; problems: Record<string, string>; update: (patch: Partial<RunConfig>) => void; others: Draft[] }) {
  const isTest = cfg.type === 'go_test'
  const env = Object.entries(cfg.env)
  const [rows, setRows] = useState<Array<[string, string]>>(env.length ? env : [])
  const setEnv = (next: Array<[string, string]>) => {
    setRows(next)
    update({ env: Object.fromEntries(next.filter(([k]) => k.trim() !== '').map(([k, v]) => [k.trim(), v])) })
  }
  return (
    <div className="flex flex-col">
      {cfg.temporary && (
        <div className="mb-2">
          <Banner level="info" actions={<Button size="sm" onPress={() => update({ temporary: false })}>{t('Salvar como permanente')}</Button>}>
            {t('Configuração temporária (criada pelo ▶ do gutter). As temporárias mais antigas são descartadas sozinhas.')}
          </Banner>
        </div>
      )}
      <Field id="rc-name" label={t('Nome')} error={p.name}>
        <TextInput id="rc-name" value={cfg.name} onChange={(v) => update({ name: v })} error={p.name} />
      </Field>
      {!cfg.temporary && (
        <Field id="rc-share" label={t('Compartilhar')} hint={cfg.storeAsProjectFile ? t('Fica em .prumo/run/ no projeto: vai pelo git para quem clonar.') : undefined}>
          <Checkbox isSelected={cfg.storeAsProjectFile} onChange={(v) => update({ storeAsProjectFile: v })}>
            {t('Guardar como arquivo do projeto')}
          </Checkbox>
        </Field>
      )}
      <Field id="rc-kind" label={isTest ? t('Testar') : t('Executar')} error={p.runKind}>
        <RadioGroup id="rc-kind" aria-label={isTest ? t('Testar') : t('Executar')} value={cfg.runKind} onChange={(v) => update({ runKind: v as RunConfig['runKind'] })} orientation="horizontal" className="flex gap-2">
          {(
            [
              ['directory', t('Pasta')],
              ['package', t('Pacote')],
              ['file', t('Arquivos')],
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
      {cfg.runKind === 'directory' && (
        <Field id="rc-dir" label={t('Pasta')} error={p.directory} hint={t('Relativa ao projeto. Vazio = a raiz.')}>
          <TextInput id="rc-dir" value={cfg.directory ?? ''} onChange={(v) => update({ directory: v.trim() })} error={p.directory} placeholder={t('ex.: cmd/app')} mono />
        </Field>
      )}
      {cfg.runKind === 'package' && (
        <Field id="rc-pkg" label={t('Pacote')} error={p.packagePath}>
          <TextInput id="rc-pkg" value={cfg.packagePath ?? ''} onChange={(v) => update({ packagePath: opt(v) })} error={p.packagePath} placeholder={t('ex.: ./cmd/app ou example.com/app/cmd/app')} mono />
        </Field>
      )}
      {cfg.runKind === 'file' && (
        <Field id="rc-files" label={t('Arquivos')} error={p.files} hint={t('Separados por vírgula, relativos ao projeto.')}>
          <TextInput
            id="rc-files"
            value={cfg.files.join(', ')}
            onChange={(v) => update({ files: v.split(',').map((x) => x.trim()).filter(Boolean) })}
            error={p.files}
            placeholder={t('ex.: cmd/app/main.go')}
            mono
          />
        </Field>
      )}
      {isTest && (
        <Field id="rc-pattern" label={t('Padrão (-run)')} error={p.testPattern} hint={t('Regex do go test; vazio = todos os testes.')}>
          <TextInput id="rc-pattern" value={cfg.testPattern ?? ''} onChange={(v) => update({ testPattern: opt(v) })} error={p.testPattern} placeholder={t('ex.: ^TestTotal$')} mono />
        </Field>
      )}
      {!isTest && (
        <Field id="rc-out" label={t('Pasta de saída')} error={p.outputDir} hint={t('Onde fica o binário. Vazio = uma pasta temporária da IDE.')}>
          <TextInput id="rc-out" value={cfg.outputDir ?? ''} onChange={(v) => update({ outputDir: opt(v) })} error={p.outputDir} placeholder={t('ex.: bin')} mono />
        </Field>
      )}
      {!isTest && (
        <Field id="rc-runafter" label={t('Depois de compilar')}>
          <Checkbox isSelected={cfg.runAfterBuild} onChange={(v) => update({ runAfterBuild: v })}>
            {t('Rodar o programa')}
          </Checkbox>
        </Field>
      )}
      <Field id="rc-wd" label={t('Pasta de trabalho')} error={p.workingDir} hint={t('Relativa ao projeto. Vazio = a pasta do pacote.')}>
        <TextInput id="rc-wd" value={cfg.workingDir ?? ''} onChange={(v) => update({ workingDir: opt(v) })} error={p.workingDir} mono />
      </Field>
      <Field id="rc-env" label={t('Variáveis de ambiente')} error={p.env}>
        <div className="flex flex-col gap-1">
          {rows.map(([k, v], i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                aria-label={t('Nome da variável {n}', { n: i + 1 })}
                value={k}
                onChange={(e) => setEnv(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}
                placeholder={t('NOME')}
                spellCheck={false}
                className={cn(inputCls, 'w-[12rem] font-mono')}
              />
              <span className="text-text-muted">=</span>
              <input
                aria-label={t('Valor da variável {n}', { n: i + 1 })}
                value={v}
                onChange={(e) => setEnv(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))}
                placeholder={t('valor')}
                spellCheck={false}
                className={cn(inputCls, 'font-mono')}
              />
              <IconButton label={t('Remover a variável {name}', { name: k || i + 1 })} size="sm" icon={<X className="size-icon-sm" />} onPress={() => setEnv(rows.filter((_, j) => j !== i))} />
            </div>
          ))}
          <div>
            <Button size="sm" icon={<Plus className="size-icon-sm" />} onPress={() => setRows([...rows, ['', '']])}>
              {t('Adicionar variável')}
            </Button>
          </div>
        </div>
      </Field>
      <Field id="rc-args" label={isTest ? t('Argumentos do teste') : t('Argumentos do programa')} error={p.programArgs} hint={isTest ? t('Vão depois de -args (flag.Args() no teste).') : undefined}>
        <TextInput id="rc-args" value={cfg.programArgs} onChange={(v) => update({ programArgs: v })} error={p.programArgs} placeholder={isTest ? t('ex.: -update') : t('ex.: -port 8080 "com espaço"')} mono />
      </Field>
      <Field id="rc-goargs" label={t('Argumentos do go')} error={p.goToolArgs} hint={isTest ? t('Ex.: -race -count=1 -v') : t('Ex.: -race -ldflags "-s -w"')}>
        <TextInput id="rc-goargs" value={cfg.goToolArgs} onChange={(v) => update({ goToolArgs: v })} error={p.goToolArgs} mono />
      </Field>
      <Field id="rc-tags" label={t('Build tags')}>
        <Checkbox isSelected={cfg.useBuildTags} onChange={(v) => update({ useBuildTags: v })}>
          {t('Usar as build tags do projeto')}
        </Checkbox>
      </Field>
      {!isTest && (
        <Field id="rc-stdin" label={t('Entrada (stdin) de')} error={p.redirectInputFrom} hint={t('Arquivo do projeto mandado para a entrada do programa.')}>
          <TextInput id="rc-stdin" value={cfg.redirectInputFrom ?? ''} onChange={(v) => update({ redirectInputFrom: opt(v) })} error={p.redirectInputFrom} placeholder={t('ex.: testdata/entrada.txt')} mono />
        </Field>
      )}
      {!isTest && (
        <Field id="rc-tty" label={t('Console')} hint={t('Roda num pseudo-terminal: cores e barras de progresso como num terminal; stdout e stderr chegam juntos. Não vale com a entrada vinda de arquivo.')}>
          <Checkbox isSelected={cfg.emulateTerminal} onChange={(v) => update({ emulateTerminal: v })}>
            {t('Emular terminal no console')}
          </Checkbox>
        </Field>
      )}
      <BeforeLaunch tasks={cfg.beforeLaunch ?? []} error={p.beforeLaunch} others={others} onChange={(beforeLaunch) => update({ beforeLaunch })} />
    </div>
  )
}

const taskLabel = { go_generate: 'go generate', run_config: t('Outra configuração'), external_tool: t('Comando') } as const

/** Antes de rodar: go generate, outra configuração ou um comando, na ordem; a primeira que falhar impede a compilação. */
function BeforeLaunch({ tasks, error, others, onChange }: { tasks: BeforeTask[]; error?: string; others: Draft[]; onChange: (next: BeforeTask[]) => void }) {
  const set = (i: number, patch: Partial<BeforeTask>) => onChange(tasks.map((task, j) => (j === i ? { ...task, ...patch } : task)))
  const move = (i: number, d: number) => {
    const next = [...tasks]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    onChange(next)
  }
  return (
    <Field id="rc-before" label={t('Antes de rodar')} error={error} hint={t('Na ordem; se uma falhar, nada é compilado.')}>
      <div className="flex flex-col gap-1">
        {tasks.length === 0 && <span className="text-xs text-text-muted">{t('Nenhuma tarefa.')}</span>}
        <ol aria-label={t('Tarefas antes de rodar')} className="flex flex-col gap-1">
          {tasks.map((task, i) => (
            <li key={i} className="flex items-center gap-1">
              <span className="w-control shrink-0 text-xs text-text-muted">{i + 1}.</span>
              <span className="shrink-0 text-sm text-text">{taskLabel[task.kind]}</span>
              {task.kind === 'run_config' && (
                <select aria-label={t('Configuração da tarefa {n}', { n: i + 1 })} value={task.ref ?? ''} onChange={(e) => set(i, { ref: e.target.value || null })} className={cn(inputCls, 'min-w-0 flex-1')}>
                  <option value="">{t('Escolha…')}</option>
                  {others.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              )}
              {task.kind === 'external_tool' && (
                <input
                  aria-label={t('Comando da tarefa {n}', { n: i + 1 })}
                  value={task.command ?? ''}
                  onChange={(e) => set(i, { command: e.target.value })}
                  placeholder={t('ex.: make assets (roda na raiz do projeto)')}
                  spellCheck={false}
                  className={cn(inputCls, 'min-w-0 flex-1 font-mono')}
                />
              )}
              {task.kind === 'go_generate' && <span className="flex-1 text-xs text-text-muted">{t('nos pacotes da configuração')}</span>}
              <IconButton label={t('Subir a tarefa {n}', { n: i + 1 })} size="sm" isDisabled={i === 0} icon={<ArrowUp className="size-icon-sm" />} onPress={() => move(i, -1)} />
              <IconButton label={t('Descer a tarefa {n}', { n: i + 1 })} size="sm" isDisabled={i === tasks.length - 1} icon={<ArrowDown className="size-icon-sm" />} onPress={() => move(i, 1)} />
              <IconButton label={t('Remover a tarefa {n}', { n: i + 1 })} size="sm" icon={<X className="size-icon-sm" />} onPress={() => onChange(tasks.filter((_, j) => j !== i))} />
            </li>
          ))}
        </ol>
        <div>
          <Menu
            label={t('Tipo de tarefa')}
            trigger={
              <Button size="sm" icon={<Plus className="size-icon-sm" />}>
                {t('Adicionar tarefa')}
              </Button>
            }
            items={[
              { id: 'go_generate', label: 'go generate' },
              { id: 'run_config', label: t('Outra configuração'), disabled: others.length === 0 },
              { id: 'external_tool', label: t('Comando') },
            ]}
            onAction={(k) => onChange([...tasks, { kind: k as BeforeTask['kind'] }])}
          />
        </div>
      </div>
    </Field>
  )
}
