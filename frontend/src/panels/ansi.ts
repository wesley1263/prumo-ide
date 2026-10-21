// Saída de programas no console: cores ANSI (SGR) e "\r" (barra de progresso reescrevendo a linha).
// Puro, sem React: o Console usa e os testes unitários exercitam direto.

const NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']

export interface Style {
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  inverse?: boolean
}
export interface Segment {
  text: string
  style: Style
}

/**
 * Aplica os "\r" soltos: o que vem depois volta ao começo da linha e sobrescreve.
 * "\r\n" vira "\n" (é o que o PTY manda). Um "\r" no fim fica, porque o "\n" pode vir no próximo pedaço.
 */
export function collapseCR(s: string): string {
  if (!s.includes('\r')) return s
  s = s.replace(/\r\n/g, '\n')
  const tail = s.endsWith('\r')
  if (tail) s = s.slice(0, -1)
  const out = s.split('\n').map((line) => {
    if (!line.includes('\r')) return line
    let cur = ''
    for (const part of line.split('\r')) cur = part + cur.slice(visibleLen(part))
    return cur
  })
  return out.join('\n') + (tail ? '\r' : '')
}

// Comprimento sem os códigos de escape (para sobrescrever só o que foi reescrito).
const visibleLen = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').length

const color256 = (n: number): string | undefined => {
  if (n < 8) return `var(--color-ansi-${NAMES[n]})`
  if (n < 16) return `var(--color-ansi-bright-${NAMES[n - 8]})`
  if (n < 232) {
    const v = [0, 95, 135, 175, 215, 255]
    const i = n - 16
    return `rgb(${v[Math.floor(i / 36)]}, ${v[Math.floor(i / 6) % 6]}, ${v[i % 6]})`
  }
  if (n < 256) {
    const g = 8 + (n - 232) * 10
    return `rgb(${g}, ${g}, ${g})`
  }
  return undefined
}

/** Quebra o texto em pedaços com estilo. Códigos que não são SGR (cursor, limpar tela) são descartados. */
export function parseAnsi(s: string): Segment[] {
  const out: Segment[] = []
  let style: Style = {}
  let last = 0
  const re = /\x1b\[([0-9;?]*)([A-Za-z])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
  const push = (text: string) => {
    if (!text) return
    const prev = out[out.length - 1]
    if (prev && prev.style === style) prev.text += text
    else out.push({ text, style })
  }
  for (const m of s.matchAll(re)) {
    push(s.slice(last, m.index))
    last = m.index! + m[0].length
    if (m[2] !== 'm') continue
    const codes = (m[1] || '0').split(';').map((x) => Number(x || 0))
    const next: Style = { ...style }
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]
      if (c === 0) Object.keys(next).forEach((k) => delete next[k as keyof Style])
      else if (c === 1) next.bold = true
      else if (c === 2) next.dim = true
      else if (c === 3) next.italic = true
      else if (c === 4) next.underline = true
      else if (c === 7) next.inverse = true
      else if (c === 22) next.bold = next.dim = undefined
      else if (c === 23) next.italic = undefined
      else if (c === 24) next.underline = undefined
      else if (c === 27) next.inverse = undefined
      else if (c >= 30 && c <= 37) next.fg = `var(--color-ansi-${NAMES[c - 30]})`
      else if (c >= 90 && c <= 97) next.fg = `var(--color-ansi-bright-${NAMES[c - 90]})`
      else if (c === 39) next.fg = undefined
      else if (c >= 40 && c <= 47) next.bg = `var(--color-ansi-${NAMES[c - 40]})`
      else if (c >= 100 && c <= 107) next.bg = `var(--color-ansi-bright-${NAMES[c - 100]})`
      else if (c === 49) next.bg = undefined
      else if ((c === 38 || c === 48) && codes[i + 1] === 5) {
        const v = color256(codes[i + 2])
        if (c === 38) next.fg = v
        else next.bg = v
        i += 2
      } else if ((c === 38 || c === 48) && codes[i + 1] === 2) {
        const v = `rgb(${codes[i + 2] ?? 0}, ${codes[i + 3] ?? 0}, ${codes[i + 4] ?? 0})`
        if (c === 38) next.fg = v
        else next.bg = v
        i += 4
      }
    }
    style = next
  }
  push(s.slice(last).replace(/\r$/, ''))
  return out
}

export const hasAnsi = (s: string) => s.includes('\x1b')
