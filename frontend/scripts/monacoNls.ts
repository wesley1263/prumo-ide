// Monta a tabela de traduções que o Monaco lê (globalThis._VSCODE_NLS_MESSAGES): o build dele chama
// localize(índice, "texto em inglês"), então a tabela é por índice. Usado pelo script de geração e pelo teste.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const call = /localize2?\((\d+),\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g

const ESC: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' }

/** Desfaz os escapes de uma string JS (\n, \', \", \\, \uXXXX). */
function unescapeJs(s: string): string {
  return s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, e: string) => {
    if (e[0] === 'u' && e.length > 1) return String.fromCodePoint(parseInt(e.replace(/[u{}]/g, ''), 16))
    if (e[0] === 'x' && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16))
    return ESC[e] ?? e
  })
}

/** índice → texto em inglês, de todos os módulos do build ESM do Monaco. */
export function monacoMessages(esmRoot: string): Map<number, string> {
  const out = new Map<number, string>()
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) walk(p)
      else if (n.endsWith('.js')) {
        for (const m of readFileSync(p, 'utf8').matchAll(call)) {
          out.set(Number(m[1]), unescapeJs(m[2].slice(1, -1)))
        }
      }
    }
  }
  walk(esmRoot)
  return out
}

/** A tabela: tradução onde o dicionário tem o texto, null no resto (o Monaco usa o inglês). */
export function buildTable(messages: Map<number, string>, dict: Record<string, string>): Array<string | null> {
  const max = Math.max(...messages.keys())
  const table: Array<string | null> = Array.from({ length: max + 1 }, () => null)
  for (const [i, en] of messages) if (Object.hasOwn(dict, en)) table[i] = dict[en]
  return table
}
