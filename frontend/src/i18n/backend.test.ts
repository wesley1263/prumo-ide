// node --test: tradução das mensagens do backend.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setLang } from './index.ts'
import { translateBackend } from './backend.ts'

test('backend em inglês: fixas, com variáveis, embrulhadas e várias linhas', () => {
  setLang('en')
  assert.equal(translateBackend('informe uma pasta'), 'enter a folder')
  assert.equal(translateBackend('pasta não encontrada: /tmp/x y'), 'folder not found: /tmp/x y')
  assert.equal(translateBackend('a pasta /tmp/app já existe e não está vazia'), 'the folder /tmp/app already exists and is not empty')
  // Erro embrulhado (%w): o de dentro também é traduzido.
  assert.equal(translateBackend('a configuração foi salva, mas não o arquivo do projeto: caminho fora do projeto'), 'the configuration was saved, but not the project file: path outside the project')
  // Console: várias linhas, com quebras em volta.
  assert.equal(translateBackend('\nProcesso encerrado com código 3.\n'), '\nProcess finished with exit code 3.\n')
  // O que não está no dicionário (saída do git, em inglês) passa igual.
  assert.equal(translateBackend('fatal: not a git repository'), 'fatal: not a git repository')
  assert.equal(translateBackend('o cherry-pick parou em conflito'), 'the cherry-pick stopped with conflicts')
  setLang('pt-BR')
  assert.equal(translateBackend('informe uma pasta'), 'informe uma pasta')
})

// Mensagens internas que não chegam à tela de quem usa a IDE (protocolo, banco, testes do próprio código).
const INTERNAS = [
  /^(criar diretório do banco|ler versão do schema|migração)/,
  /^(URI não é file|Content-Length inválido|linha de (status|renome|conflito) inválida|a ponte só pode)/,
  /^(goide: troca de branch|Olá, mundo!|método ausente no binding)/,
  // Vem no fluxo do PTY, direto para o terminal (não passa pela API): fica em português. Ver build-log.
  /\[processo encerrado com código/,
]

test('toda mensagem do backend que vai para a tela tem tradução', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { backend } = await import('./en/backend.ts')
  const root = new URL('../../../internal', import.meta.url).pathname
  const go: string[] = []
  const walk = (d: string) => readdirSync(d).forEach((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith('.go') && !n.endsWith('_test.go') && go.push(join(d, n))))
  walk(root)
  const call = /(?:errors\.New\(|fmt\.Errorf\(|fmt\.Sprintf\(|Message:|\.Write\("(?:sys|err)",|p\["\w+"\]\s*=)\s*("(?:[^"\\\n]|\\.)*")/g
  const missing = new Set<string>()
  for (const f of go) {
    for (const m of readFileSync(f, 'utf8').matchAll(call)) {
      let s = JSON.parse(m[1].replace(/\\x1b/g, '\\u001b')) as string
      let n = 0
      s = s.replace(/%[-+# 0]*\d*(\.\d+)?[sdqvwxf]/g, () => `{${n++}}`).trim()
      if (!/[a-zà-ú]{3}/.test(s) || !/[ãçéáíóúõêâà]|\b(não|de|do|da|para|com|em|um|uma|ou|sem|já|é)\b/.test(s)) continue // sem texto em português
      if (INTERNAS.some((r) => r.test(s))) continue
      // Pedaço de mensagem concatenada no Go ("Branch movido para " + hash): vale a frase inteira com {0}.
      const piece = Object.keys(backend).some((k) => /\{\d+\}/.test(k) && k.startsWith(s))
      if (!piece && !Object.hasOwn(backend, s)) missing.add(`${f.split('/internal/')[1]}: ${s}`)
    }
  }
  assert.deepEqual([...missing], [], 'mensagens do Go sem tradução em src/i18n/en/backend.ts')
})
