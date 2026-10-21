// Lugar reservado para telas que ainda não foram construídas. Diz qual é e quando entra.
import { EmptyState } from '../design/feedback'
import { ToolWindowFrame } from '../shell/ToolWindows'
import { screenById } from '../lib/screens'
import type { Side } from '../shell/layout'
import { t } from '../i18n'

export function StubPanel({ side, screen }: { side: Side; screen: string }) {
  const s = screenById(screen)
  return (
    <ToolWindowFrame side={side}>
      <EmptyState title={t('{name} ainda não foi construída', { name: s?.name ?? screen })}>
        {t('Esta janela ({screen}) entra num próximo marco. Veja replica/build-log.md.', { screen })}
      </EmptyState>
    </ToolWindowFrame>
  )
}
