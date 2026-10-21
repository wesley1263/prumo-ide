import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapseCR, parseAnsi } from './ansi.ts'

test('collapseCR: barra de progresso fica só com o último estado', () => {
  assert.equal(collapseCR('baixando 10%\rbaixando 50%\rbaixando 100%\nfim\n'), 'baixando 100%\nfim\n')
  assert.equal(collapseCR('linha\r\noutra\r\n'), 'linha\noutra\n')
  assert.equal(collapseCR('abcdef\rXY'), 'XYcdef')
  // "\r" no fim espera o próximo pedaço (pode ser o "\r\n" partido em dois).
  assert.equal(collapseCR('linha\r'), 'linha\r')
  assert.equal(collapseCR('linha\r' + '\n'), 'linha\n')
})

test('parseAnsi: cores, negrito, reset e 256/truecolor', () => {
  const segs = parseAnsi('\x1b[31merro\x1b[0m ok \x1b[1;92mverde\x1b[22m fino\x1b[38;5;196mx\x1b[38;2;1;2;3my')
  assert.deepEqual(
    segs.map((s) => s.text),
    ['erro', ' ok ', 'verde', ' fino', 'x', 'y'],
  )
  assert.equal(segs[0].style.fg, 'var(--color-ansi-red)')
  assert.deepEqual(segs[1].style, {})
  assert.equal(segs[2].style.bold, true)
  assert.equal(segs[2].style.fg, 'var(--color-ansi-bright-green)')
  assert.equal(segs[3].style.bold, undefined)
  assert.equal(segs[4].style.fg, 'rgb(255, 0, 0)')
  assert.equal(segs[5].style.fg, 'rgb(1, 2, 3)')
})

test('parseAnsi: descarta códigos de cursor e títulos', () => {
  assert.deepEqual(
    parseAnsi('\x1b[2K\x1b[1Gpronto\x1b]0;título\x07!').map((s) => s.text),
    ['pronto!'],
  )
})
