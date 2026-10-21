// Idioma da interface: português do Brasil ou inglês. As frases em português são a própria chave (estilo
// gettext): t('Abrir pasta') devolve a frase em português ou a tradução de en.ts. Trocar de idioma recarrega a
// janela, porque o Monaco só lê as traduções dele ao carregar. O dicionário (en.ts) é instalado pelo main.tsx
// antes de o App carregar, com setDictionary; assim este módulo roda também nos testes do node.

export type Lang = 'pt-BR' | 'en'
export type LangPref = 'system' | Lang

const STORE = 'goide.language'

/** "system" segue o sistema: português → pt-BR, qualquer outro → inglês. */
export function resolveLang(pref: LangPref, nav = typeof navigator !== 'undefined' ? navigator.language : 'pt-BR'): Lang {
  if (pref === 'pt-BR' || pref === 'en') return pref
  return nav.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en'
}

/** A preferência guardada no navegador (o backend guarda a mesma; esta existe para valer antes do bootstrap). */
export function storedPref(): LangPref {
  try {
    const v = localStorage.getItem(STORE)
    if (v === 'pt-BR' || v === 'en' || v === 'system') return v
  } catch {
    // sem localStorage: segue o sistema
  }
  return 'system'
}

export function storePref(p: LangPref) {
  try {
    localStorage.setItem(STORE, p)
  } catch {
    // sem localStorage: vale até recarregar
  }
}

export let lang: Lang = resolveLang(storedPref())
let en: Record<string, string> = {}

export function setDictionary(d: Record<string, string>) {
  en = d
}

/** Só para testes unitários. */
export function setLang(l: Lang) {
  lang = l
}

type Vars = Record<string, string | number>

/** Traduz a frase (chave em português). {nome} vira vars.nome. Sem tradução, fica o português.
 * ctx separa a mesma frase em contextos diferentes ("Locais" das branches × "Locais" recentes): no dicionário,
 * a chave é "frase@ctx". */
export function t(pt: string, vars?: Vars, ctx?: string): string {
  const key = ctx ? `${pt}@${ctx}` : pt
  const s = lang === 'en' && Object.hasOwn(en, key) ? en[key] : pt
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s
}

/** Plural simples: t1 para 1, tn para o resto (as duas com {n}). */
export const tn = (n: number, one: string, many: string, vars?: Vars) => t(n === 1 ? one : many, { n, ...vars })
