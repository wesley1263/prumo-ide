// S23 Branches: busca, ações rápidas (atualizar, push, nova branch, buscar), locais e remotas,
// e o que fazer quando a troca esbarra em mudanças locais.
import { Fragment, useEffect, useRef, useState } from 'react'
import { Button as AriaButton, Dialog as AriaDialog, Popover } from 'react-aria-components'
import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, FolderGit2, GitBranch, GitBranchPlus, MoreHorizontal, RefreshCw, Star, Tag } from 'lucide-react'
import { api, type Branch, type Branches } from '../lib/api'
import { Button, Checkbox, IconButton, Menu, TextField } from '../design/controls'
import { Dialog, EmptyState, Spinner, toast } from '../design/feedback'
import { cn } from '../design/cn'
import { useApp } from '../state/app'
import { afterDiskChange, favoriteBranches, toggleFavorite, useBranchCompare, useFavoriteBranches, useGitUi } from '../state/git'
import { keyLabel } from '../lib/keymap'
import { useWorktreeUi } from './Worktrees'
import { t } from '../i18n'

type NameDialog = { kind: 'new'; from: string } | { kind: 'rename'; from: string } | null

const widget =
  'inline-flex h-control max-w-dialog-sm items-center gap-1.5 rounded-md px-2 text-sm text-text outline-none transition-colors duration-fast ' +
  'data-[hovered]:bg-hover data-[pressed]:bg-pressed data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus'

function Counts({ b }: { b: Pick<Branch, 'ahead' | 'behind'> }) {
  if (!b.ahead && !b.behind) return null
  return (
    <span className="shrink-0 text-xs text-text-muted" aria-label={t('{ahead} para enviar, {behind} para receber', { ahead: b.ahead, behind: b.behind })}>
      {b.ahead > 0 && `↑${b.ahead}`} {b.behind > 0 && `↓${b.behind}`}
    </span>
  )
}

export function BranchesWidget() {
  const project = useApp((s) => s.project)!
  const git = useApp((s) => s.git)
  const { branchesOpen, setBranchesOpen, checkout, update, openPush } = useGitUi()
  const trigger = useRef<HTMLButtonElement>(null)
  const [data, setData] = useState<Branches | null>(null)
  const [query, setQuery] = useState('')
  const [nameDialog, setNameDialog] = useState<NameDialog>(null)

  const load = () =>
    api.Git.Branches(project.id)
      .then(setData)
      .catch((e) => toast('danger', t('Não foi possível ler as branches'), String(e.message)))

  useEffect(() => {
    if (!branchesOpen) return
    setQuery('')
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchesOpen])

  const q = query.trim().toLowerCase()
  const filter = (list: Branch[]) => (q ? list.filter((b) => b.name.toLowerCase().includes(q)) : list)
  useFavoriteBranches((s) => s.list) // redesenha ao marcar/desmarcar
  const favs = favoriteBranches()
  // Favoritas primeiro, na ordem em que vieram.
  const favFirst = (list: Branch[]) => [...list.filter((b) => favs.includes(b.name)), ...list.filter((b) => !favs.includes(b.name))]
  const local = favFirst(filter(data?.local ?? []))
  const remote = favFirst(filter(data?.remote ?? []))

  const fetchAll = async () => {
    try {
      await api.Git.Fetch(project.id)
      await load()
      await useApp.getState().refreshGit()
      toast('success', t('Remotos atualizados'))
    } catch (e) {
      toast('danger', t('Não foi possível buscar'), String((e as Error).message))
    }
  }

  const remove = async (name: string, force = false) => {
    if (!project.trusted) return useApp.setState({ trustAsked: true })
    try {
      const res = await api.Git.DeleteBranch(project.id, name, force)
      if (res.notMerged) {
        setConfirmDelete(name)
        return
      }
      setBranchesOpen(false) // com o popup aberto o resto da tela fica inerte: o "Restaurar" do aviso não seria clicável
      toast('info', t('Branch {name} apagada', { name }), undefined, {
        label: t('Restaurar'),
        run: () => void api.Git.RestoreBranch(project.id, name, res.hash).then(() => toast('success', t('Branch {name} restaurada', { name }))),
      })
    } catch (e) {
      toast('danger', t('Não foi possível apagar'), String((e as Error).message))
    }
  }
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  // Chamada como função (não <Row />): um componente criado a cada render remontaria as linhas e fecharia o menu aberto.
  const Row = ({ b }: { b: Branch }) => (
    <li className={cn('group flex h-row items-center gap-1 rounded-sm pr-1', b.current ? 'bg-selection' : 'hover:bg-hover')}>
      <AriaButton
        onPress={() => !b.current && checkout(b.name)}
        aria-label={(b.current ? t('{name} (atual)', { name: b.name }) : t('Trocar para {name}', { name: b.name })) + (favs.includes(b.name) ? t(', favorita') : '')}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-sm px-2 text-left text-sm outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-inset data-[focus-visible]:ring-focus"
      >
        {b.current ? <Tag className="size-icon-sm shrink-0 text-accent-text" aria-hidden /> : <GitBranch className="size-icon-sm shrink-0 text-text-muted" aria-hidden />}
        <span className={cn('truncate', b.current ? 'font-semibold text-text' : 'text-text')}>{b.name}</span>
        {favs.includes(b.name) && <Star className="size-3 shrink-0 fill-warning text-warning" aria-label={t('favorita')} />}
        {b.gone && <span className="shrink-0 text-xs text-warning">{t('remota apagada')}</span>}
        <span className="ml-auto" />
        <Counts b={b} />
      </AriaButton>
      <Menu
        label={t('Ações de {name}', { name: b.name })}
        trigger={<IconButton label={t('Ações de {name}', { name: b.name })} size="sm" icon={<MoreHorizontal className="size-icon-sm" />} />}
        items={[
          { id: 'checkout', label: t('Trocar para ela'), disabled: b.current },
          { id: 'new', label: t('Nova branch a partir daqui…') },
          { id: 'compare', label: t('Comparar com a atual'), disabled: b.current },
          ...(b.remote ? [] : [{ id: 'worktree', label: t('Abrir num worktree novo…'), disabled: b.current }]),
          { id: 'favorite', label: favs.includes(b.name) ? t('Tirar das favoritas') : t('Marcar como favorita') },
          ...(b.remote ? [] : [{ id: 'rename', label: t('Renomear…') }, { id: 'delete', label: t('Apagar'), danger: true, disabled: b.current, separatorBefore: true }]),
        ]}
        onAction={(id) => {
          if (id === 'checkout') checkout(b.name)
          if (id === 'new') setNameDialog({ kind: 'new', from: b.name })
          if (id === 'favorite') toggleFavorite(b.name)
          if (id === 'worktree') {
            setBranchesOpen(false)
            useWorktreeUi.setState({ add: b.name })
          }
          if (id === 'compare') {
            setBranchesOpen(false)
            useBranchCompare.setState({ other: b.name })
          }
          if (id === 'rename') setNameDialog({ kind: 'rename', from: b.name })
          if (id === 'delete') remove(b.name)
        }}
      />
    </li>
  )

  if (!git?.isRepo) return null
  return (
    <>
      <AriaButton ref={trigger} className={widget} aria-label={`Branch: ${git.branch || 'detached'}`} aria-expanded={branchesOpen} onPress={() => setBranchesOpen(!branchesOpen)}>
        <GitBranch className="size-icon-sm text-text-muted" aria-hidden />
        <span className="truncate">{git.branch || `HEAD ${git.head}`}</span>
        <Counts b={git} />
        {git.operation && <span className="rounded-xs bg-warning-bg px-1 text-2xs text-warning">{git.operation}</span>}
        <ChevronDown className="size-3 text-text-muted" aria-hidden />
      </AriaButton>
      <Popover triggerRef={trigger} isOpen={branchesOpen} onOpenChange={setBranchesOpen} placement="bottom start" offset={4} className="z-popup outline-none">
        <AriaDialog aria-label="Branches" className="flex max-h-popup-search-max-height w-dialog-sm flex-col rounded-lg border border-border bg-surface-raised shadow-pop outline-none">
          <div className="p-2">
            <TextField label={t('Buscar branch')} hideLabel value={query} onChange={setQuery} placeholder={t('Buscar branch')} autoFocus />
          </div>
          <div role="toolbar" aria-label={t('Ações do repositório')} className="flex flex-col gap-0.5 border-b border-border px-1 pb-1">
            {[
              { label: t('Atualizar projeto'), icon: <ArrowDownToLine className="size-icon-sm" />, keys: 'Mod+T', run: () => (setBranchesOpen(false), update('merge')) },
              { label: t('Push…'), icon: <ArrowUpFromLine className="size-icon-sm" />, keys: 'Mod+Shift+K', run: openPush },
              { label: t('Nova branch…'), icon: <GitBranchPlus className="size-icon-sm" />, run: () => setNameDialog({ kind: 'new', from: '' }) },
              { label: t('Buscar dos remotos (fetch)'), icon: <RefreshCw className="size-icon-sm" />, run: fetchAll },
              { label: t('Worktrees…'), icon: <FolderGit2 className="size-icon-sm" />, run: () => (setBranchesOpen(false), useWorktreeUi.setState({ list: true })) },
            ].map((a) => (
              <AriaButton
                key={a.label}
                onPress={a.run}
                className="flex h-row items-center gap-2 rounded-sm px-2 text-sm text-text outline-none data-[hovered]:bg-hover data-[focus-visible]:ring-2 data-[focus-visible]:ring-inset data-[focus-visible]:ring-focus"
              >
                <span className="text-text-muted">{a.icon}</span>
                {a.label}
                {a.keys && <span className="ml-auto font-mono text-2xs text-text-muted">{keyLabel(a.keys)}</span>}
              </AriaButton>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-1">
            {!data ? (
              <div className="flex justify-center p-4">
                <Spinner label={t('Lendo branches')} />
              </div>
            ) : local.length + remote.length === 0 ? (
              <EmptyState title={t('Nenhuma branch com esse nome')} />
            ) : (
              <>
                {local.length > 0 && (
                  <section aria-label={t('Locais', undefined, 'branches')}>
                    <h3 className="px-2 pb-0.5 pt-1 text-2xs font-semibold uppercase tracking-wide text-text-muted">{t('Locais', undefined, 'branches')}</h3>
                    <ul>{local.map((b) => <Fragment key={b.name}>{Row({ b })}</Fragment>)}</ul>
                  </section>
                )}
                {remote.length > 0 && (
                  <section aria-label={t('Remotas')}>
                    <h3 className="px-2 pb-0.5 pt-2 text-2xs font-semibold uppercase tracking-wide text-text-muted">{t('Remotas')}</h3>
                    <ul>{remote.map((b) => <Fragment key={b.name}>{Row({ b })}</Fragment>)}</ul>
                  </section>
                )}
              </>
            )}
          </div>
        </AriaDialog>
      </Popover>

      {nameDialog && (
        <BranchNameDialog
          mode={nameDialog}
          onClose={() => setNameDialog(null)}
          onDone={async () => {
            setNameDialog(null)
            setBranchesOpen(false)
            await afterDiskChange()
          }}
        />
      )}
      <Dialog
        title={t('Apagar branch com commits não integrados?')}
        isOpen={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        footer={
          <>
            <Button onPress={() => setConfirmDelete(null)}>{t('Cancelar')}</Button>
            <Button
              variant="danger"
              onPress={() => {
                const n = confirmDelete!
                setConfirmDelete(null)
                remove(n, true)
              }}
            >
              {t('Apagar mesmo assim')}
            </Button>
          </>
        }
      >
        {t('A branch')} <span className="font-mono">{confirmDelete}</span>{' '}
        {t('tem commits que não estão em nenhuma outra branch. Dá para restaurar logo depois, pelo aviso.')}
      </Dialog>
      <CheckoutBlockedDialog />
    </>
  )
}

function BranchNameDialog({ mode, onClose, onDone }: { mode: NonNullable<NameDialog>; onClose: () => void; onDone: () => void }) {
  const project = useApp((s) => s.project)!
  const [name, setName] = useState(mode.kind === 'rename' ? mode.from : '')
  const [switchTo, setSwitchTo] = useState(true)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!name.trim()) return
    if (!project.trusted) return useApp.setState({ trustAsked: true })
    setBusy(true)
    try {
      if (mode.kind === 'new') await api.Git.CreateBranch(project.id, name.trim(), mode.from, switchTo)
      else await api.Git.RenameBranch(project.id, mode.from, name.trim())
      onDone()
    } catch (e) {
      setError(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={mode.kind === 'new' ? t('Nova branch') : t('Renomear {name}', { name: mode.from })}
      isOpen
      onOpenChange={(o) => !o && onClose()}
      footer={
        <>
          <Button onPress={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onPress={submit} loading={busy} isDisabled={!name.trim()}>
            {mode.kind === 'new' ? t('Criar') : t('Renomear')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField
          label={t('Nome da branch')}
          value={name}
          onChange={(v) => (setName(v), setError(undefined))}
          error={error}
          autoFocus
          selectOnFocus
          placeholder={t('feat/minha-mudanca')}
          description={mode.kind === 'new' && mode.from ? t('A partir de {name}', { name: mode.from }) : undefined}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        {mode.kind === 'new' && (
          <Checkbox isSelected={switchTo} onChange={setSwitchTo}>
            {t('Trocar para a branch nova')}
          </Checkbox>
        )}
      </div>
    </Dialog>
  )
}

/** A troca de branch esbarrou em mudanças locais: levar junto, descartar ou desistir. */
function CheckoutBlockedDialog() {
  const blocked = useGitUi((s) => s.checkoutBlocked)
  const checkout = useGitUi((s) => s.checkout)
  const dismiss = () => useGitUi.setState({ checkoutBlocked: null })
  return (
    <Dialog
      title={t('Mudanças locais seriam perdidas')}
      isOpen={!!blocked}
      onOpenChange={(o) => !o && dismiss()}
      size="md"
      footer={
        <>
          <Button onPress={dismiss}>{t('Cancelar')}</Button>
          <Button variant="danger" onPress={() => blocked && checkout(blocked.ref, 'force')}>
            {t('Descartar mudanças')}
          </Button>
          <Button variant="primary" onPress={() => blocked && checkout(blocked.ref, 'smart')} autoFocus>
            {t('Levar as mudanças')}
          </Button>
        </>
      }
    >
      <p className="mb-2">
        {t('Trocar para')} <span className="font-mono">{blocked?.ref}</span> {t('sobrescreveria estes arquivos alterados:')}
      </p>
      <ul className="mb-2 max-h-dialog-sm overflow-auto rounded-sm bg-bg px-2 py-1 font-mono text-xs text-text">
        {blocked?.files.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <p className="text-text-muted">{t('"Levar as mudanças" guarda tudo, troca de branch e devolve as mudanças em cima dela.')}</p>
    </Dialog>
  )
}
