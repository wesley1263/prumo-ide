// Bookmarks: F11 marca, Ctrl+F11 com mnemônico, Ctrl+número pula, Shift+F11 lista; acompanham a edição e ficam no projeto.
import { test, expect, openProject, openFile, cursorAt, a11y } from './helpers'
import type { Page } from '@playwright/test'

const list = (page: Page) => page.getByRole('listbox', { name: 'Bookmarks do projeto' })
const cursorLine = (page: Page) => page.evaluate(() => (window as any).__prumoEditor.getPosition().lineNumber as number)

test('F04-H9 bookmarks: marcar, mnemônico, pular, seguir a edição e reabrir', async ({ page, fx }) => {
  const dir = fx.seed()
  await openProject(page, dir)
  await openFile(page, 'internal/cart/cart.go')
  await cursorAt(page, 'func (c *Cart) Total')
  const totalLine = await cursorLine(page)
  await page.keyboard.press('F11')
  await expect(page.locator('.prumo-bookmark')).toHaveCount(1)

  // Mnemônico 3 noutro arquivo.
  await openFile(page, 'internal/catalog/catalog.go')
  await cursorAt(page, 'func Find(')
  const findLine = await cursorLine(page)
  await page.keyboard.press('Control+F11')
  const mn = page.getByRole('dialog', { name: 'Bookmark com mnemônico' })
  await expect(mn).toBeVisible()
  expect(await a11y(page)).toEqual([])
  await page.keyboard.press('3')
  await expect(mn).toBeHidden()
  await expect(page.locator('.prumo-bm-3')).toHaveCount(1)

  // Duas linhas novas acima (comentários: o gofmt do salvar não as junta): a marca desce junto.
  await cursorAt(page, 'package catalog', 'after')
  await page.keyboard.press('Enter')
  await page.keyboard.type('// um')
  await page.keyboard.press('Enter')
  await page.keyboard.type('// dois')

  // Ctrl+3 de volta de outro arquivo.
  await page.getByRole('tab', { name: 'cart.go', exact: true }).click()
  await page.keyboard.press('Control+3')
  await expect(page.getByRole('tab', { name: /^catalog\.go/ })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => cursorLine(page)).toBe(findLine + 2)

  // Lista: os dois, o com mnemônico primeiro; descrição pelo F2; Enter vai.
  await page.keyboard.press('Shift+F11')
  await expect(list(page).getByRole('option')).toHaveCount(2)
  expect(await a11y(page)).toEqual([])
  await expect(list(page).getByRole('option').first()).toHaveAccessibleName(`3: internal/catalog/catalog.go linha ${findLine + 2}`)
  await list(page).press('ArrowDown')
  await list(page).press('F2')
  await page.getByLabel('Descrição do bookmark').fill('soma do carrinho')
  await page.getByLabel('Descrição do bookmark').press('Enter')
  await expect(list(page).getByRole('option', { name: `internal/cart/cart.go linha ${totalLine}, soma do carrinho` })).toBeVisible()
  await list(page).press('Enter')
  await expect(page.getByRole('tab', { name: 'cart.go', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => cursorLine(page)).toBe(totalLine)

  // F11 de novo desmarca; reabrindo o projeto, o outro continua.
  const saved = page.waitForResponse((r) => (r.request().postData() ?? '').includes('Workspace.Save'))
  await page.keyboard.press('F11')
  await expect(page.locator('.prumo-bookmark')).toHaveCount(0)
  await saved // o estado do projeto é gravado com 1 s de folga
  await page.reload()
  await page.getByRole('list', { name: 'Projetos recentes' }).getByRole('button', { name: new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click()
  // Espera a IDE montar (os atalhos só existem depois) antes do Shift+F11.
  await expect(page.getByRole('tab', { name: /^catalog\.go/ })).toBeVisible()
  await page.keyboard.press('Shift+F11')
  await expect(list(page).getByRole('option')).toHaveCount(1)
  await list(page).press('Delete')
  await expect(list(page).getByRole('option')).toHaveCount(0)
})
