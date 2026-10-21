// F12 commit parcial: abrir os trechos de um arquivo, desmarcar um, commitar só o resto.
import { test, expect, openProject, a11y } from './helpers'
import type { Page } from '@playwright/test'

const commit = (page: Page) => page.getByRole('region', { name: 'Commit' })

test('F12-H5 commit só de um trecho do arquivo; o outro fica pendente', async ({ page, fx }) => {
  const dir = fx.seed()
  // Além do Count (adicionado no fim pela fixture), muda o preço do café: dois trechos.
  fx.write(dir, 'internal/catalog/catalog.go', fx.read(dir, 'internal/catalog/catalog.go').replace('Price: 3490', 'Price: 3590'))
  await openProject(page, dir)
  await page.keyboard.press('Alt+0')
  await commit(page).getByRole('button', { name: 'Escolher trechos de internal/catalog/catalog.go' }).click()
  const chunks = commit(page).getByRole('list', { name: 'Trechos de internal/catalog/catalog.go' })
  await expect(chunks.getByRole('checkbox')).toHaveCount(2)
  expect(await a11y(page)).toEqual([])

  // Tira o trecho do Count: o arquivo fica "parcial".
  await chunks.getByRole('checkbox', { name: /trecho 2 .*adicionado/ }).click({ force: true })
  // Checkbox nativo: o "parcial" é a propriedade indeterminate (o leitor de tela anuncia "misto").
  const fileBox = commit(page).getByRole('checkbox', { name: /^Incluir internal\/catalog\/catalog\.go/ })
  await expect.poll(() => fileBox.evaluate((el) => (el as HTMLInputElement).indeterminate)).toBe(true)

  await commit(page).getByLabel('Mensagem do commit').fill('catálogo: preço do café')
  await commit(page).getByRole('button', { name: 'Commit', exact: true }).click()
  await expect(page.getByText(/Commit [0-9a-f]{7} criado/)).toBeVisible()
  const committed = fx.git(dir, 'show', 'HEAD:internal/catalog/catalog.go')
  expect(committed).toContain('Price: 3590')
  expect(committed).not.toContain('func Count()')
  // O Count continua no disco e pendente.
  expect(fx.read(dir, 'internal/catalog/catalog.go')).toContain('func Count()')
  await expect(commit(page).getByRole('checkbox', { name: /^Incluir internal\/catalog\/catalog\.go/ })).toBeVisible()
})

test('F12-H9 commit por linha: dentro do trecho, só uma das linhas novas entra', async ({ page, fx }) => {
  const dir = fx.seed()
  fx.write(dir, 'README.md', '# demo-shop\n\nProjeto de exemplo para desenvolver a IDE.\nlinha um\nlinha dois\nlinha três\n')
  await openProject(page, dir)
  await page.keyboard.press('Alt+0')
  await commit(page).getByRole('button', { name: 'Escolher trechos de README.md' }).click()
  await commit(page).getByRole('button', { name: 'Escolher linhas do trecho 1 de README.md' }).click()
  const lines = commit(page).getByRole('group', { name: 'Linhas do trecho 1 de README.md' })
  await expect(lines.getByRole('checkbox')).toHaveCount(3)
  expect(await a11y(page)).toEqual([])
  await lines.getByRole('checkbox', { name: 'Incluir a linha nova "linha um"' }).click({ force: true })
  await lines.getByRole('checkbox', { name: 'Incluir a linha nova "linha três"' }).click({ force: true })
  const hunk = commit(page).getByRole('checkbox', { name: /^Incluir o trecho 1 de README\.md/ })
  await expect.poll(() => hunk.evaluate((el) => (el as HTMLInputElement).indeterminate)).toBe(true)

  await commit(page).getByLabel('Mensagem do commit').fill('readme: só a linha dois')
  await commit(page).getByRole('button', { name: 'Commit', exact: true }).click()
  await expect(page.getByText(/Commit [0-9a-f]{7} criado/)).toBeVisible()
  const committed = fx.git(dir, 'show', 'HEAD:README.md')
  expect(committed).toContain('linha dois')
  expect(committed).not.toContain('linha um')
  expect(committed).not.toContain('linha três')
  expect(fx.read(dir, 'README.md')).toContain('linha três')
})
