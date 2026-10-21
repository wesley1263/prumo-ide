// node --test src/editor/lineDiff.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lineDiff, type Hunk } from './lineDiff.ts'

/** Reverte os trechos (de baixo para cima) sobre o texto novo: tem que dar o antigo. */
function revertAll(b: string[], hunks: Hunk[]): string[] {
  const out = [...b]
  for (const h of [...hunks].reverse()) out.splice(h.start - 1, h.count, ...h.old)
  return out
}

test('casos simples', () => {
  assert.deepEqual(lineDiff(['a', 'b'], ['a', 'b']), [])
  assert.deepEqual(lineDiff(['a', 'b'], ['a', 'x', 'b']), [{ kind: 'added', start: 2, count: 1, old: [] }])
  assert.deepEqual(lineDiff(['a', 'b', 'c'], ['a', 'c']), [{ kind: 'deleted', start: 2, count: 0, old: ['b'] }])
  assert.deepEqual(lineDiff(['a', 'b', 'c'], ['a', 'B', 'c']), [{ kind: 'modified', start: 2, count: 1, old: ['b'] }])
  assert.deepEqual(lineDiff([], ['x']), [{ kind: 'added', start: 1, count: 1, old: [] }])
  assert.deepEqual(lineDiff(['x'], []), [{ kind: 'deleted', start: 1, count: 0, old: ['x'] }])
})

test('propriedade: reverter todos os trechos reconstrói o original (5000 pares aleatórios)', () => {
  let seed = 42
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n)
  const words = ['a', 'b', 'c', 'd', 'e', '', '}']
  for (let i = 0; i < 5000; i++) {
    const a = Array.from({ length: rnd(25) }, () => words[rnd(words.length)])
    const b = [...a]
    for (let e = rnd(6); e > 0; e--) {
      const op = rnd(3)
      const at = rnd(b.length + 1)
      if (op === 0) b.splice(at, 0, words[rnd(words.length)])
      else if (op === 1 && b.length) b.splice(at % b.length, 1)
      else if (b.length) b[at % b.length] = words[rnd(words.length)] + '!'
    }
    const hunks = lineDiff(a, b)
    assert.ok(hunks, 'não deveria desistir em arquivos pequenos')
    assert.deepEqual(revertAll(b, hunks!), a, `a=${JSON.stringify(a)} b=${JSON.stringify(b)}`)
    for (const h of hunks!) if (h.kind !== 'deleted') assert.ok(h.start >= 1 && h.start + h.count - 1 <= b.length)
  }
})

test('arquivo grande e pouca mudança é rápido', () => {
  const a = Array.from({ length: 20000 }, (_, i) => `linha ${i}`)
  const b = [...a]
  b.splice(10000, 1, 'mudou')
  const t = Date.now()
  assert.deepEqual(lineDiff(a, b), [{ kind: 'modified', start: 10001, count: 1, old: ['linha 10000'] }])
  assert.ok(Date.now() - t < 200)
})
