// Safe delete recusado: o símbolo ainda é usado. Mostra onde e leva para a janela Usos.
import { useSafeDelete } from './refactor'
import { currentEditor } from './EditorArea'
import { showUsages } from '../panels/UsagesPanel'
import { Dialog } from '../design/feedback'
import { Button } from '../design/controls'
import { t, tn } from '../i18n'

export function SafeDeleteDialog() {
  const blocked = useSafeDelete((s) => s.blocked)
  const close = () => useSafeDelete.setState({ blocked: null })
  const rel = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, '')).replace((blocked?.root ?? '') + '/', '')
  const shown = blocked?.usages.slice(0, 8) ?? []
  return (
    <Dialog
      title={blocked ? t('{name} ainda é usado', { name: blocked.name }) : 'Safe delete'}
      isOpen={!!blocked}
      onOpenChange={(o) => !o && close()}
      footer={
        <>
          <Button onPress={close}>{t('Cancelar')}</Button>
          <Button
            variant="primary"
            onPress={() => {
              close()
              const ed = currentEditor()
              if (ed) void showUsages(ed)
            }}
          >
            {t('Ver os usos')}
          </Button>
        </>
      }
    >
      <p className="mb-2 text-sm text-text">
        {tn(blocked?.usages.length ?? 0, 'Nada foi apagado: há {n} uso fora da declaração. Tire os usos e tente de novo.', 'Nada foi apagado: há {n} usos fora da declaração. Tire os usos e tente de novo.')}
      </p>
      <ul aria-label={t('Usos')} className="flex flex-col gap-0.5 font-mono text-xs text-text-muted">
        {shown.map((u, i) => (
          <li key={i}>
            {rel(u.uri)}:{u.range.start.line + 1}
          </li>
        ))}
        {blocked && blocked.usages.length > shown.length && <li>{t('… e mais {n}', { n: blocked.usages.length - shown.length })}</li>}
      </ul>
    </Dialog>
  )
}
