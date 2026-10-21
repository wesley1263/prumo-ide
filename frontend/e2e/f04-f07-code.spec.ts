// F04 Navegar · F06 Corrigir um problema · F07 Renomear com segurança.
import { test, expect, openProject, openFile, editorValue, cursorAt, mod } from './helpers'

test.describe('F04 navegar', () => {
  test('F04-H1 Ctrl+B leva à definição em outro arquivo do projeto', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await openFile(page, 'cmd/shop/main.go')
    await cursorAt(page, 'cart.Car')
    await page.keyboard.press(`${mod}+b`)
    await expect(page.getByRole('tab', { name: 'cart.go', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => editorValue(page)).toContain('type Cart struct')
  })

  test('F04-E1 definição na stdlib abre só leitura', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await openFile(page, 'cmd/shop/main.go')
    await cursorAt(page, 'fmt.Print')
    await page.keyboard.press(`${mod}+b`)
    await expect(page.getByText('Arquivo de fora do projeto, aberto só para leitura.')).toBeVisible()
    await expect.poll(() => editorValue(page)).toContain('func Printf(')
    const before = await editorValue(page)
    await page.keyboard.type('xyz')
    expect(await editorValue(page)).toBe(before)
  })

  test('F04-E2 Alt+F7 lista os usos de um método', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await openFile(page, 'internal/cart/cart.go')
    await cursorAt(page, 'func (c *Cart) Tot')
    await page.keyboard.press('Alt+F7')
    // Janela de usos (S09): declaração e leituras, por arquivo.
    const usages = page.getByRole('tree', { name: 'Usos de Total' })
    await expect(usages.getByRole('treeitem', { name: /^cmd\/shop\/main\.go linha \d+/ }).first()).toBeVisible({ timeout: 30_000 })
  })
})

test.describe('F06 corrigir', () => {
  test('F06-H1 Alt+Enter preenche os campos de um struct literal', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(dir, 'internal/catalog/novo.go', 'package catalog\n\nvar destaque = Product{}\n')
    await openProject(page, dir)
    await openFile(page, 'internal/catalog/novo.go')
    await cursorAt(page, 'Product{')
    await page.keyboard.press('Alt+Enter')
    const item = page.locator('.action-widget').getByText(/Fill/).first()
    await expect(item).toBeVisible()
    await item.click()
    await expect.poll(() => editorValue(page)).toContain('SKU:')
  })
})

test.describe('F07 renomear', () => {
  test('F07-H1 Shift+F6 renomeia em todos os arquivos e Ctrl+S salva tudo', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir)
    await openFile(page, 'internal/cart/cart.go')
    await cursorAt(page, 'func (c *Cart) Tot')
    await page.keyboard.press('Shift+F6')
    await expect(page.getByLabel(/^Renomear\. Digite o nome novo/)).toBeFocused() // chega depois do prepareRename do gopls
    await page.keyboard.press(`${mod}+a`)
    await page.keyboard.type('Sum')
    await page.keyboard.press('Enter')
    // Mexe em 3 arquivos: a prévia mostra antes de aplicar.
    const preview = page.getByRole('dialog', { name: 'Renomear Total para Sum' })
    await expect(preview).toContainText('em 3 arquivos')
    await preview.getByRole('button', { name: 'Renomear' }).click()
    await expect.poll(() => editorValue(page)).toContain('func (c *Cart) Sum()')
    await page.keyboard.press(`${mod}+s`)
    await expect.poll(() => fx.read(dir, 'cmd/shop/main.go')).toContain('c.Sum()')
    await expect.poll(() => fx.read(dir, 'internal/cart/cart_test.go')).toContain('c.Sum()')
    expect(fx.read(dir, 'internal/cart/cart.go')).toContain('func (c *Cart) Sum()')
  })

  test('F07-N1 nome inválido é recusado sem mudar nada', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir)
    await openFile(page, 'internal/cart/cart.go')
    const before = await editorValue(page)
    await cursorAt(page, 'func (c *Cart) Tot')
    await page.keyboard.press('Shift+F6')
    await expect(page.getByLabel(/^Renomear\. Digite o nome novo/)).toBeFocused()
    await page.keyboard.press(`${mod}+a`)
    await page.keyboard.type('1nope')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('status').filter({ hasText: 'Não foi possível renomear' })).toContainText('invalid identifier')
    expect(await editorValue(page)).toBe(before)
  })
})
