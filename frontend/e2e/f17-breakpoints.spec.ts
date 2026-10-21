// S17 breakpoints: editar pelo botão direito no número da linha (condição, log), silenciar todos.
import { test, expect, openProject, openFile, a11y } from './helpers'
import type { Page } from '@playwright/test'

const bpLine = 35 // "total += l.Product.Price * l.Qty" em internal/cart/cart.go
const lineNumber = (page: Page, n: number) => page.locator('.monaco-editor .line-numbers').filter({ hasText: new RegExp(`^${n}$`) })
const dbg = (page: Page) => page.getByRole('region', { name: 'Depurar' })
const dlg = (page: Page) => page.getByRole('dialog', { name: 'Breakpoints' })

async function setBreakpoint(page: Page) {
  await openFile(page, 'internal/cart/cart.go')
  await lineNumber(page, bpLine).click()
  await expect(page.locator('.prumo-bp')).toHaveCount(1)
}

async function debugMain(page: Page) {
  await openFile(page, 'cmd/shop/main.go')
  await page.locator('.prumo-run-glyph').first().click({ button: 'right' })
  await page.getByRole('menu', { name: 'Rodar ou depurar' }).getByRole('menuitem', { name: /^Depurar( |$)/ }).click()
}

// Compilar para depurar (-gcflags=all=-N -l) com a suíte inteira rodando passa de 90 s às vezes.
test.describe.configure({ timeout: 180_000 })

test.describe('S17 breakpoints', () => {
  test('S17-H1 condição: só para no segundo item', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await setBreakpoint(page)
    await lineNumber(page, bpLine).click({ button: 'right' })
    await expect(dlg(page).getByRole('option', { name: `internal/cart/cart.go:${bpLine}` })).toHaveAttribute('aria-selected', 'true')
    expect(await a11y(page)).toEqual([])
    const saved = page.waitForResponse((r) => (r.request().postData() ?? '').includes('Breakpoints.Update'))
    await dlg(page).getByLabel('Condição').fill('l.Product.SKU == "CAN-02"')
    await saved
    await dlg(page).getByRole('button', { name: 'Pronto' }).click()
    await expect(page.locator('.prumo-bp-cond')).toHaveCount(1)

    await debugMain(page)
    await expect(dbg(page).getByText(/parado \(breakpoint\)/)).toBeVisible({ timeout: 90_000 })
    await dbg(page).getByLabel('Avaliar expressão').fill('l.Product.SKU')
    await dbg(page).getByLabel('Avaliar expressão').press('Enter')
    await expect(dbg(page).getByRole('list', { name: 'Resultados' })).toContainText('CAN-02')
  })

  test('S17-H2 log: escreve no console e não para', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await setBreakpoint(page)
    await page.keyboard.press('Control+Shift+F8')
    await dlg(page).getByRole('checkbox', { name: /Registrar uma mensagem/ }).click({ force: true })
    const saved = page.waitForResponse((r) => (r.request().postData() ?? '').includes('Breakpoints.Update'))
    await dlg(page).getByLabel('Mensagem de log').fill('somando {l.Product.SKU}')
    await saved
    await dlg(page).getByRole('button', { name: 'Pronto' }).click()

    await debugMain(page)
    await expect(dbg(page).getByText(/encerrado/)).toBeVisible({ timeout: 90_000 })
    await dbg(page).getByRole('tab', { name: 'Console' }).click()
    await expect(dbg(page).getByRole('log')).toContainText('somando "CAF-01"') // o Delve escreve strings entre aspas
    await expect(dbg(page).getByRole('log')).toContainText('somando "CAN-02"')
  })

  test('S17-H3 silenciar todos: roda até o fim; tirar o silêncio volta a parar', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await setBreakpoint(page)
    await page.keyboard.press('Control+Shift+F8')
    await dlg(page).getByRole('checkbox', { name: 'Silenciar todos' }).click({ force: true })
    await dlg(page).getByRole('button', { name: 'Pronto' }).click()
    await expect(page.locator('.prumo-bp-off')).toHaveCount(1)

    await debugMain(page)
    await expect(dbg(page).getByText(/encerrado/)).toBeVisible({ timeout: 90_000 })

    await dbg(page).getByRole('button', { name: 'Silenciar breakpoints' }).click()
    await expect(page.locator('.prumo-bp-off')).toHaveCount(0)
    await debugMain(page)
    await expect(dbg(page).getByText(/parado \(breakpoint\)/)).toBeVisible({ timeout: 90_000 })
  })
})
