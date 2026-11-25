// Menu do botão direito na árvore do projeto: criar, renomear, copiar, colar e apagar arquivos e pastas.
import { test, expect, openProject, openFile } from './helpers'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const tree = (page: import('@playwright/test').Page) => page.getByRole('tree', { name: 'Arquivos do projeto' })

test('F05 menu da árvore: novo arquivo, renomear, copiar/colar e apagar', async ({ page, fx }) => {
  const dir = fx.seed()
  await openProject(page, dir)

  // Novo arquivo na raiz.
  await tree(page).getByRole('treeitem').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Novo arquivo…' }).click()
  await page.getByLabel('Nome do arquivo').fill('notas.txt')
  await page.getByRole('button', { name: 'Criar' }).click()
  await expect(tree(page).getByRole('treeitem', { name: 'notas.txt' })).toBeVisible()
  expect(existsSync(join(dir, 'notas.txt'))).toBe(true)

  // Nome repetido: o diálogo fica aberto e mostra o erro.
  await tree(page).getByRole('treeitem').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Novo arquivo…' }).click()
  await page.getByLabel('Nome do arquivo').fill('notas.txt')
  await page.getByRole('button', { name: 'Criar' }).click()
  await expect(page.getByText('já existe um arquivo ou pasta com esse nome')).toBeVisible()
  await page.getByRole('button', { name: 'Cancelar' }).click()

  // Renomear.
  await tree(page).getByRole('treeitem', { name: 'notas.txt' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Renomear…' }).click()
  await page.getByLabel('Novo nome').fill('anotacoes.txt')
  await page.getByRole('button', { name: 'Renomear' }).click()
  await expect(tree(page).getByRole('treeitem', { name: 'anotacoes.txt' })).toBeVisible()
  await expect(tree(page).getByRole('treeitem', { name: 'notas.txt' })).toHaveCount(0)
  expect(existsSync(join(dir, 'anotacoes.txt'))).toBe(true)

  // Copiar e colar na mesma pasta cria "… cópia".
  await tree(page).getByRole('treeitem', { name: 'anotacoes.txt' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Copiar', exact: true }).click()
  await tree(page).getByRole('treeitem').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Colar' }).click()
  await expect(tree(page).getByRole('treeitem', { name: 'anotacoes cópia.txt' })).toBeVisible()

  // Apagar pede confirmação.
  await tree(page).getByRole('treeitem', { name: 'anotacoes cópia.txt' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Apagar…' }).click()
  await page.getByRole('button', { name: 'Apagar', exact: true }).click()
  await expect(tree(page).getByRole('treeitem', { name: 'anotacoes cópia.txt' })).toHaveCount(0)
  expect(existsSync(join(dir, 'anotacoes cópia.txt'))).toBe(false)
})

test('F05 renomear um arquivo aberto mantém a aba no novo nome', async ({ page, fx }) => {
  const dir = fx.seed()
  await openProject(page, dir)
  await openFile(page, 'internal/cart/cart.go')
  await tree(page).getByRole('treeitem', { name: 'cart.go' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Renomear…' }).click()
  await page.getByLabel('Novo nome').fill('carrinho.go')
  await page.getByRole('button', { name: 'Renomear' }).click()
  await expect(page.getByRole('tab', { name: /carrinho\.go/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /cart\.go/ })).toHaveCount(0)
  expect(existsSync(join(dir, 'internal/cart/carrinho.go'))).toBe(true)
})
