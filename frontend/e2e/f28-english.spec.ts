// A IDE em inglês: tela inicial, erro vindo do backend, confiança, árvore, rodar (linhas de sistema do console)
// e o Commit. A preferência de idioma é global: roda no projeto "configuracoes" (serial) e volta ao padrão no fim.
import { test, expect, API, token } from './helpers'
import type { Page } from '@playwright/test'

const setLanguage = (v: string) =>
  fetch(`${API}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goide-Token': token() },
    body: JSON.stringify({ method: 'Settings.Set', args: ['appearance.language', v] }),
  })

test.beforeEach(async () => void (await setLanguage('en')))
test.afterEach(async () => void (await setLanguage('system')))

async function openFolder(page: Page, path: string) {
  await page.getByRole('button', { name: 'Open', exact: true }).first().click()
  const field = page.getByLabel('Folder path')
  await field.fill(path)
  await field.press('Enter')
}

test('F28-H8 a IDE em inglês, inclusive as mensagens do backend', async ({ page, fx }) => {
  await page.goto('/')
  // O idioma gravado no backend manda: a janela recarrega uma vez em inglês.
  await expect(page.locator('html')).toHaveAttribute('lang', 'en', { timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'New Project' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Clone', exact: true }).first()).toBeVisible()

  // Erro do backend (Go, em português) chega traduzido.
  await openFolder(page, '/nao/existe/mesmo')
  await expect(page.getByRole('dialog', { name: 'Open Folder' })).toContainText('folder not found: /nao/existe/mesmo')
  await page.keyboard.press('Escape')

  const dir = fx.seed()
  await openFolder(page, dir)
  const trust = page.getByRole('dialog', { name: 'Trust this project?' })
  await trust.getByRole('button', { name: 'Trust', exact: true }).click()
  const tree = page.getByRole('tree', { name: 'Project files' })
  await expect(tree).toBeVisible()
  await expect(page.getByText('gopls ready')).toBeVisible({ timeout: 60_000 })

  // Rodar: as linhas de sistema do console (do backend) em inglês.
  for (const d of ['cmd', 'shop']) await tree.getByRole('treeitem', { name: d, exact: true }).click()
  await tree.getByRole('treeitem', { name: 'main.go', exact: true }).dblclick()
  await page.locator('.goide-run-glyph').first().click()
  await expect(page.getByRole('log').first()).toContainText('Process finished with exit code 0.', { timeout: 90_000 })

  // Commit em inglês.
  await page.keyboard.press('Alt+0')
  await expect(page.getByLabel('Commit message')).toBeVisible()
})
