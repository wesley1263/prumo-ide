// Salvamento automático, como nas IDEs desktop: o usuário nunca perde texto por ter esquecido o Ctrl+S.
// Grava (sem formatar) quando o editor perde o foco, quando a janela perde o foco, depois de 2s sem
// digitar, antes de rodar/commitar, e ao fechar/recarregar. Formatar fica só para o Ctrl+S explícito,
// para não mexer no código debaixo do cursor.
import { useDocs } from './docs'
import { monaco } from './monaco'
import { api, writeOnUnload } from '../lib/api'
import { on } from '../lib/events'

const IDLE_MS = 2000

export function installAutosave(): () => void {
  const save = () => void useDocs.getState().autosave()
  let idle: ReturnType<typeof setTimeout> | undefined

  const onVisibility = () => document.visibilityState === 'hidden' && save()
  window.addEventListener('blur', save)
  document.addEventListener('visibilitychange', onVisibility)

  // Ociosidade: qualquer mudança em modelo de arquivo reinicia o relógio.
  const subs = [monaco.editor.onDidCreateModel((m) => m.uri.scheme === 'file' && subs.push(m.onDidChangeContent(restart)))]
  for (const m of monaco.editor.getModels()) if (m.uri.scheme === 'file') subs.push(m.onDidChangeContent(restart))
  function restart() {
    clearTimeout(idle)
    idle = setTimeout(save, IDLE_MS)
  }

  // Recarregar/fechar a aba (modo dev): não dá para esperar promessa; manda com keepalive.
  const onUnload = () => {
    const { docs, projectId } = useDocs.getState()
    if (!projectId) return
    for (const d of Object.values(docs)) {
      if (!d.dirty || d.readOnly || d.key.startsWith('ext:')) continue
      const model = monaco.editor.getModel(monaco.Uri.parse(d.uri))
      if (model) writeOnUnload(projectId, d.key, model.getValue(), d.mtime)
    }
  }
  window.addEventListener('pagehide', onUnload)

  // App nativo: o backend avisa quem decide fechar; ele segura a janela enquanto houver algo sujo.
  let lastDirty = false
  const offDirty = useDocs.subscribe((s) => {
    const dirty = s.anyDirty()
    if (dirty !== lastDirty) {
      lastDirty = dirty
      api.App.SetDirty(dirty).catch(() => {})
    }
  })
  const offClose = on('app:before-close', async () => {
    await useDocs.getState().autosave()
    if (!useDocs.getState().anyDirty()) await api.App.Quit()
  })

  return () => {
    clearTimeout(idle)
    window.removeEventListener('blur', save)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', onUnload)
    subs.forEach((s) => s.dispose())
    offDirty()
    offClose()
  }
}
