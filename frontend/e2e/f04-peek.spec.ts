// Popups de código: usos (Ctrl+Alt+F7) e definição rápida (Ctrl+Shift+I), sem sair do arquivo.
import { test, expect, openProject, openFile, cursorAt } from './helpers'

test('F04-H7 popup de usos e definição rápida', async ({ page, fx }) => {
  await openProject(page, fx.seed())
  await openFile(page, 'cmd/shop/main.go')
  await cursorAt(page, 'c.Tot')
  await page.keyboard.press('Control+Shift+I')
  const peek = page.locator('.peekview-widget')
  await expect(peek).toBeVisible({ timeout: 30_000 })
  await expect(peek).toContainText('cart.go')
  await page.keyboard.press('Escape')
  await expect(peek).toBeHidden()
  await page.keyboard.press('Control+Alt+F7')
  await expect(peek).toBeVisible({ timeout: 30_000 })
  await expect(peek.getByText(/main\.go/).first()).toBeVisible()
  await expect(page.getByRole('tab', { name: 'main.go', exact: true })).toHaveAttribute('aria-selected', 'true') // não saiu do arquivo
})
