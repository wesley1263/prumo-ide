// F03 Atalhos de linha e de vários cursores no editor (keymap no estilo das IDEs desktop).
import { test, expect, openProject, openFile, editorValue, cursorAt, mod } from './helpers'

const src = 'package main\n\nvar a = 1\nvar b = 2\nvar c = 3\n'

test.describe('F03 linhas e vários cursores', () => {
  test('F03-H10 duplicar, apagar e mover a linha com o teclado', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(dir, 'lines.go', src)
    await openProject(page, dir, { trust: false })
    await openFile(page, 'lines.go')

    await cursorAt(page, 'var b')
    await page.keyboard.press(`${mod}+Shift+ArrowUp`)
    await expect.poll(() => editorValue(page)).toBe('package main\n\nvar b = 2\nvar a = 1\nvar c = 3\n')
    await page.keyboard.press(`${mod}+Shift+ArrowDown`)
    await page.keyboard.press(`${mod}+Shift+ArrowDown`)
    await expect.poll(() => editorValue(page)).toBe('package main\n\nvar a = 1\nvar c = 3\nvar b = 2\n')
    await page.keyboard.press('Shift+Alt+ArrowUp')
    await expect.poll(() => editorValue(page)).toBe(src)

    await page.keyboard.press(`${mod}+d`)
    await expect.poll(() => editorValue(page)).toBe('package main\n\nvar a = 1\nvar b = 2\nvar b = 2\nvar c = 3\n')
    await page.keyboard.press(`${mod}+y`)
    await expect.poll(() => editorValue(page)).toBe(src)
  })

  test('F03-H11 vários cursores: próxima ocorrência, todas e cursor na linha de baixo', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(dir, 'multi.go', 'package main\n\nvar total = 1\n\nfunc f() int { return total + total }\n')
    fx.write(dir, 'cols.go', 'package main\n\nvar x = 1\nvar y = 2\n')
    await openProject(page, dir, { trust: false })
    await openFile(page, 'multi.go')

    // Alt+J: a palavra do cursor e, a cada vez, a próxima ocorrência; Shift+Alt+J desfaz a última.
    await cursorAt(page, 'var total')
    await page.keyboard.press('Alt+j')
    await page.keyboard.press('Alt+j')
    await page.keyboard.press('Alt+j')
    await page.keyboard.press('Shift+Alt+j')
    await page.keyboard.type('sum')
    await expect.poll(() => editorValue(page)).toBe('package main\n\nvar sum = 1\n\nfunc f() int { return sum + total }\n')

    // Ctrl+Alt+Shift+J: todas de uma vez.
    await page.keyboard.press('Escape')
    await cursorAt(page, 'var sum')
    await page.keyboard.press(`${mod}+Alt+Shift+j`)
    await page.keyboard.type('n')
    await expect.poll(() => editorValue(page)).toBe('package main\n\nvar n = 1\n\nfunc f() int { return n + total }\n')

    // Ctrl+Alt+↓: um cursor a mais na linha de baixo.
    await page.keyboard.press('Escape')
    await openFile(page, 'cols.go')
    await cursorAt(page, 'var x', 'before')
    await page.keyboard.press(`${mod}+Alt+ArrowDown`)
    await page.keyboard.type('// ')
    await expect.poll(() => editorValue(page)).toBe('package main\n\n// var x = 1\n// var y = 2\n')
  })
})
