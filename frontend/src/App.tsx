import { useEffect, useState } from 'react'
import { useApp } from './state/app'
import { Welcome } from './welcome/Welcome'
import { AppShell } from './shell/AppShell'
import { SettingsDialog } from './settings/SettingsDialog'
import { TrustDialog, ConflictDialog } from './shell/Dialogs'
import { DesignPage } from './design/DesignPage'
import { EmptyState, ToastViewport } from './design/feedback'
import { Button } from './design/controls'
import { t } from './i18n'
import { hideSplash } from './splash'

function useHash() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

export default function App() {
  const boot = useApp((s) => s.boot)
  const bootError = useApp((s) => s.bootError)
  const project = useApp((s) => s.project)
  const hash = useHash()

  useEffect(() => {
    useApp.getState().init()
  }, [])
  // A tela de abertura (index.html) cobre a espera do backend; sai quando ele respondeu, ou com o erro.
  useEffect(() => {
    if (boot || bootError) hideSplash()
  }, [boot, bootError])

  let screen
  if (hash === '#design') screen = <DesignPage />
  else if (bootError)
    screen = (
      <div className="h-full bg-surface">
        <EmptyState title={t('Não foi possível falar com o backend')} actions={<Button onPress={() => useApp.getState().init()}>{t('Tentar de novo')}</Button>}>
          {bootError}
        </EmptyState>
      </div>
    )
  else if (!boot) screen = <div className="h-full bg-bg" aria-hidden /> // a tela de abertura cobre
  else if (!project) screen = <Welcome />
  else screen = <AppShell key={project.id} />

  return (
    <>
      {screen}
      <TrustDialog />
      <ConflictDialog />
      <SettingsDialog />
      <ToastViewport />
    </>
  )
}
