// Diff de linhas para os marcadores de mudança. Sem dependências (testado com node --test).

export interface Hunk {
  kind: 'added' | 'modified' | 'deleted'
  start: number // primeira linha no texto atual (1-based); em "deleted", a linha logo depois do corte
  count: number // linhas no texto atual (0 em "deleted")
  old: string[] // linhas como estavam no commit
}

/**
 * Diff de linhas (Myers, O((N+M)·D)). Devolve os trechos que mudaram, já agrupados.
 * Arquivos muito diferentes (D grande) param no limite e não ganham marcadores.
 */
export function lineDiff(a: string[], b: string[], maxD = 4000): Hunk[] | null {
  const n = a.length
  const m = b.length
  const max = Math.min(n + m, maxD)
  const off = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  let found = false
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[off + k] = x
      if (x >= n && y >= m) {
        found = true
        break
      }
    }
  }
  if (!found) return null
  // Volta pelo rastro montando as operações (do fim para o começo).
  const ops: Array<'=' | '-' | '+'> = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d > 0; d--) {
    const vd = trace[d]
    const k = x - y
    const prevK = k === -d || (k !== d && vd[off + k - 1] < vd[off + k + 1]) ? k + 1 : k - 1
    const prevX = vd[off + prevK]
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      ops.push('=')
      x--
      y--
    }
    if (x === prevX) {
      ops.push('+')
      y--
    } else {
      ops.push('-')
      x--
    }
  }
  while (x > 0 && y > 0) {
    ops.push('=')
    x--
    y--
  }
  ops.reverse()
  // Agrupa sequências de - e + em trechos.
  const hunks: Hunk[] = []
  let ai = 0
  let bi = 0
  for (let i = 0; i < ops.length; ) {
    if (ops[i] === '=') {
      ai++
      bi++
      i++
      continue
    }
    const old: string[] = []
    let added = 0
    const start = bi + 1
    while (i < ops.length && ops[i] !== '=') {
      if (ops[i] === '-') old.push(a[ai++])
      else {
        added++
        bi++
      }
      i++
    }
    hunks.push({ kind: added === 0 ? 'deleted' : old.length === 0 ? 'added' : 'modified', start, count: added, old })
  }
  return hunks
}
