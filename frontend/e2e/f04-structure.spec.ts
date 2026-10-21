// Estrutura (Alt+7) e breadcrumbs: os símbolos do arquivo, ir até um, e o caminho do cursor na barra de status.
import { test, expect, openProject, openFile, cursorAt, a11y } from './helpers'
import type { Page } from '@playwright/test'

const tree = (page: Page) => page.getByRole('tree', { name: 'Estrutura do arquivo' })
const crumbs = (page: Page) => page.getByRole('navigation', { name: 'Localização do arquivo' })

test('F04-H5 Estrutura lista os símbolos; clicar leva ao código; breadcrumbs seguem o cursor', async ({ page, fx }) => {
  await openProject(page, fx.seed())
  await openFile(page, 'internal/cart/cart.go')
  await page.keyboard.press('Alt+7')
  await expect(tree(page).getByRole('treeitem', { name: /^Cart\b/ }).first()).toBeVisible({ timeout: 30_000 })
  const total = tree(page).getByRole('treeitem', { name: /Total/ }).first()
  await expect(total).toBeVisible()
  expect(await a11y(page)).toEqual([])

  await total.click()
  await expect.poll(() => page.evaluate(() => (window as any).__goideEditor.getPosition().lineNumber)).toBe(32)
  // Cursor dentro de Total: o símbolo aparece nos breadcrumbs e fica selecionado na Estrutura.
  await cursorAt(page, 'total += l.Product')
  await expect(crumbs(page)).toContainText(/Total/)
  await expect(tree(page).getByRole('treeitem', { selected: true })).toHaveAccessibleName(/Total/)
  await cursorAt(page, 'p, ok := catalog')
  await expect(crumbs(page)).toContainText(/Add/)
})
