// Diálogos globais: confiança no projeto e conflito ao salvar.
import { Button } from '../design/controls'
import { Dialog } from '../design/feedback'
import { useApp } from '../state/app'
import { useDocs } from '../editor/docs'
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
