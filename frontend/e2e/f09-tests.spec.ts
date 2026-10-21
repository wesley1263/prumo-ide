// F09 Rodar testes e rodar de novo os que falharam.
import { test, expect, openProject, openFile, a11y } from './helpers'
import type { Page } from '@playwright/test'

const EXTRA = `package cart

import "testing"

func TestAdd(t *testing.T) {}

func TestSub(t *testing.T) {
	t.Log("conta errada de propósito")
	t.Fatal("2-1 deveria ser 1")
}

func TestTable(t *testing.T) {
	cases := []struct {
		name string
		in   int
	}{
		{"positivo", 1},
		{"negativo", -1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if c.in < 0 {
				t.Errorf("negativo: %d", c.in)
			}
		})
	}
}

func TestSkip(t *testing.T) { t.Skip("depois") }
`

const tests = (page: Page) => page.getByRole('region', { name: 'Testes' })
const results = (page: Page) => tests(page).getByRole('tree', { name: 'Resultados dos testes' })

async function runPackageTests(page: Page) {
  await openFile(page, 'internal/cart/extra_test.go')
  await page.locator('.goide-run-glyph').first().click() // linha "package"
  await expect(tests(page).getByRole('status')).toContainText('falharam', { timeout: 90_000 })
  await expect(tests(page).getByRole('status')).not.toContainText('rodando', { timeout: 90_000 })
}

test.describe('F09 testes', () => {
  test('F09-H1 rodar um teste pelo ▶ ao lado da função', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await openFile(page, 'internal/cart/cart_test.go')
    await page.locator('.goide-run-glyph').nth(1).click() // [0] = package, [1] = TestTotal
    await expect(tests(page).getByRole('status')).toContainText('1 passaram, 0 falharam', { timeout: 90_000 })
    await expect(results(page).getByRole('treeitem', { name: /^TestTotal, passou/ })).toBeVisible()
  })

  test('F09-H2 pacote inteiro: árvore com subtestes, contagens, primeira falha selecionada', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(dir, 'internal/cart/extra_test.go', EXTRA)
    await openProject(page, dir)
    await runPackageTests(page)
    await expect(tests(page).getByRole('status')).toContainText('3 passaram, 3 falharam, 1 pulados')
    const tree = results(page)
    await expect(tree.getByRole('treeitem', { name: /^TestTable, falhou/ })).toBeVisible()
    await expect(tree.getByRole('treeitem', { name: /^TestTable\/negativo, falhou/ })).toBeVisible()
    await expect(tree.getByRole('treeitem', { name: /^TestTable\/positivo, passou/ })).toBeVisible()
    await expect(tree.getByRole('treeitem', { name: /^TestSkip, pulado/ })).toBeVisible()
    // A primeira falha já vem selecionada, com a saída dela.
    await expect(tests(page).getByRole('log', { name: 'Saída de TestSub' })).toContainText('conta errada de propósito')
  })

  test('F09-E1 do resultado para o código (teste e subteste)', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(dir, 'internal/cart/extra_test.go', EXTRA)
    await openProject(page, dir)
    await runPackageTests(page)
    await results(page).getByRole('treeitem', { name: /^TestTable\/negativo/ }).dblclick()
    await expect(page.getByRole('tab', { name: 'extra_test.go', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('contentinfo').getByText(/^18:1$/)).toBeVisible() // {"negativo", -1}
  })

  test('F09-E2 rodar só os que falharam', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(dir, 'internal/cart/extra_test.go', EXTRA)
    await openProject(page, dir)
    await runPackageTests(page)
    await tests(page).getByRole('button', { name: 'Rodar só os que falharam' }).click()
    await expect(tests(page).getByRole('status')).toContainText('(falhos)', { timeout: 90_000 })
    await expect(tests(page).getByRole('status')).toContainText('1 passaram, 3 falharam', { timeout: 90_000 })
    await expect(results(page).getByRole('treeitem', { name: /^TestAdd/ })).toHaveCount(0)
  })

  test('F09-E3 mostrar só falhas', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(dir, 'internal/cart/extra_test.go', EXTRA)
    await openProject(page, dir)
    await runPackageTests(page)
    await tests(page).getByRole('button', { name: 'Mostrar só falhas' }).click()
    await expect(results(page).getByRole('treeitem', { name: /^TestTotal/ })).toHaveCount(0)
    await expect(results(page).getByRole('treeitem', { name: /^TestSub, falhou/ })).toBeVisible()
  })

  test('F09-E4 teste que não compila: pacote falha e o motivo aparece', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(dir, 'internal/cart/quebrado_test.go', 'package cart\n\nimport "testing"\n\nfunc TestQuebrado(t *testing.T) { var x int = "texto"; _ = x }\n')
    await openProject(page, dir)
    await openFile(page, 'internal/cart/quebrado_test.go')
    await page.locator('.goide-run-glyph').first().click()
    await expect(tests(page).getByRole('status')).toContainText('0 passaram', { timeout: 90_000 })
    await expect(results(page).getByRole('treeitem', { name: /cart, falhou/ })).toBeVisible()
    // O erro do compilador vai para o console da execução.
    await page.keyboard.press('Alt+4')
    await expect(page.getByRole('region', { name: 'Executar' }).getByRole('log')).toContainText('cannot use', { timeout: 30_000 })
  })

  test('F09-N1 modo restrito: rodar teste pede confiança', async ({ page, fx }) => {
    await openProject(page, fx.seed(), { trust: false })
    await openFile(page, 'internal/cart/cart_test.go')
    await page.locator('.goide-run-glyph').nth(1).click()
    await expect(page.getByRole('dialog', { name: 'Confiar neste projeto?' })).toBeVisible()
  })

  test('F09-A11Y janela Testes sem violações', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(dir, 'internal/cart/extra_test.go', EXTRA)
    await openProject(page, dir)
    await runPackageTests(page)
    expect(await a11y(page)).toEqual([])
  })

  test('F09-H5 rodar só um subteste pela árvore', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(dir, 'internal/cart/extra_test.go', EXTRA)
    await openProject(page, dir)
    await runPackageTests(page)
    await results(page).getByRole('treeitem', { name: /^TestTable\/negativo, falhou/ }).click() // falhas já vêm abertas
    await tests(page).getByRole('button', { name: 'Rodar TestTable/negativo' }).click()
    // Só ele rodou: 0 passaram, 1 falhou (o pai também conta como falha no go test).
    await expect(tests(page).getByRole('status')).toContainText(/0 passaram, [12] falharam/, { timeout: 90_000 })
    await expect(results(page).getByRole('treeitem', { name: /^TestAdd/ })).toHaveCount(0)
    await expect(page.getByRole('banner').getByRole('button', { name: /^Configuração: go test TestTable\/negativo/ })).toBeVisible()
  })
})

test('F09-H7 rodar de novo ao salvar', async ({ page, fx }) => {
  const dir = fx.seed()
  await openProject(page, dir)
  await openFile(page, 'internal/cart/cart_test.go')
  await page.locator('.goide-run-glyph').nth(1).click()
  await expect(tests(page).getByRole('status')).toContainText('1 passaram, 0 falharam', { timeout: 90_000 })
  await tests(page).getByRole('button', { name: 'Rodar de novo ao salvar' }).click()
  await expect(tests(page).getByRole('button', { name: 'Rodar de novo ao salvar' })).toHaveAttribute('aria-pressed', 'true')

  // Quebra o Total e salva: os testes rodam sozinhos e falham.
  await openFile(page, 'internal/cart/cart.go')
  const ed = page.locator('.monaco-editor').first()
  await page.evaluate(() => {
    const ed = (window as any).__goideEditor
    const m = ed.getModel()
    const r = m.findMatches('return total', false, false, true, null, false)[0].range
    ed.executeEdits('t', [{ range: r, text: 'return total + 1' }])
    ed.focus()
  })
  await ed.press('Control+S')
  await expect(tests(page).getByRole('status')).toContainText('0 passaram, 1 falharam', { timeout: 90_000 })
})
