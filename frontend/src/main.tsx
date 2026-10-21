import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { lang, setDictionary } from './i18n'
import { en } from './i18n/en'

// Rejeições internas do Monaco sem efeito na tela: cancelamento (o texto mudou durante um pedido) e o worker
// do diff devolvendo vazio sob carga (o diff é recalculado na próxima mudança). O VS Code ignora as mesmas.
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason as { name?: string; message?: string } | undefined
  if (r && (r.name === 'Canceled' || r.message === 'Canceled' || r.message === 'no diff result available')) e.preventDefault()
})

// O idioma vale antes de o Monaco carregar: as traduções dele (pt-BR) entram num global que ele lê ao iniciar.
document.documentElement.lang = lang
setDictionary(en)
async function start() {
  if (lang === 'pt-BR') {
    // O pacote pt-BR do próprio Monaco vem vazio: a tabela é nossa (src/i18n/monaco-pt.ts → monaco-pt-br.gen.ts).
    const { monacoPtBr } = await import('./i18n/monaco-pt-br.gen')
    const g = globalThis as { _VSCODE_NLS_MESSAGES?: Array<string | null>; _VSCODE_NLS_LANGUAGE?: string }
    g._VSCODE_NLS_MESSAGES = monacoPtBr
    g._VSCODE_NLS_LANGUAGE = 'pt-br'
  }
  const { default: App } = await import('./App')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
void start()
