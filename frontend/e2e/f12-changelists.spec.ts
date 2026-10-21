// Changelists: F6 move um arquivo para uma lista nova; commitar só ela; a lista fica salva no projeto.
import { test, expect, openProject, a11y } from './helpers'
import type { Page } from '@playwright/test'

const commit = (page: Page) => page.getByRole('region', { name: 'Commit' })

test('F12-H10 changelist: separar um arquivo e commitar só a lista', async ({ page, fx }) => {
  const dir = fx.seed()
  fx.git(dir, 'commit', '-qam', 'base')
  fx.write(dir, 'README.md', fx.read(dir, 'README.md') + 'mais uma linha\n')
  fx.write(dir, 'internal/cart/cart.go', fx.read(dir, 'internal/cart/cart.go').replace('// Cart é um carrinho de compras.', '// Cart é o carrinho.'))
  await openProject(page, dir)
  await page.keyboard.press('Alt+0')
  const file = commit(page).getByTitle(/^internal\/cart\/cart\.go ·/)
  await file.focus()
  await page.keyboard.press('F6')
  await page.getByRole('menu', { name: 'Mover internal/cart/cart.go' }).getByRole('menuitem', { name: 'Nova changelist…' }).click()
  const dlg = page.getByRole('dialog', { name: 'Nova changelist' })
  await dlg.getByLabel('Nome da changelist').fill('carrinho')
  await dlg.getByRole('button', { name: 'Criar e mover' }).click()
  const group = commit(page).getByRole('group', { name: 'carrinho' })
  await expect(group).toContainText('cart.go')
  await expect(commit(page).getByRole('group', { name: 'Mudanças' })).toContainText('README.md')
  expect(await a11y(page)).toEqual([])

  // Só a lista "carrinho": desmarca o grupo Mudanças.
  await commit(page).getByRole('checkbox', { name: 'Selecionar Mudanças' }).click({ force: true })
  await commit(page).getByLabel('Mensagem do commit').fill('carrinho: comentário')
  await commit(page).getByRole('button', { name: 'Commit', exact: true }).click()
  await expect(page.getByText(/Commit [0-9a-f]{7} criado/)).toBeVisible()
  expect(fx.git(dir, 'show', '--name-only', '--format=', 'HEAD')).toBe('internal/cart/cart.go')
  // A lista fica (vazia) e o README continua pendente.
  await expect(commit(page).getByRole('group', { name: 'carrinho' })).toContainText('0 arquivos')
  await expect(commit(page).getByRole('group', { name: 'Mudanças' })).toContainText('README.md')
})
