// Mensagens do backend (Go) traduzidas na borda: o Go fala português e a interface traduz o que chega
// (erros, mensagens de OpResult, validações, linhas de sistema do console). O dicionário fica em en/backend.ts,
// com os pedaços variáveis como {0}, {1}… ("pasta não encontrada: {0}"). O que não estiver no dicionário
// (saída do git, do gopls, do Delve, já em inglês) passa como veio.
import { lang } from './index.ts'
import { backend } from './en/backend.ts'

interface Pattern {
  re: RegExp
  en: string
}

let patterns: Pattern[] | null = null

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function compile(): Pattern[] {
  const out: Pattern[] = []
  for (const [pt, en] of Object.entries(backend)) {
    if (!/\{\d+\}/.test(pt)) continue
    // Cada {N} casa o menor pedaço possível, menos o último, que vai até o fim.
    const parts = pt.split(/(\{\d+\})/)
    let src = '^'
    parts.forEach((p, i) => {
      if (/^\{\d+\}$/.test(p)) src += i === parts.length - 2 && parts[parts.length - 1] === '' ? '([\\s\\S]+)' : '([\\s\\S]+?)'
      else src += escape(p)
    })
    out.push({ re: new RegExp(src + '$'), en })
  }
  // Os mais específicos (mais texto fixo) primeiro: "a pasta {0} já existe" antes de "{0}: {1}".
  return out.sort((a, b) => b.re.source.replace(/\(\[\\s\\S\]\+\??\)/g, '').length - a.re.source.replace(/\(\[\\s\\S\]\+\??\)/g, '').length)
}

/** Traduz uma mensagem do backend (uma linha ou o texto inteiro). Em português, devolve como veio. */
export function translateBackend(msg: string, depth = 0): string {
  if (lang !== 'en' || !msg) return msg
  if (Object.hasOwn(backend, msg)) return backend[msg]
  // Linhas com quebra: traduz cada uma (o console junta várias mensagens).
  if (msg.includes('\n') && depth === 0) return msg.split('\n').map((l) => translateBackend(l, 1)).join('\n')
  const trimmed = msg.trim()
  if (trimmed !== msg) {
    const i = msg.indexOf(trimmed)
    return msg.slice(0, i) + translateBackend(trimmed, depth + 1) + msg.slice(i + trimmed.length)
  }
  patterns ??= compile()
  for (const p of patterns) {
    const m = p.re.exec(msg)
    if (!m) continue
    // Os pedaços variáveis podem ser outras mensagens do backend (erro embrulhado com %w): traduz também.
    return p.en.replace(/\{(\d+)\}/g, (_, n: string) => {
      const v = m[Number(n) + 1] ?? ''
      return depth < 3 ? translateBackend(v, depth + 1) : v
    })
  }
  return msg
}
