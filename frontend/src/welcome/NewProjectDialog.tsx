// S02 Novo projeto: pasta-mãe, nome e caminho do módulo; o backend roda "go mod init" (e escreve um main.go,
// se pedido) e o projeto abre já confiável.
import { useState } from 'react'
import { api, ApiError } from '../lib/api'
import { Button, Checkbox, TextField } from '../design/controls'
import { Dialog, toast } from '../design/feedback'
import { useApp } from '../state/app'
import { t } from '../i18n'

export function NewProjectDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const home = useApp((s) => s.boot?.homeDir ?? '')
  const recent = useApp((s) => s.recent)
  const openProject = useApp((s) => s.openProject)
  const last = recent[0]?.rootPath
  const [parent, setParent] = useState(() => (last ? last.slice(0, last.lastIndexOf('/')) || home : home))
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [pathEdited, setPathEdited] = useState(false)
  const [withMain, setWithMain] = useState(true)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const modPath = pathEdited ? path : name

  const pick = async () => {
    try {
      const dir = await api.Dialogs.PickDirectory(t('Pasta onde criar'))
      if (dir) setParent(dir)
    } catch (e) {
      if (!(e instanceof ApiError && /seletor nativo/.test(e.raw))) toast('danger', t('Não foi possível escolher a pasta'), String((e as Error).message))
    }
  }
  const create = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const { project } = await api.Projects.CreateModule(parent, name, modPath, withMain)
      await openProject(project.rootPath)
      onClose()
      toast('success', t('Módulo criado'), t('{mod} em {path}', { mod: modPath, path: project.rootPath }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const ok = !!parent.trim() && !!name.trim()
  return (
    <Dialog
      title={t('Novo projeto Go')}
      isOpen={isOpen}
      onOpenChange={(o) => !o && !busy && onClose()}
      size="md"
      footer={
        <>
          <Button onPress={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" loading={busy} isDisabled={!ok} onPress={create}>
            {t('Criar')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-end gap-2">
          <TextField label={t('Pasta-mãe')} value={parent} onChange={setParent} className="flex-1" description={t('O projeto vira uma subpasta daqui.')} />
          <div className="pb-5">
            <Button onPress={pick}>{t('Escolher…')}</Button>
          </div>
        </div>
        <TextField
          label={t('Nome do projeto')}
          value={name}
          onChange={(v) => (setName(v), setError(undefined))}
          autoFocus
          placeholder={t('ex.: minha-api')}
          error={error}
          description={t('Vai criar {path}', { path: parent.replace(/\/+$/, '') + '/' + (name || '…') })}
          onKeyDown={(e) => e.key === 'Enter' && ok && void create()}
        />
        <TextField
          label={t('Caminho do módulo')}
          value={modPath}
          onChange={(v) => (setPath(v), setPathEdited(true))}
          placeholder={t('ex.: github.com/org/minha-api')}
          description={t('O que vai no go.mod (go mod init).')}
        />
        <Checkbox isSelected={withMain} onChange={setWithMain}>
          {t('Criar um main.go de exemplo')}
        </Checkbox>
      </div>
    </Dialog>
  )
}
