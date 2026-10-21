// Stash: guardar (com os arquivos novos), a árvore volta ao commit, recuperar com "Aplicar e remover".
import { test, expect, openProject, openFile, editorValue, a11y } from './helpers'
import type { Page } from '@playwright/test'

const commit = (page: Page) => page.getByRole('region', { name: 'Commit' })

test('F13-H4 guardar em stash e recuperar', async ({ page, fx }) => {
  const dir = fx.seed()
  await openProject(page, dir)
  await openFile(page, 'internal/catalog/catalog.go')
  expect(await editorValue(page)).toContain('func Count()')
  await page.keyboard.press('Alt+0')
  await commit(page).getByRole('button', { name: 'Guardar (stash)…' }).click()
  const save = page.getByRole('dialog', { name: 'Guardar mudanças (stash)' })
  await save.getByLabel('Descrição').fill('contagem e notas')
  await save.getByRole('checkbox', { name: /Incluir os arquivos novos/ }).click({ force: true })
  expect(await a11y(page)).toEqual([])
  await save.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Mudanças guardadas')).toBeVisible()

  // Tudo limpo: o editor relê, o Commit fica vazio, o NOTES.md (novo) também foi guardado.
  await expect(commit(page)).toContainText('Nada para commitar')
  await expect.poll(() => editorValue(page)).not.toContain('func Count()')
  expect(fx.git(dir, 'status', '--porcelain')).toBe('')

  await commit(page).getByRole('button', { name: 'Recuperar stash…' }).click()
  const restore = page.getByRole('dialog', { name: 'Recuperar stash' })
  await expect(restore.getByRole('list', { name: 'Stashes' })).toContainText('contagem e notas')
  await expect(restore).toContainText('em main · 2 arquivos')
  await restore.getByRole('button', { name: 'Aplicar e remover: contagem e notas' }).click()
  await expect(page.getByText('Stash aplicado e removido da pilha.')).toBeVisible()
  await expect.poll(() => editorValue(page)).toContain('func Count()')
  expect(fx.read(dir, 'NOTES.md')).toContain('TODO: frete')
  expect(fx.git(dir, 'stash', 'list')).toBe('')
})
