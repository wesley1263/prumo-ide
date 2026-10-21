// Watches: fixar uma expressão (Ctrl+Enter), reavaliar a cada parada, e continuar lá depois de reabrir o projeto.
import { test, expect, openProject, openFile } from './helpers'
import type { Page } from '@playwright/test'

test.describe.configure({ timeout: 180_000 }) // compila para depurar duas vezes

const dbg = (page: Page) => page.getByRole('region', { name: 'Depurar' })
const watches = (page: Page) => dbg(page).getByRole('list', { name: 'Watches' })

async function debugMain(page: Page) {
  await openFile(page, 'cmd/shop/main.go')
  await page.locator('.prumo-run-glyph').first().click({ button: 'right' })
  await page.getByRole('menu', { name: 'Rodar ou depurar' }).getByRole('menuitem', { name: /^Depurar( |$)/ }).click()
  await expect(dbg(page).getByText(/parado \(breakpoint\)/)).toBeVisible({ timeout: 90_000 })
}

test('F10-H6 watch reavaliado a cada parada e salvo com o projeto', async ({ page, fx }) => {
  const dir = fx.seed()
  await openProject(page, dir)
  await openFile(page, 'internal/cart/cart.go')
  await page.locator('.monaco-editor .line-numbers').filter({ hasText: /^35$/ }).click()
  await debugMain(page)

  const box = dbg(page).getByLabel('Avaliar expressão')
  await box.fill('total')
  await box.press('Control+Enter')
  await expect(watches(page)).toContainText('total = 0')
  // Próxima volta do laço: o valor muda sozinho.
  await page.keyboard.press('F9')
  await expect(watches(page)).toContainText('total = 3490', { timeout: 30_000 })
  await page.keyboard.press('Control+F2')
  await expect(dbg(page).getByText(/encerrado/)).toBeVisible({ timeout: 30_000 })

  // Reabrir o projeto: o watch continua.
  await page.waitForTimeout(1200) // o estado do projeto é gravado com 1 s de folga
  await page.reload()
  await page.getByRole('list', { name: 'Projetos recentes' }).getByRole('button', { name: new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click()
  await debugMain(page)
  await expect(watches(page)).toContainText('total = 0')
  await watches(page).getByRole('button', { name: 'Tirar o watch total' }).click()
  await expect(watches(page)).toHaveCount(0)
})
