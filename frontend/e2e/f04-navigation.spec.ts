// Navegação: voltar e avançar depois de um salto (Ctrl+B), e a lista de locais recentes.
import { test, expect, openProject, openFile, cursorAt, mod } from './helpers'
import type { Page } from '@playwright/test'

const activeTab = (page: Page, name: string) => expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true')
const line = (page: Page) => page.evaluate(() => (window as any).__prumoEditor.getPosition().lineNumber as number)

test('F04-H8 voltar/avançar e locais recentes', async ({ page, fx }) => {
  await openProject(page, fx.seed())
  await openFile(page, 'cmd/shop/main.go')
  await cursorAt(page, 'cart.Car')
  const from = await line(page)
  await page.keyboard.press(`${mod}+b`)
  await activeTab(page, 'cart.go')

  await page.keyboard.press(`${mod}+Alt+ArrowLeft`)
  await activeTab(page, 'main.go')
  await expect.poll(() => line(page)).toBe(from)
  await page.keyboard.press(`${mod}+Alt+ArrowRight`)
  await activeTab(page, 'cart.go')

  await page.keyboard.press(`${mod}+Shift+E`)
  const list = page.getByRole('dialog', { name: 'Locais recentes' }).getByRole('listbox', { name: 'Locais' })
  await expect(list.getByRole('option', { name: /^internal\/cart\/cart\.go linha \d+/ })).toBeVisible()
  const back = list.getByRole('option', { name: `cmd/shop/main.go linha ${from}` })
  await expect(back).toBeVisible()
  await expect(back).toContainText('var c cart.Cart')
  await back.click()
  await activeTab(page, 'main.go')
})
