// Commit parcial: quais trechos e, dentro de um trecho, quais linhas entram. Puro (testes unitários em node).
import type { Hunk } from '../editor/lineDiff'

// Trechos de um arquivo para o commit parcial: as duas versões e o que fica de fora.
export interface Chunks {
  left: string
  right: string
  hunks: Hunk[]
  off: Set<number> // índices dos trechos desmarcados por inteiro
  // Linhas desmarcadas dentro de um trecho: "o3" = a 4ª linha antiga (apagada) continua; "n0" = a 1ª nova não entra.
  lines: Record<number, Set<string>>
}

export type HunkState = 'on' | 'off' | 'mixed'

export const hunkLineCount = (c: Chunks, i: number) => c.hunks[i].old.length + c.hunks[i].count

export function hunkState(c: Chunks, i: number): HunkState {
  if (c.off.has(i)) return 'off'
  const n = c.lines[i]?.size ?? 0
  return n === 0 ? 'on' : n >= hunkLineCount(c, i) ? 'off' : 'mixed'
}

/** Arquivo inteiro: 'on' se tudo entra, 'off' se nada entra. */
export function fileState(c: Chunks): HunkState {
  const st = c.hunks.map((_, i) => hunkState(c, i))
  if (st.every((s) => s === 'on')) return 'on'
  if (st.every((s) => s === 'off')) return 'off'
  return 'mixed'
}

/** Liga/desliga um trecho inteiro (zera a escolha por linha dele). */
export function setHunk(c: Chunks, i: number, on: boolean): Chunks {
  const off = new Set(c.off)
  const lines = { ...c.lines }
  delete lines[i]
  if (on) off.delete(i)
  else off.add(i)
  return { ...c, off, lines }
}

/** Liga/desliga uma linha ("o<k>" ou "n<k>") de um trecho. */
export function setLine(c: Chunks, i: number, key: string, on: boolean): Chunks {
  const all = [...c.hunks[i].old.map((_, k) => 'o' + k), ...Array.from({ length: c.hunks[i].count }, (_, k) => 'n' + k)]
  // Trecho desligado por inteiro: abrir uma linha parte de "todas fora".
  const cur = new Set(c.off.has(i) ? all : (c.lines[i] ?? []))
  if (on) cur.delete(key)
  else cur.add(key)
  const off = new Set(c.off)
  off.delete(i)
  return { ...c, off, lines: { ...c.lines, [i]: cur } }
}

export const isPartial = (c: Chunks) => fileState(c) === 'mixed'

/**
 * O conteúdo a commitar: o arquivo do disco com o que ficou de fora desfeito (de baixo para cima).
 * Num trecho misto, ficam as linhas antigas cuja remoção foi desmarcada e, depois, as novas marcadas.
 */
export function partialContent(c: Chunks): string {
  const lines = c.right.split('\n')
  for (let i = c.hunks.length - 1; i >= 0; i--) {
    const st = hunkState(c, i)
    if (st === 'on') continue
    const h = c.hunks[i]
    const at = h.start - 1
    const now = lines.slice(at, at + h.count)
    if (st === 'off') {
      lines.splice(at, h.count, ...h.old)
      continue
    }
    const out = c.lines[i]
    const kept = h.old.filter((_, k) => out.has('o' + k))
    const added = now.filter((_, k) => !out.has('n' + k))
    lines.splice(at, h.count, ...kept, ...added)
  }
  return lines.join('\n')
}
