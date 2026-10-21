// F01 Abrir um projeto Go existente e começar a editar.
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, openProject, openFile, a11y, mod } from './helpers'

test.describe('F01 abrir projeto', () => {
  test('F01-H1 abrir, confiar e ver a árvore com o gopls pronto', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir)
    const tree = page.getByRole('tree', { name: 'Arquivos do projeto' })
    await expect(tree.getByRole('treeitem', { name: 'cmd', exact: true })).toBeVisible()
    await expect(page.getByRole('banner').getByText('demo-shop')).toBeVisible()
    await expect(page.getByRole('contentinfo').getByText(/^go1\./)).toBeVisible()
  })

  test('F01-E1 modo restrito: sem gopls, e rodar pede confiança', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir, { trust: false })
    await expect(page.getByText('Modo restrito: análise de código, execução e commit estão desligados')).toBeVisible()
    await expect(page.getByRole('contentinfo').getByText('Modo restrito')).toBeVisible()
    await openFile(page, 'cmd/shop/main.go')
    await page.keyboard.press('Shift+F10') // sem configuração ainda: só avisa
    await page.locator('.goide-run-glyph').first().click()
    await expect(page.getByRole('dialog', { name: 'Confiar neste projeto?' })).toBeVisible()
  })

  test('F01-N1 caminho que não existe mostra erro no diálogo', async ({ page, fx }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Abrir', exact: true }).first().click()
    await page.getByLabel('Caminho da pasta').fill(join(fx.base, 'nao-existe'))
    await page.getByLabel('Caminho da pasta').press('Enter')
    await expect(page.getByText(/pasta não encontrada/)).toBeVisible()
  })

  test('F01-N2 caminho de um arquivo (não pasta) mostra erro', async ({ page, fx }) => {
    const dir = fx.seed()
    await page.goto('/')
    await page.getByRole('button', { name: 'Abrir', exact: true }).first().click()
    await page.getByLabel('Caminho da pasta').fill(join(dir, 'go.mod'))
    await page.getByLabel('Caminho da pasta').press('Enter')
    await expect(page.getByText(/não é uma pasta/)).toBeVisible()
  })

  test('F01-E2 caminho vazio desliga o botão Abrir', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Abrir', exact: true }).first().click()
    const dlg = page.getByRole('dialog', { name: 'Abrir pasta' })
    await dlg.getByLabel('Caminho da pasta').fill('   ')
    await expect(dlg.getByRole('button', { name: 'Abrir' })).toBeDisabled()
  })

  test('F01-E3 pasta com acentos e emoji no nome', async ({ page, fx }) => {
    const dir = fx.seed('Café ☕ loja')
    await openProject(page, dir)
    await expect(page.getByRole('banner').getByText('Café ☕ loja')).toBeVisible()
    await openFile(page, 'cmd/shop/main.go')
    await page.locator('.goide-run-glyph').first().click()
    await expect(page.getByRole('log').getByText('Total: R$ 93,90')).toBeVisible({ timeout: 60_000 })
  })

  test('F01-E4 reabrir pela lista de recentes não pergunta confiança de novo', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir)
    await page.getByRole('button', { name: 'Menu principal' }).click()
    await page.getByRole('menuitem', { name: 'Fechar projeto' }).click()
    // Os testes rodam em paralelo e dividem a lista de recentes: clique no deste teste, pelo caminho.
    const recent = page.getByRole('list', { name: 'Projetos recentes' })
    await recent.getByRole('button', { name: new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click()
    await expect(page.getByRole('tree', { name: 'Arquivos do projeto' })).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Confiar neste projeto?' })).toBeHidden()
  })

  test('F01-E5 recente cuja pasta sumiu fica desligado e pode ser removido', async ({ page, fx }) => {
    const dir = fx.seed('sumiu')
    await openProject(page, dir)
    await page.getByRole('button', { name: 'Menu principal' }).click()
    await page.getByRole('menuitem', { name: 'Fechar projeto' }).click()
    rmSync(dir, { recursive: true, force: true })
    await page.reload()
    const recent = page.getByRole('list', { name: 'Projetos recentes' })
    const row = recent.getByRole('button', { name: /sumiu/ }).first()
    await expect(row).toBeDisabled()
    await expect(recent.getByText(/Pasta não encontrada/).first()).toBeVisible()
    await recent.getByRole('button', { name: 'Remover sumiu da lista' }).first().click()
    await expect(recent.getByText(/Pasta não encontrada: .*sumiu/)).toHaveCount(0)
  })

  test('F01-E6 só teclado: abrir pasta e confiar', async ({ page, fx }) => {
    const dir = fx.seed()
    await page.goto('/')
    await page.getByLabel('Buscar projetos recentes').waitFor()
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab')
      const name = await page.evaluate(() => document.activeElement?.textContent?.trim())
      if (name === 'Abrir') break
    }
    await page.keyboard.press('Enter')
    await expect(page.getByLabel('Caminho da pasta')).toBeFocused()
    await page.keyboard.type(dir) // o texto pré-preenchido vem selecionado: digitar substitui
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Confiar neste projeto?' })).toBeVisible()
    await page.keyboard.press('Enter') // foco inicial em "Confiar"
    await expect(page.getByRole('tree', { name: 'Arquivos do projeto' })).toBeVisible()
    await expect(page.getByRole('contentinfo').getByText('gopls pronto')).toBeVisible({ timeout: 60_000 })
  })

  test('F01-E9 caminho pré-preenchido vem selecionado: digitar substitui', async ({ page, fx }) => {
    const dir = fx.seed()
    await page.goto('/')
    await page.getByRole('button', { name: 'Abrir', exact: true }).first().click()
    const field = page.getByLabel('Caminho da pasta')
    await expect(field).toBeFocused()
    await page.keyboard.type(dir)
    await expect(field).toHaveValue(dir)
  })

  test('F01-E7 pasta sem go.mod e sem git abre normalmente', async ({ page, fx }) => {
    const dir = join(fx.base, 'solto')
    fx.write(dir, 'notas.txt', 'oi\n')
    await openProject(page, dir, { trust: false })
    await expect(page.getByRole('treeitem', { name: 'notas.txt', exact: true })).toBeVisible()
    await page.keyboard.press('Alt+0')
    await expect(page.getByText('Esta pasta não é um repositório git')).toBeVisible()
  })

  test('F01-E8 recarregar a página com projeto aberto volta para a tela inicial sem erro', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir)
    await page.reload()
    const mine = new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    await expect(page.getByRole('list', { name: 'Projetos recentes' }).getByRole('button', { name: mine })).toBeEnabled()
  })

  test('F01-A11Y tela inicial, diálogo de confiança e janela principal sem violações', async ({ page, fx }) => {
    const dir = fx.seed()
    await page.goto('/')
    await page.getByRole('button', { name: 'Abrir', exact: true }).first().waitFor()
    const s01 = await a11y(page)
    await page.getByRole('button', { name: 'Abrir', exact: true }).first().click()
    await page.getByLabel('Caminho da pasta').fill(dir)
    const openDlg = await a11y(page)
    await page.getByLabel('Caminho da pasta').press('Enter')
    await page.getByRole('dialog', { name: 'Confiar neste projeto?' }).waitFor()
    const trust = await a11y(page)
    await page.getByRole('button', { name: 'Confiar', exact: true }).click()
    await page.getByRole('tree', { name: 'Arquivos do projeto' }).waitFor()
    await openFile(page, 'cmd/shop/main.go')
    const s03 = await a11y(page)
    expect({ s01, openDlg, trust, s03 }).toEqual({ s01: [], openDlg: [], trust: [], s03: [] })
  })
})
