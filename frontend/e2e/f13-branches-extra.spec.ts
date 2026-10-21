// Branches favoritas (★, primeiro na lista, ficam no projeto) e comparar a atual com outra.
import { test, expect, openProject, openFile } from './helpers'
import type { Page } from '@playwright/test'

const popup = (page: Page) => page.getByRole('dialog', { name: 'Branches' })
const openBranches = async (page: Page) => {
  await page.getByRole('banner').getByRole('button', { name: /^Branch: / }).click()
  await expect(popup(page)).toBeVisible()
}

test('F13-H5 favoritas e comparar branches', async ({ page, fx }) => {
  const dir = fx.seed()
  fx.git(dir, 'checkout', '-qb', 'feat/frete')
  fx.write(dir, 'internal/cart/frete.go', 'package cart\n\nfunc Frete() int { return 1500 }\n')
  fx.git(dir, 'add', '-A')
  fx.git(dir, 'commit', '-qm', 'frete fixo')
  fx.git(dir, 'checkout', '-qb', 'zz-outra', 'main')
  fx.git(dir, 'checkout', '-q', 'main')
  await openProject(page, dir)
  await openBranches(page)
  const locals = popup(page).getByRole('region', { name: 'Locais' }).getByRole('listitem')
  // main é favorita por padrão.
  await expect(locals.first()).toContainText('main')
  await expect(popup(page).getByRole('button', { name: 'main (atual), favorita' })).toBeVisible()

  // zz-outra vira favorita e sobe para depois da main.
  await popup(page).getByRole('button', { name: 'Ações de zz-outra' }).click()
  await page.getByRole('menuitem', { name: 'Marcar como favorita' }).click()
  await expect(locals.nth(1)).toContainText('zz-outra')

  // Comparar com feat/frete: o commit só dela e o arquivo novo; duplo clique abre o diff.
  await popup(page).getByRole('button', { name: 'Ações de feat/frete' }).click()
  await page.getByRole('menuitem', { name: 'Comparar com a atual' }).click()
  const cmp = page.getByRole('dialog', { name: 'main ↔ feat/frete' })
  await expect(cmp.getByRole('region', { name: 'Só em feat/frete' })).toContainText('frete fixo')
  await expect(cmp.getByRole('region', { name: 'Só em main' })).toContainText('Nenhum.')
  await cmp.getByRole('button', { name: 'internal/cart/frete.go, adicionado' }).dblclick()
  await expect(page.getByRole('tab', { name: 'frete.go (↔ feat/frete)' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.monaco-diff-editor .editor.modified')).toContainText('return 1500')

  // A favorita continua depois de reabrir.
  await page.waitForTimeout(1200)
  await page.reload()
  await page.getByRole('list', { name: 'Projetos recentes' }).getByRole('button', { name: new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click()
  await openBranches(page)
  await expect(popup(page).getByRole('button', { name: 'Trocar para zz-outra, favorita' })).toBeVisible()
})

test('F15-H6 tag pelo Log e worktree de uma branch', async ({ page, fx }) => {
  const dir = fx.seed()
  fx.git(dir, 'branch', 'feat/frete')
  await openProject(page, dir)
  await page.keyboard.press('Alt+9')
  const grid = page.getByRole('region', { name: 'Git' }).getByRole('grid', { name: 'Commits' })
  await grid.getByRole('row').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Nova tag aqui…' }).click()
  const tagDlg = page.getByRole('dialog', { name: /^Nova tag em [0-9a-f]{7}$/ })
  await tagDlg.getByLabel('Nome da tag').fill('v0.1.0')
  await tagDlg.getByLabel('Mensagem (opcional)').fill('primeira')
  await tagDlg.getByRole('button', { name: 'Criar tag' }).click()
  await expect(page.getByText('Tag v0.1.0 criada')).toBeVisible()
  expect(fx.git(dir, 'cat-file', '-t', 'v0.1.0')).toBe('tag')
  await expect(grid.getByRole('row').first()).toHaveAccessibleName(/v0\.1\.0/)
  await grid.getByRole('row').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Apagar a tag v0.1.0' }).click()
  await expect(page.getByText('Tag v0.1.0 apagada')).toBeVisible()

  // Worktree da feat/frete: cria (sem abrir) e aparece na lista.
  await openBranches(page)
  await popup(page).getByRole('button', { name: 'Ações de feat/frete' }).click()
  await page.getByRole('menuitem', { name: 'Abrir num worktree novo…' }).click()
  const wtDlg = page.getByRole('dialog', { name: 'Worktree para feat/frete' })
  await expect(wtDlg.getByLabel('Pasta do worktree')).toHaveValue(/demo-shop-feat-frete$/)
  await wtDlg.getByRole('button', { name: 'Só criar' }).click()
  await expect(page.getByText('Worktree criado')).toBeVisible()
  await openBranches(page)
  await popup(page).getByRole('button', { name: 'Worktrees…' }).click()
  const list = page.getByRole('dialog', { name: 'Worktrees' }).getByRole('list', { name: 'Worktrees do repositório' })
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await expect(list).toContainText('feat/frete')
})

test('F13-H6 cada branch volta com as abas que tinha', async ({ page, fx }) => {
  const dir = fx.seed()
  fx.git(dir, 'commit', '-qam', 'base limpa')
  fx.git(dir, 'branch', 'outra')
  await openProject(page, dir)
  await openFile(page, 'internal/cart/cart.go')
  const tab = (name: string) => page.getByRole('tab', { name: new RegExp(`^${name.replace('.', '\\.')}`) })
  const switchTo = async (b: string) => {
    await openBranches(page)
    await popup(page).getByRole('button', { name: new RegExp(`^Trocar para ${b}`) }).click()
    await expect(page.getByRole('button', { name: `Branch: ${b}` })).toBeVisible({ timeout: 20_000 })
  }
  // Primeira vez na "outra": sem contexto guardado, as abas ficam.
  await switchTo('outra')
  await expect(tab('cart.go')).toBeVisible()
  // Na "outra", troca cart.go por catalog.go.
  await tab('cart.go').click()
  await page.keyboard.press('Control+F4')
  await expect(tab('cart.go')).toHaveCount(0)
  await openFile(page, 'internal/catalog/catalog.go')
  // Volta para a main: cart.go volta, catalog.go sai; e na "outra" de novo, o contrário.
  await switchTo('main')
  await expect(tab('cart.go')).toBeVisible()
  await expect(tab('catalog.go')).toHaveCount(0)
  await switchTo('outra')
  await expect(tab('catalog.go')).toBeVisible()
  await expect(tab('cart.go')).toHaveCount(0)
})
