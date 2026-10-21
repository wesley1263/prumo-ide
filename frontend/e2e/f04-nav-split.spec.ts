// F04 navegação: janela de usos (S09) com leitura/escrita, Ctrl+U (super), prévia do rename e editor dividido.
import { test, expect, openProject, openFile, cursorAt, editorValue, a11y, mod } from './helpers'
import type { Page } from '@playwright/test'

const usages = (page: Page, name: string) => page.getByRole('tree', { name: `Usos de ${name}` })

test.describe('F04 navegação e divisão', () => {
  test('F04-H2 Alt+F7: declaração, escrita e leitura agrupadas; Enter abre', async ({ page, fx }) => {
    const dir = fx.seed()
    // total: declarado, escrito (+=) e lido (return).
    await openProject(page, dir)
    await openFile(page, 'internal/cart/cart.go')
    await cursorAt(page, 'total := ', 'before')
    await page.keyboard.press('Alt+F7')
    const tree = usages(page, 'total')
    await expect(tree).toBeVisible({ timeout: 30_000 })
    await expect(tree.getByRole('treeitem', { level: 1 })).toHaveText([/^Declaração\s*\(1\)/, /^Escrita\s*\(1\)/, /^Leitura\s*\(1\)/])
    await expect(page.getByRole('region', { name: 'Busca' }).getByRole('status')).toContainText('3 usos de total em 1 arquivo')
    expect(await a11y(page)).toEqual([])
    // Teclado: desce até a leitura e abre.
    await tree.focus()
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    const line = await page.evaluate(() => (window as any).__prumoEditor.getPosition().lineNumber)
    expect(fx.read(dir, 'internal/cart/cart.go').split('\n')[line - 1]).toContain('return total')
  })

  test('F04-H3 Ctrl+U salta do método para a interface', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(dir, 'internal/cart/totaler.go', 'package cart\n\n// Totaler é qualquer coisa que soma.\ntype Totaler interface {\n\tTotal() int\n}\n\nvar _ Totaler = (*Cart)(nil)\n')
    await openProject(page, dir)
    await openFile(page, 'internal/cart/cart.go')
    await cursorAt(page, 'func (c *Cart) Tot')
    await page.keyboard.press(`${mod}+u`)
    await expect(page.getByRole('tab', { name: 'totaler.go' })).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })
    const line = await page.evaluate(() => (window as any).__prumoEditor.getPosition().lineNumber)
    expect(line).toBe(5)
    // Num lugar sem interface: avisa.
    await openFile(page, 'cmd/shop/main.go')
    await cursorAt(page, 'func ma')
    await page.keyboard.press(`${mod}+u`)
    await expect(page.getByText('Nenhuma interface acima')).toBeVisible()
  })

  test('F07-H2 prévia do rename: cancelar não muda nada', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir)
    await openFile(page, 'internal/cart/cart.go')
    const before = await editorValue(page)
    await cursorAt(page, 'func (c *Cart) Tot')
    await page.keyboard.press('Shift+F6')
    await expect(page.getByLabel(/^Renomear\. Digite o nome novo/)).toBeFocused()
    await page.keyboard.press(`${mod}+a`)
    await page.keyboard.type('Soma')
    await page.keyboard.press('Enter')
    const preview = page.getByRole('dialog', { name: 'Renomear Total para Soma' })
    await expect(preview.getByRole('list', { name: 'Mudanças do rename' })).toContainText('cmd/shop/main.go')
    await expect(preview.getByLabel(/^depois: .*c\.Soma\(\)\/100/)).toBeVisible()
    expect(await a11y(page)).toEqual([])
    await preview.getByRole('button', { name: 'Cancelar' }).click()
    await expect(preview).toBeHidden()
    expect(await editorValue(page)).toBe(before)
    expect(fx.read(dir, 'cmd/shop/main.go')).toContain('c.Total()')
  })

  test('F04-H4 dividir à direita: mesmo arquivo nos dois lados, edição aparece nos dois; fechar a divisão', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await openFile(page, 'internal/cart/cart.go')
    await page.getByRole('button', { name: 'Dividir à direita' }).click()
    const right = page.getByRole('region', { name: 'Editor dividido' })
    await expect(right.getByRole('tab', { name: 'cart.go' })).toHaveAttribute('aria-selected', 'true')
    // Digitar à direita aparece à esquerda (mesmo modelo).
    await page.evaluate(() => {
      const ed = (window as any).__prumoSplitEditor
      ed.setPosition({ lineNumber: 1, column: 1 })
      ed.focus()
    })
    await page.keyboard.type('// dos dois lados\n')
    await expect.poll(() => editorValue(page)).toContain('// dos dois lados')
    // Esquerda e direita com arquivos diferentes.
    await openFile(page, 'cmd/shop/main.go')
    await expect(right.getByRole('tab', { name: /^cart\.go/ })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', { name: 'Dividir à direita' }).click()
    await expect(right.getByRole('tab')).toHaveCount(2)
    expect(await a11y(page)).toEqual([])
    // Alt+F7 no editor da direita usa o arquivo dele.
    await page.evaluate(() => {
      const ed = (window as any).__prumoSplitEditor
      const m = ed.getModel()
      const off = m.getValue().indexOf('c.Total()')
      ed.setPosition(m.getPositionAt(off + 3))
      ed.focus()
    })
    await page.keyboard.press('Alt+F7')
    await expect(usages(page, 'Total')).toBeVisible({ timeout: 30_000 })
    await right.getByRole('button', { name: 'Fechar a divisão' }).click()
    await expect(right).toBeHidden()
  })
})
