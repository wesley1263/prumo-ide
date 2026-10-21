// Gera src/editor/monaco-core.ts: o editor.main do Monaco sem os serviços de TS/CSS/HTML/JSON
// (que exigem workers próprios) e sem o cliente LSP embutido — a IDE usa o adaptador dela.
// Rode de novo ao atualizar o monaco-editor:  node scripts/gen-monaco-entry.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const main = readFileSync('node_modules/monaco-editor/esm/vs/editor/editor.main.js', 'utf8')
const lines = main.split('\n').filter((l) => /^import '(\.\/|\.\.\/(features|base|languages\/definitions)\/)/.test(l))
const rewritten = lines.map((l) =>
  l.replace(/import '(\.\.?\/[^']+)'/, (_, p) => `import '${new URL(p, 'file:///vs/editor/').pathname.replace(/^\//, 'monaco-esm/')}'`),
)
const out = [
  '// Gerado por scripts/gen-monaco-entry.mjs. Não edite.',
  ...rewritten,
  "export * from 'monaco-esm/vs/editor/editor.api.js'",
  '',
].join('\n')
writeFileSync('src/editor/monaco-core.ts', out)
console.log(`monaco-core.ts: ${rewritten.length} imports`)
