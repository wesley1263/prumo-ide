// Anexar o depurador (Ctrl+Alt+F5): a um processo desta máquina (lista com busca) ou a um "dlv --headless"
// pelo endereço. Parar a depuração só desconecta: o processo continua.
import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { Tab, TabList, TabPanel, Tabs } from 'react-aria-components'
import { api } from '../lib/api'
import { Button, TextField } from '../design/controls'
import { Dialog, toast } from '../design/feedback'
import { useApp } from '../state/app'
import { useDebug } from '../state/debug'
import { cn } from '../design/cn'
import { t } from '../i18n'

export const useAttachUi = create<{ open: boolean }>(() => ({ open: false }))

type Proc = { pid: number; name: string; command: string }

export function AttachDialog() {
  const open = useAttachUi((s) => s.open)
  const project = useApp((s) => s.project)
  const [tab, setTab] = useState<'local' | 'remote'>('local')
  const [procs, setProcs] = useState<Proc[] | null>(null)
  const [procError, setProcError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [pid, setPid] = useState<number | null>(null)
  const [addr, setAddr] = useState('localhost:2345')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setPid(null)
    setQuery('')
    api.Debug.Processes().then(setProcs, (e) => setProcError((e as Error).message))
  }, [open])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (procs ?? []).filter((p) => !q || p.command.toLowerCase().includes(q) || String(p.pid).startsWith(q)).slice(0, 200)
  }, [procs, query])
  const close = () => useAttachUi.setState({ open: false })
  const go = async (picked?: number) => {
    if (!project) return
    if (!project.trusted) return useApp.setState({ trustAsked: true })
    setBusy(true)
    try {
      const typed = /^\d+$/.test(query.trim()) ? Number(query.trim()) : null
      const info = tab === 'local' ? await api.Debug.AttachLocal(project.id, picked ?? pid ?? typed ?? 0) : await api.Debug.AttachRemote(project.id, addr)
      useDebug.getState().attached(info)
      close()
    } catch (e) {
      toast('danger', t('Não foi possível anexar'), (e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const canGo = tab === 'remote' ? !!addr.trim() : pid !== null || /^\d+$/.test(query.trim())
  return (
    <Dialog
      title={t('Anexar o depurador')}
      isOpen={open}
      onOpenChange={(o) => !o && close()}
      size="lg"
      footer={
        <>
          <Button onPress={close}>{t('Cancelar')}</Button>
          <Button variant="primary" loading={busy} isDisabled={!canGo} onPress={() => void go()}>
            {t('Anexar')}
          </Button>
        </>
      }
    >
      <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(k as 'local' | 'remote')}>
        <TabList aria-label={t('Onde está o programa')} className="mb-3 flex gap-1 border-b border-border">
          {[
            ['local', t('Processo nesta máquina')],
            ['remote', t('Delve remoto (headless)')],
          ].map(([id, label]) => (
            <Tab key={id} id={id} className="mb-[-1px] cursor-default border-b-2 border-transparent px-3 py-1 text-sm text-text-muted outline-none data-[selected]:border-accent data-[selected]:text-text data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus">
              {label}
            </Tab>
          ))}
        </TabList>
        <TabPanel id="local" className="outline-none">
          <TextField label={t('Buscar processo (nome, comando ou pid)')} value={query} onChange={(v) => (setQuery(v), setPid(null))} autoFocus />
          {procError ? (
            <p className="mt-2 text-xs text-text-muted">{procError}</p>
          ) : (
            <ul role="listbox" aria-label={t('Processos')} className="mt-2 max-h-[16rem] overflow-y-auto">
              {shown.map((p) => (
                <li
                  key={p.pid}
                  role="option"
                  aria-selected={pid === p.pid}
                  tabIndex={0}
                  onClick={() => setPid(p.pid)}
                  onDoubleClick={() => void go(p.pid)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setPid(p.pid)}
                  className={cn('flex cursor-default items-center gap-2 rounded-sm px-2 py-0.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-focus', pid === p.pid ? 'bg-selection' : 'hover:bg-hover')}
                >
                  <span className="w-[4rem] shrink-0 font-mono text-xs text-text-muted">{p.pid}</span>
                  <span className="shrink-0 text-text">{p.name}</span>
                  <span className="truncate font-mono text-xs text-text-muted">{p.command}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-text-muted">{t('No Linux, anexar a um processo que não foi aberto pelo Delve pode exigir ptrace_scope = 0.')}</p>
        </TabPanel>
        <TabPanel id="remote" className="outline-none">
          <TextField label={t('Endereço do Delve')} value={addr} onChange={setAddr} description={t('Do outro lado: dlv debug (ou dlv exec ./app) --headless --listen=:2345 --accept-multiclient')} />
        </TabPanel>
      </Tabs>
    </Dialog>
  )
}
