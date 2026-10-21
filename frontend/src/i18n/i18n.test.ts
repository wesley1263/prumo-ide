// node --test: toda frase usada com t()/tn() no código tem tradução em en.ts, e o t() troca as variáveis.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { en } from './en.ts'
import { resolveLang, setDictionary, setLang, t, tn } from './index.ts'

setDictionary(en)

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return files(p)
    return /\.(ts|tsx)$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : []
  })
}

// Literais em t('…'), t("…"), tn(n, '…', '…'). Template literals com ${} não valem como chave (o teste acusa).
const call = /\b(t|tn)\(\s*(?:[^,()'"`]+,\s*)?(['"`])((?:\\.|(?!\2).)*)\2(?:\s*,\s*(['"`])((?:\\.|(?!\4).)*)\4)?/g

test('toda frase com t() tem tradução em inglês', () => {
  const missing = new Set<string>()
  const dynamic: string[] = []
  for (const f of files(new URL('..', import.meta.url).pathname)) {
    if (f.includes('/i18n/')) continue
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(call)) {
      for (const [q, s] of [[m[2], m[3]], [m[4], m[5]]]) {
        if (s === undefined) continue
        if (q === '`' && s.includes('${')) dynamic.push(`${f}: ${s}`)
        const key = s.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, '\n')
        if (!Object.hasOwn(en, key)) missing.add(`${f.split('/src/')[1]}: ${key}`)
      }
    }
  }
  assert.deepEqual(dynamic, [], 'use {variáveis} em vez de ${} dentro de t()')
  assert.deepEqual([...missing], [], 'frases sem tradução em src/i18n/en.ts')
})

test('t() troca variáveis e cai no português sem tradução', () => {
  setLang('en')
  assert.equal(t('Idioma'), 'Language')
  assert.equal(t('Frase que não existe {x}', { x: 1 }), 'Frase que não existe 1')
  setLang('pt-BR')
  assert.equal(t('Idioma'), 'Idioma')
  assert.equal(tn(1, '{n} arquivo', '{n} arquivos'), '1 arquivo')
  assert.equal(tn(3, '{n} arquivo', '{n} arquivos'), '3 arquivos')
})

test('resolveLang segue o sistema', () => {
  assert.equal(resolveLang('system', 'pt-BR'), 'pt-BR')
  assert.equal(resolveLang('system', 'pt-PT'), 'pt-BR')
  assert.equal(resolveLang('system', 'en-US'), 'en')
  assert.equal(resolveLang('system', 'de-DE'), 'en')
  assert.equal(resolveLang('en', 'pt-BR'), 'en')
})

test('a tabela do Monaco em pt-BR bate com o Monaco instalado (senão: node scripts/gen-monaco-nls.ts)', async () => {
  const { monacoMessages, buildTable } = await import('../../scripts/monacoNls.ts')
  const { monacoPt } = await import('./monaco-pt.ts')
  const { monacoPtBr } = await import('./monaco-pt-br.gen.ts')
  const esm = new URL('../../node_modules/monaco-editor/esm/vs', import.meta.url).pathname
  const fresh = buildTable(monacoMessages(esm), monacoPt)
  assert.equal(monacoPtBr.length, fresh.length, 'o Monaco mudou de versão: regenere a tabela')
  assert.deepEqual(monacoPtBr, fresh, 'a tabela está desatualizada: regenere com node scripts/gen-monaco-nls.ts')
  // Os textos do menu do botão direito estão lá.
  for (const k of ['Go to Definition', 'Cut', 'Copy', 'Paste', 'Rename Symbol', 'Format Document', 'Command Palette']) assert.ok(fresh.includes(monacoPt[k]), k)
})
