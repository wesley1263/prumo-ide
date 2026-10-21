// node --test: o conteúdo do commit parcial por trecho e por linha.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lineDiff } from '../editor/lineDiff.ts'
import { fileState, hunkState, partialContent, setHunk, setLine, type Chunks } from './partial.ts'

const mk = (left: string, right: string): Chunks => ({ left, right, hunks: lineDiff(left.split('\n'), right.split('\n')) ?? [], off: new Set(), lines: {} })

test('trecho inteiro fora volta ao que estava', () => {
  const c = mk('a\nb\nc\nd', 'a\nB\nc\nd\ne')
  assert.equal(c.hunks.length, 2)
  assert.equal(partialContent(setHunk(c, 1, false)), 'a\nB\nc\nd')
  assert.equal(partialContent(setHunk(c, 0, false)), 'a\nb\nc\nd\ne')
  assert.equal(fileState(setHunk(setHunk(c, 0, false), 1, false)), 'off')
})

test('por linha: só uma das linhas adicionadas entra', () => {
  const c = mk('a\nz', 'a\nx1\nx2\nx3\nz')
  assert.equal(c.hunks.length, 1)
  const c2 = setLine(c, 0, 'n1', false)
  assert.equal(hunkState(c2, 0), 'mixed')
  assert.equal(fileState(c2), 'mixed')
  assert.equal(partialContent(c2), 'a\nx1\nx3\nz')
})

test('por linha: modificado mantém a antiga e escolhe a nova', () => {
  const c = mk('a\nvelho1\nvelho2\nz', 'a\nnovo1\nnovo2\nz')
  // A remoção do velho2 fica de fora (continua) e o novo2 não entra.
  let c2 = setLine(c, 0, 'o1', false)
  c2 = setLine(c2, 0, 'n1', false)
  assert.equal(partialContent(c2), 'a\nvelho2\nnovo1\nz')
  // Todas as linhas de fora = trecho desligado.
  let all = c
  for (const k of ['o0', 'o1', 'n0', 'n1']) all = setLine(all, 0, k, false)
  assert.equal(hunkState(all, 0), 'off')
  assert.equal(partialContent(all), 'a\nvelho1\nvelho2\nz')
})

test('linha a partir de um trecho desligado liga só ela', () => {
  const c = setLine(setHunk(mk('a', 'a\nb\nc'), 0, false), 0, 'n0', true)
  assert.equal(partialContent(c), 'a\nb')
})
