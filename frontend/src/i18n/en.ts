// Traduções para o inglês. A chave é a frase em português exatamente como aparece no código (t('…')).
// Dividido por área para cada parte ter seu arquivo; o teste i18n.test.ts falha se uma frase usada com t()
// não estiver em nenhum.
import { shell } from './en/shell.ts'
import { common } from './en/common.ts'
import { editor } from './en/editor.ts'
import { panels } from './en/panels.ts'
import { tools } from './en/tools.ts'
import { backend } from './en/backend.ts'

export const en: Record<string, string> = {
  Idioma: 'Language',
  'Seguir o sistema': 'Follow the system',
  'A janela recarrega para trocar o idioma (os arquivos abertos são salvos antes).': 'The window reloads to switch the language (open files are saved first).',
  ...shell,
  ...common,
  ...editor,
  ...panels,
  ...tools,
  ...backend,
}
