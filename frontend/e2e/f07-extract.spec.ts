// Extrair variável e função: o gopls extrai e o rename inline abre no nome novo.
import { test, expect, openProject, openFile, editorValue, mod } from './helpers'
import type { Page } from '@playwright/test'

async function select(page: Page, text: string) {
  await page.evaluate((t) => {
    const ed = (window as any).__prumoEditor
    const m = ed.getModel()
    const off = m.getValue().indexOf(t)
    const a = m.getPositionAt(off)
    const b = m.getPositionAt(off + t.length)
    ed.setSelection({ startLineNumber: a.lineNumber, startColumn: a.column, endLineNumber: b.lineNumber, endColumn: b.column })
    ed.focus()
  }, text)
}

test('F07-H4 extrair variável e função com nome', async ({ page, fx }) => {
  await openProject(page, fx.seed())
  await openFile(page, 'internal/cart/cart.go')
  await select(page, 'l.Product.Price * l.Qty')
  await page.keyboard.press(`${mod}+Alt+V`)
  await expect(page.getByLabel(/^Renomear\. Digite o nome novo/)).toBeFocused({ timeout: 30_000 })
  await page.keyboard.press(`${mod}+a`)
  await page.keyboard.type('subtotal')
  await page.keyboard.press('Enter')
  await expect.poll(() => editorValue(page)).toContain('subtotal := l.Product.Price * l.Qty')
  expect(await editorValue(page)).toContain('total += subtotal')

  await select(page, 'p, ok := catalog.Find(sku)')
  await page.keyboard.press(`${mod}+Alt+M`)
  await expect(page.getByLabel(/^Renomear\. Digite o nome novo/)).toBeFocused({ timeout: 30_000 })
  await page.keyboard.press(`${mod}+a`)
  await page.keyboard.type('procura')
  await page.keyboard.press('Enter')
  await expect.poll(() => editorValue(page)).toMatch(/func procura\(/)
})
