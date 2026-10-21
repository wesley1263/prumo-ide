// S28 Configurações: busca, rascunho com Aplicar/OK/Cancelar, validação, efeito no editor, no salvar e no terminal.
import { test, expect, openProject, openFile, a11y, mod, API, token } from './helpers'
import type { Page } from '@playwright/test'

const dlg = (page: Page) => page.getByRole('dialog', { name: 'Configurações' })
const nav = (page: Page) => dlg(page).getByRole('navigation', { name: 'Categorias' })

async function openSettings(page: Page, page_?: string) {
  await page.keyboard.press(`${mod}+Alt+S`)
  await expect(dlg(page)).toBeVisible()
  if (page_) await nav(page).getByRole('button', { name: page_ }).click()
}

// Volta tudo ao padrão depois de cada teste, mesmo se ele falhar no meio.
test.afterEach(async () => {
  const defaults: Record<string, unknown> = { 'appearance.theme': 'dark', 'appearance.language': 'system', 'editor.fontSize': 13, 'editor.formatOnSave': true, 'editor.inlayHints': true, 'terminal.shell': '', 'commit.format': false, 'commit.vet': false, 'commit.tests': false, 'keymap.overrides': {} }
  for (const [k, v] of Object.entries(defaults)) {
    await fetch(`${API}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goide-Token': token() },
      body: JSON.stringify({ method: 'Settings.Set', args: [k, v] }),
    })
  }
})

test.describe.configure({ mode: 'serial' })

test.describe('F28 configurações', () => {
  test('F28-H1 tema: Aplicar, Cancelar descarta, vale depois de recarregar', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await openSettings(page)
    expect(await a11y(page)).toEqual([])
    await dlg(page).getByRole('radio', { name: 'Claro' }).click({ force: true })
    await expect(dlg(page)).toContainText('Alterações não aplicadas')
    // Cancelar: nada muda.
    await dlg(page).getByRole('button', { name: 'Cancelar' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    await openSettings(page)
    await dlg(page).getByRole('radio', { name: 'Claro' }).click({ force: true })
    await dlg(page).getByRole('button', { name: 'Aplicar' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect(dlg(page).getByRole('button', { name: 'Aplicar' })).toBeDisabled()
    await dlg(page).getByRole('button', { name: 'OK' }).click()
    await expect(dlg(page)).toBeHidden()

    // Recarregar volta à tela inicial: o tema gravado vale lá também, e o botão Configurações abre o diálogo.
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.getByRole('button', { name: 'Configurações' }).click()
    await expect(dlg(page).getByRole('radio', { name: 'Claro' })).toBeChecked()
    await dlg(page).getByRole('radio', { name: 'Escuro' }).click({ force: true })
    await dlg(page).getByRole('button', { name: 'OK' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })

  test('F28-H2 busca nas configurações e lista de atalhos', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await openSettings(page)
    const search = dlg(page).getByLabel('Buscar nas configurações')
    await search.fill('inlay')
    await expect(nav(page).getByRole('button')).toHaveText(['Editor'])
    await expect(dlg(page).locator('mark', { hasText: 'inlay' })).toBeVisible()
    await search.fill('zzqq')
    await expect(dlg(page)).toContainText('Nada encontrado para "zzqq".')
    // Ações também entram na busca (página Atalhos).
    await search.fill('commit')
    await expect(nav(page).getByRole('button', { name: 'Atalhos' })).toBeVisible()
    await nav(page).getByRole('button', { name: 'Atalhos' }).click()
    await expect(dlg(page).getByRole('row', { name: /Commit\s+Ctrl\+K/ })).toBeVisible()

    await search.fill('')
    await nav(page).getByRole('button', { name: 'Ferramentas' }).click()
    await expect(dlg(page).getByRole('listitem').filter({ hasText: 'gopls' }).getByLabel('encontrado', { exact: true })).toBeVisible()
    await nav(page).getByRole('button', { name: 'Go' }).click()
    await expect(dlg(page).getByRole('radiogroup', { name: 'Go SDK padrão' }).getByRole('radio', { checked: true })).toHaveCount(1)
  })

  test('F28-H3 fonte do editor: valor inválido segura o OK; válido aplica sem recriar o editor', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await openFile(page, 'cmd/shop/main.go')
    await openSettings(page, 'Editor')
    const size = dlg(page).getByLabel('Tamanho da fonte')
    await size.fill('40')
    await expect(dlg(page)).toContainText('Use um número inteiro entre 9 e 32.')
    await dlg(page).getByRole('button', { name: 'OK' }).click()
    await expect(dlg(page)).toBeVisible()
    await size.fill('17')
    await dlg(page).getByRole('button', { name: 'OK' }).click()
    await expect(dlg(page)).toBeHidden()
    await expect.poll(() => page.evaluate(() => (window as any).__goideEditor.getRawOptions().fontSize)).toBe(17)
  })

  test('F28-H4 formatar ao salvar desligado: Ctrl+S grava como está', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir)
    await openFile(page, 'cmd/shop/main.go')
    await openSettings(page, 'Editor')
    await dlg(page).getByRole('checkbox', { name: /Formatar e organizar imports/ }).click({ force: true })
    await dlg(page).getByRole('button', { name: 'OK' }).click()
    await expect(dlg(page)).toBeHidden() // o diálogo devolve o foco ao fechar: só depois focar o editor
    await page.evaluate(() => {
      const ed = (window as any).__goideEditor
      const m = ed.getModel()
      ed.setPosition({ lineNumber: m.getLineCount(), column: 1 })
      ed.focus()
    })
    await page.keyboard.type('func   feio(){}\n')
    await page.keyboard.press(`${mod}+S`)
    await expect.poll(() => fx.read(dir, 'cmd/shop/main.go')).toContain('func   feio(){}')
  })

  test('F28-H5 shell do terminal: inexistente mostra o erro; válido vale para terminais novos', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await openSettings(page, 'Terminal')
    const shell = dlg(page).getByLabel('Shell')
    await shell.fill('/nao/existe/zsh')
    await dlg(page).getByRole('button', { name: 'OK' }).click()
    await expect(dlg(page)).toContainText('shell não encontrado: /nao/existe/zsh')
    await shell.fill('/bin/sh')
    await dlg(page).getByRole('button', { name: 'OK' }).click()
    await expect(dlg(page)).toBeHidden()

    await page.keyboard.press('Alt+F12')
    await page.locator('[data-terminal]:not(.hidden) .xterm-helper-textarea').focus()
    await page.keyboard.type('echo "shell=$0"')
    await page.keyboard.press('Enter')
    await expect.poll(() => page.locator('[data-terminal]:not(.hidden) .xterm-rows').innerText()).toContain('shell=/bin/sh')

    // Volta ao padrão.
    await openSettings(page, 'Terminal')
    await dlg(page).getByLabel('Shell').fill('')
    await dlg(page).getByRole('button', { name: 'OK' }).click()
  })

  test('F28-H6 trocar um atalho: vale na hora, conflito avisa, restaurar', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await openSettings(page, 'Atalhos')
    await dlg(page).getByLabel('Filtrar ações').fill('Commit')
    await dlg(page).getByRole('button', { name: 'Alterar o atalho de Commit' }).click()
    await page.keyboard.press('Control+Alt+J')
    await expect(dlg(page).getByRole('row', { name: /^Commit\s+Ctrl\+Alt\+J\s*\(alterado\)/ })).toBeVisible()
    // Conflito: Ctrl+Alt+S é das Configurações.
    await dlg(page).getByLabel('Filtrar ações').fill('Push')
    await dlg(page).getByRole('button', { name: 'Alterar o atalho de Push' }).click()
    await page.keyboard.press('Control+Alt+J')
    await expect(dlg(page)).toContainText('Ctrl+Alt+J já é de "Commit"')
    await dlg(page).getByRole('button', { name: 'Cancelar', exact: true }).first().click()
    await dlg(page).getByRole('button', { name: 'OK' }).click()

    // O atalho novo abre o Commit; o antigo (Ctrl+K) não abre mais.
    await page.keyboard.press('Control+K')
    await expect(page.getByRole('region', { name: 'Commit' })).toBeHidden()
    await page.keyboard.press('Control+Alt+J')
    await expect(page.getByRole('region', { name: 'Commit' })).toBeVisible()

    await openSettings(page, 'Atalhos')
    await dlg(page).getByRole('button', { name: 'Restaurar todos' }).click()
    await expect(dlg(page).getByText('(alterado)')).toHaveCount(0)
  })

  test('F28-H7 idioma: pt-BR segue o sistema (Monaco traduzido); English recarrega em inglês', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await openFile(page, 'internal/cart/cart.go')
    const box = async () => (await page.locator('.monaco-editor .view-lines').first().boundingBox())!
    // Sistema em pt-BR (locale do teste): o menu do Monaco vem com a tradução dele.
    let b = await box()
    await page.mouse.click(b.x + 120, b.y + 200, { button: 'right' })
    await expect(page.locator('.monaco-menu').getByText('Ir para definição', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')

    await openSettings(page, 'Aparência')
    await expect(dlg(page).getByRole('radio', { name: 'Seguir o sistema' })).toBeChecked()
    await dlg(page).getByRole('radio', { name: 'English' }).click({ force: true })
    await dlg(page).getByRole('button', { name: 'OK' }).click()
    // A janela recarrega em inglês: o rótulo traduzido e o Monaco no original dele.
    await page.waitForEvent('load')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await page.getByRole('list', { name: 'Recent projects' }).getByRole('button').first().click()
    // Em inglês a árvore se chama "Project files" (o openFile procura o nome em português).
    const tree = page.getByRole('tree', { name: 'Project files' })
    for (const d of ['internal', 'cart']) await tree.getByRole('treeitem', { name: d, exact: true }).click()
    await tree.getByRole('treeitem', { name: 'cart.go', exact: true }).dblclick()
    b = await box()
    await page.mouse.click(b.x + 120, b.y + 200, { button: 'right' })
    await expect(page.locator('.monaco-menu').getByText('Go to Definition')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.keyboard.press(`${mod}+Alt+S`)
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('navigation', { name: 'Categories' }).getByRole('button', { name: 'Appearance' }).click()
    await expect(settings.getByRole('radiogroup', { name: 'Language' })).toBeVisible()
  })
})
