// Mensagem de commit escrita pelo agente de IA da máquina do usuário (Claude Code, Codex, Gemini CLI ou um
// comando próprio). Só roda no clique; na primeira vez avisa que o diff vai para o provedor do agente.
import { useEffect, useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { create } from 'zustand'
import { api, type AgentInfo } from '../lib/api'
import { Button, Checkbox, IconButton } from '../design/controls'
import { Dialog, Spinner, toast } from '../design/feedback'
import { savePrefs, usePrefs } from '../state/settings'
import { lang, t } from '../i18n'

// Os agentes detectados (uma consulta por sessão; Configurações → Ferramentas pede de novo).
export const useAgents = create<{ list: AgentInfo[] | null; load: (force?: boolean) => Promise<void> }>((set, get) => ({
  list: null,
  load: async (force) => {
    if (get().list && !force) return
    try {
      set({ list: await api.Tools.Agents() })
    } catch {
      set({ list: [] })
    }
  },
}))

/** O agente que vai rodar, pela configuração: nome, provedor e se dá para usar. */
export function useResolvedAgent(): { name: string; vendor: string; usable: boolean; off: boolean } {
  const choice = usePrefs((s) => s['commit.agent'])
  const custom = usePrefs((s) => s['commit.agentCommand'])
  const list = useAgents((s) => s.list)
  if (choice === 'off') return { name: '', vendor: '', usable: false, off: true }
  if (choice === 'custom') {
    const exe = custom.trim().split(/\s+/)[0] ?? ''
    return { name: exe.split('/').pop() || t('comando personalizado'), vendor: '', usable: !!exe, off: false }
  }
  const found = choice === 'auto' ? list?.find((a) => a.available) : list?.find((a) => a.id === choice)
  if (!found) return { name: '', vendor: '', usable: false, off: false }
  return { name: found.name, vendor: found.vendor, usable: found.available, off: false }
}

interface Props {
  projectId: string
  trusted: boolean
  /** O que vai para o commit agora (os mesmos arquivos e trechos do botão Commit); null = nada marcado. */
  request: () => Promise<{ files: string[]; partial: Record<string, string> } | null>
  message: string
  onMessage: (m: string) => void
  askTrust: () => void
}

export function CommitAgentButton({ projectId, trusted, request, message, onMessage, askTrust }: Props) {
  const agent = useResolvedAgent()
  const consent = usePrefs((s) => s['commit.agentConsent'])
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const [dontAsk, setDontAsk] = useState(true)
  useEffect(() => void useAgents.getState().load(), [])
  if (agent.off) return null

  const generate = async () => {
    const req = await request()
    if (!req || req.files.length === 0) return toast('info', t('Marque os arquivos do commit primeiro'))
    setBusy(true)
    const before = message
    try {
      const res = await api.Git.SuggestCommitMessage(projectId, { ...req, uiLang: lang })
      onMessage(res.message)
      toast('success', t('Mensagem escrita pelo {agent}', { agent: res.agent }), t('Revise antes de commitar.'), before.trim() ? { label: t('Desfazer'), run: () => onMessage(before) } : undefined)
    } catch (e) {
      const msg = (e as Error).message
      if (!/cancelada|canceled/i.test(msg)) toast('danger', t('Não foi possível gerar a mensagem'), msg)
    } finally {
      setBusy(false)
    }
  }
  const start = () => {
    if (!trusted) return askTrust()
    if (!consent) return setAsking(true)
    void generate()
  }

  const label = agent.usable ? t('Gerar a mensagem com {agent}', { agent: agent.name }) : t('Nenhum agente de IA encontrado (Configurações → Ferramentas)')
  return (
    <>
      {busy ? (
        <span className="flex items-center gap-1" role="status" aria-label={t('{agent} está escrevendo a mensagem', { agent: agent.name })}>
          <Spinner label={t('{agent} está escrevendo a mensagem', { agent: agent.name })} />
          <IconButton label={t('Cancelar a geração')} size="sm" icon={<X className="size-icon-sm" />} onPress={() => void api.Git.CancelSuggest(projectId)} />
        </span>
      ) : (
        <IconButton label={label} size="sm" isDisabled={!agent.usable} icon={<Sparkles className="size-icon-sm text-accent-text" />} onPress={start} />
      )}
      <Dialog
        title={t('Gerar a mensagem com {agent}?', { agent: agent.name })}
        isOpen={asking}
        onOpenChange={(o) => !o && setAsking(false)}
        footer={
          <>
            <Button onPress={() => setAsking(false)}>{t('Cancelar')}</Button>
            <Button
              variant="primary"
              onPress={() => {
                setAsking(false)
                if (dontAsk) void savePrefs({ 'commit.agentConsent': true })
                void generate()
              }}
            >
              {t('Gerar')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm text-text">
          <p>
            {agent.vendor
              ? t('O diff dos arquivos marcados vai para a {vendor}, pelo {agent} instalado na sua máquina, com a sua conta.', { vendor: agent.vendor, agent: agent.name })
              : t('O diff dos arquivos marcados vai para o comando {agent}, com a sua conta.', { agent: agent.name })}
          </p>
          <p className="text-text-muted">{t('Só acontece quando você clica. O agente roda sem ferramentas, fora do projeto: ele só escreve a mensagem, e você revisa antes de commitar.')}</p>
          <Checkbox isSelected={dontAsk} onChange={setDontAsk}>
            {t('Não perguntar de novo')}
          </Checkbox>
        </div>
      </Dialog>
    </>
  )
}
