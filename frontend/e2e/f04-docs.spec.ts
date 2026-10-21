// Documentação: Ctrl+Q mostra o balão; Ctrl+Q de novo fixa na janela Documentação, que acompanha o cursor.
import { test, expect, openProject, openFile, cursorAt, mod, a11y } from './helpers'
import type { Page } from '@playwright/test'

const doc = (page: Page) => page.getByRole('region', { name: 'Documentação' })

test('F04-H6 fixar a documentação e ela acompanha o cursor', async ({ page, fx }) => {
  await openProject(page, fx.seed())
  await openFile(page, 'cmd/shop/main.go')
  await cursorAt(page, 'c.Tot')
  await page.keyboard.press(`${mod}+q`)
  await expect(page.locator('.monaco-hover').filter({ hasText: 'Total devolve o total em centavos' }).first()).toBeVisible({ timeout: 30_000 })
  await page.keyboard.press(`${mod}+q`)
  await expect(doc(page)).toBeVisible()
  const article = doc(page).getByRole('article', { name: 'Documentação do símbolo' })
  await expect(article).toContainText(/func\s\(c\s\*cart\.Cart\)\sTotal\(\)\sint/) // visto de main, o gopls qualifica o tipo
  await expect(article).toContainText('Total devolve o total em centavos.')
  expect(await a11y(page)).toEqual([])
  // Andou com o cursor: troca sozinha.
  await cursorAt(page, 'cart.Car')
  await expect(article).toContainText(/type\sCart\sstruct/) // o colorize do Monaco usa &nbsp;
})
