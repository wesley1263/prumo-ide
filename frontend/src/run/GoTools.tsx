// Ferramentas do Go: go mod tidy, go mod download, go generate, go vet e go get, com a saída na janela Executar.
import { useState } from 'react'
import { create } from 'zustand'
import { api, type RunInfo } from '../lib/api'
import { useApp } from '../state/app'
import { useDocs } from '../editor/docs'
import { useLayout } from '../shell/layout'
import { Button, TextField } from '../design/controls'
import { Dialog } from '../design/feedback'
import { t } from '../i18n'

export type GoTool = 'mod-tidy' | 'mod-download' | 'generate' | 'vet' | 'get'

export const GO_TOOLS: Array<{ id: GoTool; title: string }> = [
  { id: 'mod-tidy', title: 'go mod tidy' },
  { id: 'mod-download', title: 'go mod download' },
  { id: 'generate', title: 'go generate ./...' },
  { id: 'vet', title: 'go vet ./...' },
  { id: 'get', title: 'go get…' },
]

export const useGoGet = create<{ open: boolean }>(() => ({ open: false }))

/** Roda a ferramenta (go get pede o pacote antes). */
export async function runGoTool(tool: GoTool, arg = ''): Promise<RunInfo | null> {
  if (tool === 'get' && !arg) {
    useGoGet.setState({ open: true })
    return null
  }
  const p = useApp.getState().project
  if (!p) return null
  if (!p.trusted) {
    useApp.setState({ trustAsked: true })
    return null
  }
  await useDocs.getState().autosave()
  const info = await api.Runs.StartGoTool(p.id, tool, arg)
  useApp.setState({ runs: [info, ...useApp.getState().runs.filter((r) => r.id !== info.id)] }) // o evento run:state pode ter chegado antes
  useLayout.getState().show('run')
  return info
}

export function GoGetDialog() {
  const open = useGoGet((s) => s.open)
  const close = () => useGoGet.setState({ open: false })
  const [pkg, setPkg] = useState('')
  const [error, setError] = useState<string>()
  const submit = async () => {
    try {
      await runGoTool('get', pkg.trim())
      close()
      setPkg('')
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <Dialog
      title="go get"
      isOpen={open}
      onOpenChange={(o) => !o && close()}
      footer={
        <>
          <Button onPress={close}>{t('Cancelar')}</Button>
          <Button variant="primary" isDisabled={!pkg.trim()} onPress={submit}>
            {t('Adicionar')}
          </Button>
        </>
      }
    >
      <TextField
        label={t('Pacote ou módulo')}
        value={pkg}
        onChange={(v) => (setPkg(v), setError(undefined))}
        placeholder="github.com/google/uuid@latest"
        description={t('Adiciona a dependência ao go.mod (com @versão, se quiser uma específica).')}
        error={error}
        autoFocus
        onKeyDown={(e) => e.key === 'Enter' && pkg.trim() && void submit()}
      />
    </Dialog>
  )
}
