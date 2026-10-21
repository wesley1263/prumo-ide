// S18 cobertura: rodar os testes com cobertura pelo ▶, % por pacote e arquivo, faixas no gutter.
import { test, expect, openProject, openFile, a11y } from './helpers'

test('S18-H1 rodar com cobertura: % no painel, faixas verde/vermelha no editor, esconder', async ({ page, fx }) => {
  await openProject(page, fx.seed())
  await openFile(page, 'internal/cart/cart_test.go')
  await page.locator('.goide-run-glyph').first().click({ button: 'right' })
  await page.getByRole('menu', { name: 'Rodar ou depurar' }).getByRole('menuitem', { name: 'Rodar os testes do pacote com cobertura' }).click()

  const panel = page.getByRole('region', { name: 'Cobertura' })
  await expect(panel).toBeVisible({ timeout: 90_000 })
  const pkg = panel.getByRole('treeitem', { name: /^example\.com\/demo-shop\/internal\/cart, / })
  await expect(pkg).toBeVisible()
  // O teste não passa pelo erro de produto inexistente: menos de 100%.
  const file = panel.getByRole('treeitem', { name: /^internal\/cart\/cart\.go, \d/ })
  await expect(file).toBeVisible()
  const pct = Number((await file.getAttribute('aria-label'))!.match(/, ([\d,]+)%/)![1].replace(',', '.'))
  expect(pct).toBeGreaterThan(50)
  expect(pct).toBeLessThan(100)
  expect(await a11y(page)).toEqual([])

  // No editor: verde onde rodou, vermelho no ramo do erro.
  await file.dblclick()
  await expect(page.getByRole('tab', { name: 'cart.go', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.monaco-editor .goide-cov-full').first()).toBeVisible()
  await expect(page.locator('.monaco-editor .goide-cov-none').first()).toBeVisible()

  await panel.getByRole('button', { name: 'Esconder do editor' }).click()
  await expect(page.locator('.monaco-editor .goide-cov')).toHaveCount(0)
  await panel.getByRole('button', { name: 'Mostrar no editor' }).click()
  await expect(page.locator('.monaco-editor .goide-cov').first()).toBeVisible()
})

test('S18-H2 somar coberturas de duas execuções', async ({ page, fx }) => {
  const dir = fx.seed()
  fx.write(dir, 'internal/cart/missing_test.go', 'package cart\n\nimport "testing"\n\nfunc TestAddMissing(t *testing.T) {\n\tvar c Cart\n\tif c.Add("NAO-EXISTE", 1) == nil {\n\t\tt.Fatal("deveria falhar")\n\t}\n}\n')
  await openProject(page, dir)
  const panel = page.getByRole('region', { name: 'Cobertura' })
  const file = panel.getByRole('treeitem', { name: /^internal\/cart\/cart\.go, \d/ })
  const pctOf = async () => Number((await file.getAttribute('aria-label'))!.match(/, ([\d,]+)%/)![1].replace(',', '.'))
  const runWithCoverage = async (path: string, test: string) => {
    await openFile(page, path)
    await page.locator('.goide-run-glyph').nth(1).click({ button: 'right' })
    await page.getByRole('menu', { name: 'Rodar ou depurar' }).getByRole('menuitem', { name: `Rodar ${test} com cobertura` }).click()
  }

  await runWithCoverage('internal/cart/cart_test.go', 'TestTotal')
  await expect(file).toBeVisible({ timeout: 90_000 })
  const first = await pctOf()
  expect(first).toBeLessThan(100)

  // Liga a soma e roda o teste do erro: cart.go passa a ter o ramo do erro coberto também.
  await panel.getByRole('button', { name: 'Somar com a cobertura anterior' }).click()
  await runWithCoverage('internal/cart/missing_test.go', 'TestAddMissing')
  await expect(panel.getByRole('status')).toContainText('2 execuções somadas', { timeout: 90_000 })
  expect(await pctOf()).toBeGreaterThan(first)
})
