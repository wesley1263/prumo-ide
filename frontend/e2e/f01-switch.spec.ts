// F01 trocar de projeto pelo cabeçalho: lista os recentes, salva o que está pendente e abre o outro.
import { test, expect, openProject, openFile, cursorAt } from './helpers'

test('F01-H4 trocar de projeto pelo cabeçalho salva o pendente e abre o outro', async ({ page, fx }) => {
  const a = fx.seed('loja-a')
  const b = fx.seed('loja-b')
  await openProject(page, a)
  await openProject(page, b) // volta à tela inicial e abre o b: o a fica nos recentes
  await openFile(page, 'README.md')
  await cursorAt(page, '# demo-shop')
  await page.keyboard.type(' (editado no b)')

  const widget = page.getByRole('banner').getByRole('button', { name: 'Projeto: loja-b' })
  await widget.click()
  const item = page.getByRole('menuitem', { name: /^loja-a/ })
  await expect(item).toBeVisible()
  await expect(page.getByRole('menuitem', { name: /^loja-b/ })).toHaveCount(0) // o atual não aparece
  await item.click()

  await expect(page.getByRole('banner').getByRole('button', { name: 'Projeto: loja-a' })).toBeVisible()
  await expect(page.getByRole('tree', { name: 'Arquivos do projeto' }).getByRole('treeitem', { name: /^loja-a/ })).toBeVisible()
  expect(fx.read(b, 'README.md')).toContain('# demo-shop (editado no b)')

  // "Abrir ou clonar outro…" volta à tela inicial.
  await page.getByRole('banner').getByRole('button', { name: 'Projeto: loja-a' }).click()
  await page.getByRole('menuitem', { name: 'Abrir ou clonar outro…' }).click()
  await expect(page.getByRole('button', { name: 'Clonar', exact: true })).toBeVisible()
})
