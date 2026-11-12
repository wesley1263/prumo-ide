// Criar merge request da branch atual: destino, título, descrição (o agente de IA pode escrever os dois),
// revisores e opções. Se a branch ainda não está no remoto (ou tem commits não enviados), faz o push antes.
import { useEffect, useMemo, useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { api, type GlUser, type MergeRequest } from '../lib/api'
import { Button, Checkbox, IconButton, TextArea, TextField } from '../design/controls'
import { Banner, Dialog, Spinner, toast } from '../design/feedback'
import { cn } from '../design/cn'
import { useApp } from '../state/app'
import { savePrefs, usePrefs } from '../state/settings'
import { useLayout } from '../shell/layout'
import { useDocs } from '../editor/docs'
import { useResolvedAgent } from './CommitAgent'
import { useMergeRequests } from './mergeRequests'
import { lang, t, tn } from '../i18n'

const selectCls = 'h-control w-full rounded-md border border-border-input bg-bg px-2 text-sm text-text outline-none focus:border-focus focus:ring-2 focus:ring-focus'

export function CreateMergeRequestDialog() {
  const open = useMergeRequests((s) => s.creating)
  const close = () => useMergeRequests.setState({ creating: false })
  return (
    <Dialog title={t('Novo merge request')} isOpen={open} onOpenChange={(o) => !o && close()} size="lg">
      {open && <Form close={close} />}
    </Dialog>
  )
}

interface Loaded {
  source: string
  remote: string
  targets: string[]
  unpushed: number
  hasUpstream: boolean
  existing: MergeRequest | null
}

function Form({ close }: { close: () => void }) {
  const project = useApp((s) => s.project)!
  const [data, setData] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [target, setTarget] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [draft, setDraft] = useState(false)
  const [reviewers, setReviewers] = useState<GlUser[]>([])
  const [assignToMe, setAssignToMe] = useState(true)
  const [removeSource, setRemoveSource] = useState(true)
  const [squash, setSquash] = useState(false)
  const [push, setPush] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Branch atual, destinos possíveis (as branches do remoto), o que falta enviar e se já existe um merge request.
  useEffect(() => {
    let stale = false
    ;(async () => {
      // O contexto é lido uma vez: se a janela o recarregar enquanto o diálogo está aberto, o que já foi digitado fica.
      const c = useMergeRequests.getState().ctx?.project ? useMergeRequests.getState().ctx! : await api.GitLab.Context(project.id)
      if (!c.project) throw new Error(c.error || t('O projeto não está ligado a um GitLab.'))
      const [branches, out] = await Promise.all([api.Git.Branches(project.id), api.Git.Outgoing(project.id)])
      const source = branches.current
      if (!source) throw new Error(t('Troque para uma branch antes (o HEAD está solto).'))
      const prefix = c.remote + '/'
      const targets = branches.remote
        .map((b) => b.name)
        .filter((n) => n.startsWith(prefix) && n !== prefix + 'HEAD')
        .map((n) => n.slice(prefix.length))
        .filter((n) => n !== source)
      const def = c.project.defaultBranch
      if (def && !targets.includes(def) && def !== source) targets.unshift(def)
      const existing = (await api.GitLab.List(project.id, { state: 'opened', scope: 'all', search: '', source }))[0] ?? null
      if (stale) return
      const tgt = targets.includes(def) ? def : (targets[0] ?? '')
      setData({ source, remote: c.remote, targets, unpushed: out.commits.length, hasUpstream: out.hasUpstream, existing })
      setTarget(tgt)
      setPush(!out.hasUpstream || out.commits.length > 0)
      setDescription(c.template)
    })().catch((e) => !stale && setLoadError(String((e as Error).message)))
    return () => {
      stale = true
    }
  }, [project.id])

  // Título padrão: com um commit só na branch, o assunto dele (como o GitLab faz).
  useEffect(() => {
    if (!data || !target) return
    let stale = false
    api.Git.CompareBranches(project.id, `${data.remote}/${target}`).then(
      (c) => {
        if (stale) return
        if (c.onlyCurrent.length === 1) setTitle((cur) => cur || c.onlyCurrent[0].subject)
      },
      () => {},
    )
    return () => {
      stale = true
    }
  }, [data, target, project.id])

  const submit = async () => {
    if (!data) return
    if (push && !project.trusted) return useApp.setState({ trustAsked: true }) // push fala com o remoto
    setBusy(true)
    setError(null)
    try {
      if (push) await useDocs.getState().autosave()
      const mr = await api.GitLab.Create(project.id, {
        sourceBranch: data.source,
        targetBranch: target,
        title,
        description,
        draft,
        reviewerIds: reviewers.map((r) => r.id),
        assignToMe,
        removeSourceBranch: removeSource,
        squash,
        push,
      })
      close()
      useLayout.getState().show('mergeRequests')
      void useMergeRequests.getState().openMr(mr.iid)
      toast('success', t('Merge request !{iid} criado', { iid: mr.iid }), mr.title)
    } catch (e) {
      setError(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <Banner level="danger">{loadError}</Banner>
  if (!data) return <Spinner label={t('Preparando o merge request')} />
  if (data.existing)
    return (
      <div className="flex flex-col gap-3">
        <Banner level="info">{t('A branch {branch} já tem um merge request aberto: !{iid} {title}', { branch: data.source, iid: data.existing.iid, title: data.existing.title })}</Banner>
        <div className="flex justify-end gap-2">
          <Button onPress={close}>{t('Fechar')}</Button>
          <Button
            variant="primary"
            onPress={() => {
              close()
              useLayout.getState().show('mergeRequests')
              void useMergeRequests.getState().openMr(data.existing!.iid)
            }}
          >
            {t('Abrir !{iid}', { iid: data.existing.iid })}
          </Button>
        </div>
      </div>
    )

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="flex items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs text-text-muted">{t('De')}</span>
          <span className="flex h-control items-center truncate font-mono text-sm text-text">{data.source}</span>
        </div>
        <span className="pb-2 text-text-muted" aria-hidden>
          →
        </span>
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs text-text-muted">{t('Para')}</span>
          <select aria-label={t('Branch de destino')} value={target} onChange={(e) => setTarget(e.target.value)} className={cn(selectCls, 'font-mono')}>
            {data.targets.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-end gap-1">
        <TextField label={t('Título')} value={title} onChange={setTitle} autoFocus className="min-w-0 flex-1" />
        <AgentButton
          target={target}
          onResult={(r) => {
            setTitle(r.title)
            setDescription(r.description)
          }}
        />
      </div>
      <TextArea label={t('Descrição (Markdown)')} value={description} onChange={setDescription} rows={8} />
      <Reviewers selected={reviewers} onChange={setReviewers} />
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <Checkbox isSelected={draft} onChange={setDraft}>
          {t('Rascunho (Draft)')}
        </Checkbox>
        <Checkbox isSelected={assignToMe} onChange={setAssignToMe}>
          {t('Atribuir a mim')}
        </Checkbox>
        <Checkbox isSelected={removeSource} onChange={setRemoveSource}>
          {t('Apagar a branch de origem depois do merge')}
        </Checkbox>
        <Checkbox isSelected={squash} onChange={setSquash}>
          {t('Squash dos commits no merge')}
        </Checkbox>
      </div>
      <Checkbox isSelected={push} onChange={setPush}>
        {!data.hasUpstream
          ? t('Enviar {branch} para {remote} antes (a branch ainda não está no remoto)', { branch: data.source, remote: data.remote })
          : data.unpushed > 0
            ? tn(data.unpushed, 'Enviar {n} commit que ainda não está no remoto', 'Enviar {n} commits que ainda não estão no remoto')
            : t('Fazer push antes')}
      </Checkbox>
      {error && <Banner level="danger">{error}</Banner>}
      <div className="flex justify-end gap-2">
        <Button onPress={close}>{t('Cancelar')}</Button>
        <Button variant="primary" type="submit" loading={busy} isDisabled={!title.trim() || !target}>
          {t('Criar merge request')}
        </Button>
      </div>
    </form>
  )
}

/** Busca pessoas do projeto e marca como revisores. */
function Reviewers({ selected, onChange }: { selected: GlUser[]; onChange: (u: GlUser[]) => void }) {
  const project = useApp((s) => s.project)!
  const [q, setQ] = useState('')
  const [found, setFound] = useState<GlUser[]>([])
  useEffect(() => {
    if (!q.trim()) return setFound([])
    let stale = false
    const id = setTimeout(() => {
      api.GitLab.Members(project.id, q).then(
        (list) => !stale && setFound(list),
        () => !stale && setFound([]),
      )
    }, 250)
    return () => {
      stale = true
      clearTimeout(id)
    }
  }, [q, project.id])
  const options = useMemo(() => found.filter((u) => !selected.some((s) => s.id === u.id)), [found, selected])
  return (
    <div className="flex flex-col gap-1">
      <TextField label={t('Revisores')} value={q} onChange={setQ} placeholder={t('Buscar pelo nome ou usuário')} />
      {options.length > 0 && (
        <ul aria-label={t('Pessoas encontradas')} className="flex max-h-[8rem] flex-col overflow-y-auto rounded-md border border-border">
          {options.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => {
                  onChange([...selected, u])
                  setQ('')
                }}
                className="flex h-row w-full items-center gap-2 px-2 text-left text-sm hover:bg-hover focus-visible:bg-selection focus-visible:outline-none"
              >
                <span className="text-text">{u.name}</span>
                <span className="text-xs text-text-muted">@{u.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected.length > 0 && (
        <ul aria-label={t('Revisores escolhidos')} className="flex flex-wrap gap-1">
          {selected.map((u) => (
            <li key={u.id} className="flex items-center gap-1 rounded-pill bg-selection py-0.5 pl-2 pr-0.5 text-xs text-text">
              {u.name}
              <IconButton label={t('Tirar {name}', { name: u.name })} size="sm" icon={<X className="size-3" />} onPress={() => onChange(selected.filter((s) => s.id !== u.id))} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type Suggest = (projectId: string, target: string, uiLang: string) => Promise<{ title: string; description: string; agent: string }>

/** ✨ O agente de IA escreve título e descrição a partir dos commits e do diff da branch (merge request do
 * GitLab ou pull request do GitHub: suggest e cancel dizem para qual). */
export function AgentButton({
  target,
  onResult,
  suggest = api.GitLab.SuggestDescription,
  cancel = api.GitLab.CancelSuggest,
}: {
  target: string
  onResult: (r: { title: string; description: string }) => void
  suggest?: Suggest
  cancel?: (projectId: string) => Promise<void>
}) {
  const project = useApp((s) => s.project)!
  const agent = useResolvedAgent()
  const consent = usePrefs((s) => s['commit.agentConsent'])
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  if (agent.off) return null
  const run = async () => {
    setAsking(false)
    setBusy(true)
    try {
      const r = await suggest(project.id, target, lang)
      onResult(r)
      toast('success', t('Título e descrição escritos pelo {agent}', { agent: r.agent }), t('Revise antes de criar.'))
    } catch (e) {
      const m = String((e as Error).message)
      if (!/cancelada|canceled/i.test(m)) toast('danger', t('Não foi possível gerar a descrição'), m)
    } finally {
      setBusy(false)
    }
  }
  if (busy)
    return (
      <span className="flex h-control items-center gap-1" role="status" aria-label={t('{agent} está escrevendo a descrição', { agent: agent.name })}>
        <Spinner label={t('{agent} está escrevendo a descrição', { agent: agent.name })} />
        <IconButton label={t('Cancelar a geração')} size="sm" icon={<X className="size-icon-sm" />} onPress={() => void cancel(project.id)} />
      </span>
    )
  const label = agent.usable ? t('Gerar título e descrição com {agent}', { agent: agent.name }) : t('Nenhum agente de IA encontrado (Configurações → Ferramentas)')
  return (
    <>
      <IconButton
        label={label}
        icon={<Sparkles className="size-icon-sm text-accent-text" />}
        isDisabled={!agent.usable || !target}
        onPress={() => {
          if (!project.trusted) return useApp.setState({ trustAsked: true })
          if (consent) void run()
          else setAsking(true)
        }}
      />
      <Dialog
        title={t('Gerar a descrição com {agent}?', { agent: agent.name })}
        isOpen={asking}
        onOpenChange={(o) => !o && setAsking(false)}
        footer={
          <>
            <Button onPress={() => setAsking(false)}>{t('Cancelar')}</Button>
            <Button
              variant="primary"
              onPress={() => {
                void savePrefs({ 'commit.agentConsent': true })
                void run()
              }}
            >
              {t('Gerar')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">
          {agent.vendor
            ? t('Os commits e o diff da branch vão para a {vendor}, pelo {agent} instalado na sua máquina, com a sua conta.', { vendor: agent.vendor, agent: agent.name })
            : t('Os commits e o diff da branch vão para o comando {agent}, com a sua conta.', { agent: agent.name })}
        </p>
      </Dialog>
    </>
  )
}
