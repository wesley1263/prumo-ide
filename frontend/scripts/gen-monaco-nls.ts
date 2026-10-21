// Gera src/i18n/monaco-pt-br.gen.ts a partir de src/i18n/monaco-pt.ts e do Monaco instalado.
// Rodar de novo depois de atualizar o monaco-editor (o teste i18n.test.ts avisa quando os índices mudam):
//   node scripts/gen-monaco-nls.ts
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { monacoPt } from '../src/i18n/monaco-pt.ts'
import { buildTable, monacoMessages } from './monacoNls.ts'

const esm = fileURLToPath(new URL('../node_modules/monaco-editor/esm/vs', import.meta.url))
const table = buildTable(monacoMessages(esm), monacoPt)
const used = table.filter(Boolean).length
const unused = Object.keys(monacoPt).filter((k) => ![...monacoMessages(esm).values()].includes(k))
writeFileSync(
  fileURLToPath(new URL('../src/i18n/monaco-pt-br.gen.ts', import.meta.url)),
  `// GERADO por scripts/gen-monaco-nls.ts: não editar à mão (edite monaco-pt.ts e rode o script).\nexport const monacoPtBr: Array<string | null> = ${JSON.stringify(table)}\n`,
)
console.log(`${used} entradas traduzidas de ${table.length}`)
if (unused.length) console.log('Textos do dicionário que o Monaco não usa:', unused)
