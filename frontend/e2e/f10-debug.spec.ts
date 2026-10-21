// F10 Debugar um bug: breakpoint no gutter, depurar pelo ▶, variáveis, avaliar, stepping, continuar até o fim.
import { test, expect, openProject, openFile, cursorAt, mod, a11y } from './helpers'
import type { Page } from '@playwright/test'

const bpLine = 35 // "total += l.Product.Price * l.Qty" em internal/cart/cart.go

const lineNumber = (page: Page, n: number) => page.locator('.monaco-editor .line-numbers').filter({ hasText: new RegExp(`^${n}$`) })
const dbg = (page: Page) => page.getByRole('region', { name: 'Depurar' })

async function toggleBreakpoint(page: Page, line: number) {
  const before = await page.locator('.goide-bp').count()
  await lineNumber(page, line).click()
  await expect(page.locator('.goide-bp')).toHaveCount(before === 0 ? 1 : 0)
}

async function debugFromGutter(page: Page, label: RegExp, glyph = 0) {
  await page.locator('.goide-run-glyph').nth(glyph).click({ button: 'right' })
  await page.getByRole('menu', { name: 'Rodar ou depurar' }).getByRole('menuitem', { name: label }).click()
}

test.describe('F10 depurar', () => {
  test('F10-H1 breakpoint, parar, variáveis, avaliar, continuar e terminar', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await openFile(page, 'internal/cart/cart.go')
    await toggleBreakpoint(page, bpLine)

    await openFile(page, 'cmd/shop/main.go')
    await debugFromGutter(page, /^Depurar( |$)/)

    // Parou no breakpoint: a janela abre, o editor vai para cart.go e a linha fica destacada.
    await expect(dbg(page).getByText(/parado \(breakpoint\)/)).toBeVisible({ timeout: 90_000 })
    await expect(page.getByRole('tab', { name: 'cart.go', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.goide-exec-line')).toHaveCount(1)
    const vars = dbg(page).getByRole('tree', { name: 'Variáveis' })
    await expect(vars.getByRole('treeitem', { name: /^total = 0/ })).toBeVisible()
    // Valores no próprio editor, no fim das linhas da função até a linha atual.
    // (o Monaco desenha os espaços como &nbsp;: \s na regex)
    await expect(page.locator('.monaco-editor .goide-inline-value').filter({ hasText: /total\s=\s0/ }).first()).toBeVisible()
    await expect(dbg(page).getByRole('listbox', { name: 'Quadros da pilha' }).getByRole('option').first()).toContainText('Total')

    // Avaliar uma expressão no quadro.
    const evalBox = dbg(page).getByLabel('Avaliar expressão')
    await evalBox.fill('l.Product.Name')
    await evalBox.press('Enter')
    await expect(dbg(page).getByRole('list', { name: 'Resultados' })).toContainText('Café torrado 500g')

    // Expandir uma struct.
    await vars.getByRole('treeitem', { name: /^l = / }).click()
    await expect(vars.getByRole('treeitem', { name: /^Qty = 1/ })).toBeVisible()

    // F9: segunda volta do loop, total já somou o café.
    await page.keyboard.press('F9')
    await expect(vars.getByRole('treeitem', { name: /^total = 3490/ })).toBeVisible({ timeout: 30_000 })

    // Tira o breakpoint com a sessão viva e continua até o fim.
    await toggleBreakpoint(page, bpLine)
    await page.keyboard.press('F9')
    await expect(dbg(page).getByText(/encerrado/)).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.monaco-editor .goide-inline-value')).toHaveCount(0) // somem ao terminar
    await dbg(page).getByRole('tab', { name: 'Console' }).click()
    await expect(dbg(page).getByRole('log')).toContainText('Total: R$ 93,90')
    await expect(page.locator('.goide-exec-line')).toHaveCount(0)
  })

  test('F10-H2 F8 passa para a próxima linha', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await openFile(page, 'internal/cart/cart.go')
    await toggleBreakpoint(page, 33) // "total := 0"
    await openFile(page, 'cmd/shop/main.go')
    await debugFromGutter(page, /^Depurar( |$)/)
    await expect(dbg(page).getByText(/parado/)).toBeVisible({ timeout: 90_000 })
    await expect(page.getByRole('contentinfo').getByText('33:1')).toBeVisible()
    await page.keyboard.press('F8')
    await expect(page.getByRole('contentinfo').getByText(/^34:/)).toBeVisible({ timeout: 30_000 })
    await page.keyboard.press(`${mod}+F2`)
    await expect(dbg(page).getByText(/encerrado/)).toBeVisible({ timeout: 30_000 })
  })

  test('F10-E1 breakpoint acompanha a edição e sobrevive a recarregar', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir)
    await openFile(page, 'internal/cart/cart.go')
    await toggleBreakpoint(page, bpLine)
    // Uma linha nova acima: o breakpoint desce junto.
    await cursorAt(page, 'func (c *Cart) Total() int {', 'before')
    await page.keyboard.press('Enter')
    // A linha nova vai para o banco numa chamada à parte, logo depois de gravar: espera ela antes de recarregar.
    const moved = page.waitForResponse((r) => r.url().endsWith('/bridge/rpc') && (r.request().postData() ?? '').includes('Breakpoints.Move'))
    await page.keyboard.press(`${mod}+s`)
    await expect(lineNumber(page, bpLine + 1)).toHaveClass(/goide-bp/)
    await moved
    await page.reload()
    await page.getByRole('list', { name: 'Projetos recentes' }).getByRole('button', { name: new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click()
    await openFile(page, 'internal/cart/cart.go')
    await expect(lineNumber(page, bpLine + 1)).toHaveClass(/goide-bp/)
    await expect(page.locator('.goide-bp')).toHaveCount(1)
  })

  test('F10-E2 depurar um teste pelo ▶ do gutter', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await openFile(page, 'internal/cart/cart.go')
    await toggleBreakpoint(page, bpLine)
    await openFile(page, 'internal/cart/cart_test.go')
    await debugFromGutter(page, /^Depurar TestTotal( |$)/, 1) // [0] = linha package (todos os testes)
    await expect(dbg(page).getByText(/parado \(breakpoint\)/)).toBeVisible({ timeout: 90_000 })
    await expect(dbg(page).getByRole('listbox', { name: 'Quadros da pilha' })).toContainText('TestTotal')
    await page.keyboard.press(`${mod}+F2`)
    await expect(dbg(page).getByText(/encerrado/)).toBeVisible({ timeout: 30_000 })
  })

  test('F10-H7 Alt+F9 roda até o cursor; o breakpoint temporário não fica', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await openFile(page, 'cmd/shop/main.go')
    await toggleBreakpoint(page, 11) // var c cart.Cart
    await debugFromGutter(page, /^Depurar( |$)/)
    await expect(dbg(page).getByText(/parado \(breakpoint\)/)).toBeVisible({ timeout: 90_000 })

    // Cursor no "return total" do cart.go (o Total é chamado duas vezes no Printf).
    await openFile(page, 'internal/cart/cart.go')
    await cursorAt(page, 'return total', 'before')
    await page.keyboard.press('Alt+F9')
    await expect(dbg(page).getByText(/parado/)).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.goide-exec-line')).toHaveCount(1)
    await expect(dbg(page).getByRole('tree', { name: 'Variáveis' }).getByRole('treeitem', { name: /^total = 9390/ })).toBeVisible()
    // Sem marca de breakpoint no cursor e, continuando, a segunda chamada do Total não para.
    await expect(page.locator('.goide-bp')).toHaveCount(0)
    await page.keyboard.press('F9')
    await expect(dbg(page).getByText(/encerrado/)).toBeVisible({ timeout: 30_000 })
  })

  test('F10-N1 modo restrito: depurar pede confiança', async ({ page, fx }) => {
    await openProject(page, fx.seed(), { trust: false })
    await openFile(page, 'cmd/shop/main.go')
    await debugFromGutter(page, /^Depurar( |$)/)
    await expect(page.getByRole('dialog', { name: 'Confiar neste projeto?' })).toBeVisible()
  })

  test('F10-A11Y janela Depurar parada sem violações', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await openFile(page, 'internal/cart/cart.go')
    await toggleBreakpoint(page, bpLine)
    await openFile(page, 'cmd/shop/main.go')
    await debugFromGutter(page, /^Depurar( |$)/)
    await expect(dbg(page).getByText(/parado/)).toBeVisible({ timeout: 90_000 })
    await expect(dbg(page).getByRole('tree', { name: 'Variáveis' }).getByRole('treeitem').first()).toBeVisible()
    expect(await a11y(page)).toEqual([])
  })
})
