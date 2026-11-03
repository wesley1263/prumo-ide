// Diálogos globais: confiança no projeto, conflito ao salvar e em que janela abrir outro projeto.
import { useState } from 'react'
import { Button, Checkbox } from '../design/controls'
import { Dialog } from '../design/feedback'
import { useApp } from '../state/app'
import { useDocs } from '../editor/docs'
import { savePrefs } from '../state/settings'
import { t } from '../i18n'

export function TrustDialog() {
  const project = useApp((s) => s.project)
  const asked = useApp((s) => s.trustAsked)
  const answer = useApp((s) => s.answerTrust)
  if (!project) return null
  return (
    <Dialog
      title={t('Confiar neste projeto?')}
      isOpen={asked}
      onOpenChange={(o) => !o && answer(false)}
      size="md"
      footer={
        <>
          <Button onPress={() => answer(false)}>{t('Modo restrito')}</Button>
          <Button variant="primary" onPress={() => answer(true)} autoFocus>
            {t('Confiar')}
          </Button>
        </>
      }
    >
      <p className="mb-2">
        {t('Para analisar o código, rodar o programa e commitar com os hooks do repositório, a IDE precisa executar código desta pasta. Confie só em projetos que você conhece.')}
      </p>
      <p className="selectable mb-2 break-all rounded-sm bg-bg px-2 py-1 font-mono text-xs text-text-muted">{project.rootPath}</p>
      <p className="text-text-muted">{t('No modo restrito você continua lendo e editando os arquivos. Dá para confiar depois, pelo aviso no editor.')}</p>
    </Dialog>
  )
}

export function ConflictDialog() {
  const conflict = useDocs((s) => s.conflict)
  const resolve = useDocs((s) => s.resolveConflict)
  const doc = useDocs((s) => (s.conflict ? s.docs[s.conflict.key] : undefined))
  return (
    <Dialog
      title={t('O arquivo mudou no disco')}
      isOpen={!!conflict}
      onOpenChange={() => {}}
      dismissable={false}
      footer={
        <>
          <Button onPress={() => resolve(false)}>{t('Usar a versão do disco')}</Button>
          <Button variant="primary" onPress={() => resolve(true)}>
            {t('Manter a minha')}
          </Button>
        </>
      }
    >
      <p>
        <span className="font-mono">{doc?.key}</span> {t('foi alterado fora da IDE depois que você o abriu. Escolha qual versão fica.')}
      </p>
    </Dialog>
  )
}

/** Abrir outro projeto com um já aberto: nesta janela (fecha o atual) ou numa nova (o atual continua). */
export function OpenWhereDialog() {
  const req = useApp((s) => s.openWhere)
  const answer = useApp((s) => s.answerOpenWhere)
  const current = useApp((s) => s.project?.name ?? '')
  const home = useApp((s) => s.boot?.homeDir ?? '')
  const [remember, setRemember] = useState(false)
  const choose = (where: 'same' | 'new') => {
    if (remember) void savePrefs({ 'project.openIn': where })
    setRemember(false)
    void answer(where)
  }
  const target = req?.path ? req.path.replace(home, '~') : null
  return (
    <Dialog
      title={target ? t('Abrir {name}', { name: target.split('/').pop() ?? target }) : t('Abrir outro projeto')}
      isOpen={!!req}
      onOpenChange={(o) => !o && void answer(null)}
      size="md"
      footer={
        <>
          <Button onPress={() => void answer(null)}>{t('Cancelar')}</Button>
          <Button onPress={() => choose('same')}>{t('Esta janela')}</Button>
          <Button variant="primary" autoFocus onPress={() => choose('new')}>
            {t('Nova janela')}
          </Button>
        </>
      }
    >
      {target && <p className="selectable mb-2 break-all rounded-sm bg-bg px-2 py-1 font-mono text-xs text-text-muted">{target}</p>}
      <p className="mb-3">
        {t('Em uma nova janela, {current} continua aberto como está. Nesta janela, {current} é fechado (os arquivos são salvos antes).', { current })}
      </p>
      <Checkbox isSelected={remember} onChange={setRemember}>
        {t('Lembrar a escolha e não perguntar de novo')}
      </Checkbox>
      <p className="mt-1 text-xs text-text-muted">{t('Dá para mudar em Configurações → Aparência.')}</p>
    </Dialog>
  )
}
