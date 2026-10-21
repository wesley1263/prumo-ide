// F12 Commitar (e o diff, S21). Push ainda não existe: os casos de push estão bloqueados no plano.
import { chmodSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, openProject, openFile, cursorAt, a11y, mod } from './helpers'

const panel = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'Commit' })

async function openCommit(page: import('@playwright/test').Page) {
  if (!(await panel(page).isVisible())) await page.keyboard.press('Alt+0')
  await expect(panel(page)).toBeVisible()
}

test.describe('F12 commit', () => {
  test('F12-H1 commit só dos arquivos marcados; não versionado fica de fora por padrão', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir)
    await openCommit(page)
    await expect(panel(page).getByRole('checkbox', { name: /Incluir internal\/catalog\/catalog\.go/ })).toBeChecked()
    await expect(panel(page).getByRole('checkbox', { name: /Incluir NOTES\.md/ })).not.toBeChecked()
    await panel(page).getByLabel('Mensagem do commit').fill('catálogo: conta produtos')
    await panel(page).getByRole('button', { name: 'Commit', exact: true }).click()
    await expect(page.getByText(/Commit [0-9a-f]{7} criado/)).toBeVisible()
    expect(fx.git(dir, 'log', '-1', '--format=%s')).toBe('catálogo: conta produtos')
    expect(fx.git(dir, 'status', '--porcelain')).toBe('?? NOTES.md')
    await expect(panel(page).getByText('Não versionados')).toBeVisible()
  })

  test('F12-E1 sem mensagem o botão Commit fica desligado', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await openCommit(page)
    await panel(page).getByLabel('Mensagem do commit').fill('   ')
    await expect(panel(page).getByRole('button', { name: 'Commit', exact: true })).toBeDisabled()
  })

  test('F12-E2 duplo clique no Commit cria um commit só', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir)
    await openCommit(page)
    await panel(page).getByLabel('Mensagem do commit').fill('uma vez')
    await panel(page).getByRole('button', { name: 'Commit', exact: true }).dblclick()
    await expect(page.getByText(/Commit [0-9a-f]{7} criado/).first()).toBeVisible()
    await page.waitForTimeout(1000)
    expect(fx.git(dir, 'rev-list', '--count', 'HEAD')).toBe('2')
  })

  test('F12-E3 marcar o não versionado inclui o arquivo novo', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir)
    await openCommit(page)
    await panel(page).getByRole('checkbox', { name: /Incluir NOTES\.md/ }).check({ force: true }) // input do React Aria é visualmente oculto
    await panel(page).getByLabel('Mensagem do commit').fill('notas')
    await panel(page).getByRole('button', { name: 'Commit', exact: true }).click()
    await expect(page.getByText(/Commit [0-9a-f]{7} criado/)).toBeVisible()
    expect(fx.git(dir, 'status', '--porcelain')).toBe('')
    await expect(panel(page).getByText('Nada para commitar')).toBeVisible()
  })

  test('F12-E4 emendar o último commit troca a mensagem sem criar outro', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir)
    await openCommit(page)
    await panel(page).getByText('Emendar o último commit').click()
    await panel(page).getByLabel('Mensagem do commit').fill('catálogo e carrinho, revisado')
    await panel(page).getByRole('button', { name: 'Commit', exact: true }).click()
    await expect(page.getByText(/Commit [0-9a-f]{7} criado/)).toBeVisible()
    expect(fx.git(dir, 'rev-list', '--count', 'HEAD')).toBe('1')
    expect(fx.git(dir, 'log', '-1', '--format=%s')).toBe('catálogo e carrinho, revisado')
  })

  test('F12-E5 mensagem com acentos, emoji e várias linhas é preservada', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir)
    await openCommit(page)
    const msg = 'Ação: preço em reais ☕🚀\n\nCorpo com coração.'
    await panel(page).getByLabel('Mensagem do commit').fill(msg)
    await page.keyboard.press(`${mod}+Enter`)
    await expect(page.getByText(/Commit [0-9a-f]{7} criado/)).toBeVisible()
    expect(fx.git(dir, 'log', '-1', '--format=%B')).toBe(msg)
  })

  test('F12-N1 hook de pre-commit que falha mostra o motivo e não commita', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(dir, '.git/hooks/pre-commit', '#!/bin/sh\necho "lint reprovou: faltou teste" >&2\nexit 1\n')
    chmodSync(join(dir, '.git/hooks/pre-commit'), 0o755)
    await openProject(page, dir)
    await openCommit(page)
    await panel(page).getByLabel('Mensagem do commit').fill('não vai')
    await panel(page).getByRole('button', { name: 'Commit', exact: true }).click()
    await expect(page.getByRole('alert').getByText(/lint reprovou: faltou teste/)).toBeVisible()
    expect(fx.git(dir, 'rev-list', '--count', 'HEAD')).toBe('1')
    await expect(panel(page).getByLabel('Mensagem do commit')).toHaveValue('não vai') // a mensagem não se perde
  })

  test('F12-E6 arquivo apagado aparece e entra no commit', async ({ page, fx }) => {
    const dir = fx.seed()
    rmSync(join(dir, 'README.md'))
    await openProject(page, dir)
    await openCommit(page)
    await expect(panel(page).getByRole('checkbox', { name: /Incluir README\.md \(apagado\)/ })).toBeChecked()
    await panel(page).getByLabel('Mensagem do commit').fill('remove readme')
    await panel(page).getByRole('button', { name: 'Commit', exact: true }).click()
    await expect(page.getByText(/Commit [0-9a-f]{7} criado/)).toBeVisible()
    expect(fx.git(dir, 'ls-files', 'README.md')).toBe('')
  })

  test('F12-E7 commit com edição não salva salva antes e commita o texto do editor', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir)
    await openFile(page, 'README.md')
    await cursorAt(page, 'IDE.')
    await page.keyboard.type(' Editado.')
    await openCommit(page)
    await panel(page).getByLabel('Mensagem do commit').fill('readme')
    await panel(page).getByRole('checkbox', { name: /Incluir README\.md/ }).check({ force: true })
    await panel(page).getByRole('button', { name: 'Commit', exact: true }).click()
    await expect(page.getByText(/Commit [0-9a-f]{7} criado/)).toBeVisible()
    expect(fx.git(dir, 'show', 'HEAD:README.md')).toContain('IDE. Editado.')
  })

  test('F12-N2 modo restrito: commit pede confiança', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir, { trust: false })
    await openCommit(page)
    await panel(page).getByLabel('Mensagem do commit').fill('x')
    await panel(page).getByRole('button', { name: 'Commit', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Confiar neste projeto?' })).toBeVisible()
    expect(fx.git(dir, 'rev-list', '--count', 'HEAD')).toBe('1')
  })

  test('F12-H2 duplo clique no arquivo abre o diff com as linhas adicionadas', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await openCommit(page)
    await panel(page).getByRole('button', { name: /^catalog\.go/ }).dblclick()
    await expect(page.getByRole('tab', { name: 'catalog.go (diff)', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.monaco-diff-editor .line-insert').first()).toBeVisible()
  })

  test('F12-A11Y janela de commit sem violações', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await openCommit(page)
    expect(await a11y(page)).toEqual([])
  })

  test('F12-H8 histórico de mensagens: reusar uma mensagem anterior', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir)
    await openCommit(page)
    await panel(page).getByLabel('Mensagem do commit').fill('catálogo: Count')
    await panel(page).getByRole('button', { name: 'Commit', exact: true }).click()
    await expect(page.getByText(/Commit [0-9a-f]{7} criado/)).toBeVisible()
    fx.write(dir, 'README.md', '# outra coisa\n')
    await panel(page).getByRole('button', { name: 'Atualizar' }).click()
    await panel(page).getByRole('button', { name: 'Mensagens recentes' }).click()
    await page.getByRole('menuitem', { name: 'catálogo: Count' }).click()
    await expect(panel(page).getByLabel('Mensagem do commit')).toHaveValue('catálogo: Count')
  })
})
