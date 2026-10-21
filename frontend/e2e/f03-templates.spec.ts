// Live templates no começo da linha (fori, iferr…) e postfix do gopls depois do ponto (x.print).
import { test, expect, openProject, openFile, cursorAt, editorValue } from './helpers'

test('F03-H11 live template e postfix', async ({ page, fx }) => {
  await openProject(page, fx.seed())
  await openFile(page, 'internal/cart/cart.go')
  await cursorAt(page, 'total := 0')
  await page.keyboard.press('Enter')
  await page.keyboard.type('fori')
  const suggest = page.locator('.monaco-editor .suggest-widget')
  await expect(suggest.getByText('fori', { exact: true })).toBeVisible({ timeout: 15_000 })
  await page.keyboard.press('Enter')
  // Campos: i (já selecionado), Tab vai para n.
  await page.keyboard.press('Tab')
  await page.keyboard.type('3')
  await expect.poll(() => editorValue(page)).toMatch(/for i := 0; i < 3; i\+\+ \{/)

  // Postfix do gopls: "total.print" vira um fmt.Printf de total.
  await page.keyboard.press('Escape')
  await cursorAt(page, 'return total', 'before')
  await page.keyboard.type('total.print')
  await expect(suggest.getByText(/^print/).first()).toBeVisible({ timeout: 15_000 })
  await page.keyboard.press('Enter')
  await expect.poll(() => editorValue(page)).toMatch(/fmt\.Printf\("total: %v\\n", total\)/)
})
