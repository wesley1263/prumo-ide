// Gerar código (Alt+Insert): construtor num struct e teste em tabela para uma função (cria o _test.go).
import { test, expect, openProject, openFile, cursorAt, editorValue, a11y } from './helpers'
import type { Page } from '@playwright/test'

const menu = (page: Page) => page.getByRole('menu', { name: 'Gerar' })

test('F07-H3 Alt+Insert: construtor e teste', async ({ page, fx }) => {
  const dir = fx.seed()
  await openProject(page, dir)
  await openFile(page, 'internal/catalog/catalog.go')
  await cursorAt(page, 'SKU   string')
  await page.keyboard.press('Alt+Insert')
  await expect(menu(page)).toBeVisible({ timeout: 30_000 })
  expect(await a11y(page)).toEqual([])
  await menu(page).getByRole('menuitem', { name: 'Construtor NewProduct' }).click()
  await expect.poll(() => editorValue(page)).toContain('func NewProduct(sku string, name string, price int) *Product {')
  expect(await editorValue(page)).toContain('return &Product{SKU: sku, Name: name, Price: price}')

  // Teste: o cursor numa função; o _test.go não existe ainda.
  await cursorAt(page, 'func Find(')
  await page.keyboard.press('Alt+Insert')
  await expect(menu(page).getByRole('menuitem', { name: 'Construtor (cursor num struct)' })).toHaveAttribute('aria-disabled', 'true')
  await menu(page).getByRole('menuitem', { name: 'Teste para Find' }).click()
  await expect(page.getByRole('tab', { name: 'catalog_test.go', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => editorValue(page)).toContain('func TestFind(t *testing.T) {')
  expect(fx.read(dir, 'internal/catalog/catalog_test.go')).toContain('package catalog')
})

test('F07-H6 Alt+Insert: implementar fmt.Stringer num struct', async ({ page, fx }) => {
  const dir = fx.seed()
  await openProject(page, dir)
  await openFile(page, 'internal/catalog/catalog.go')
  await cursorAt(page, 'SKU   string')
  await page.keyboard.press('Alt+Insert')
  await menu(page).getByRole('menuitem', { name: 'Implementar interface em Product…' }).click()
  const dlg = page.getByRole('dialog', { name: 'Implementar interface em Product' })
  await expect(dlg).toBeVisible()
  await dlg.getByRole('list', { name: 'Sugestões de interface' }).getByRole('button', { name: 'fmt.Stringer' }).click()
  await expect(dlg.getByRole('textbox', { name: 'Interface' })).toHaveValue('fmt.Stringer')
  expect(await a11y(page)).toEqual([])
  await dlg.getByRole('button', { name: 'Implementar' }).click()
  await expect(dlg).toBeHidden({ timeout: 20_000 })
  await expect.poll(() => editorValue(page), { timeout: 30_000 }).toMatch(/func \(\w+ \*Product\) String\(\) string \{/)
  const v = await editorValue(page)
  expect(v).toContain('var _ fmt.Stringer = (*Product)(nil)')
  expect(v).toMatch(/import\s*\(?[^)]*"fmt"/)
})
