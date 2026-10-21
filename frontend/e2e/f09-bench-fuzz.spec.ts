// Benchmark e fuzz pelo ▶ do gutter: -bench/-fuzz no lugar do -run, resultado (ns/op, execs) na árvore.
import { test, expect, openProject, openFile } from './helpers'
import type { Page } from '@playwright/test'

const BENCH = `package cart

import "testing"

func BenchmarkTotal(b *testing.B) {
	var c Cart
	_ = c.Add("CAF-01", 2)
	for i := 0; i < b.N; i++ {
		_ = c.Total()
	}
}

func FuzzAdd(f *testing.F) {
	f.Add("CAF-01", 1)
	f.Fuzz(func(t *testing.T, sku string, qty int) {
		var c Cart
		_ = c.Add(sku, qty)
	})
}
`

const tests = (page: Page) => page.getByRole('region', { name: 'Testes' })
const results = (page: Page) => tests(page).getByRole('tree', { name: 'Resultados dos testes' })

// O fuzz roda 10 s por padrão, mais a compilação com instrumentação.
test.describe.configure({ timeout: 180_000 })

test('F09-H6 benchmark e fuzz pelo ▶ do gutter', async ({ page, fx }) => {
  const dir = fx.seed()
  fx.write(dir, 'internal/cart/bench_test.go', BENCH)
  await openProject(page, dir)
  await openFile(page, 'internal/cart/bench_test.go')
  await page.locator('.prumo-run-glyph').nth(1).click() // [0] = package, [1] = BenchmarkTotal
  await expect(results(page).getByRole('treeitem', { name: /^BenchmarkTotal, passou, \d+× · [\d.]+ ns\/op · \d+ B\/op/ })).toBeVisible({ timeout: 90_000 })

  await page.locator('.prumo-run-glyph').nth(2).click() // FuzzAdd
  await expect(results(page).getByRole('treeitem', { name: /^FuzzAdd, passou, elapsed: \d+s, execs: \d+/ })).toBeVisible({ timeout: 120_000 })
})
