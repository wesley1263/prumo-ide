// F05 achar qualquer coisa: S06 Buscar em tudo e S07 Buscar/Substituir nos arquivos.
import { test, expect, openProject, openFile, cursorAt, editorValue, a11y, mod } from './helpers'
import type { Page } from '@playwright/test'

const everywhere = (page: Page) => page.getByRole('dialog', { name: 'Buscar em tudo' })
const findDlg = (page: Page) => page.getByRole('dialog', { name: /nos arquivos$/ })
const cursorLine = (page: Page) => page.evaluate(() => (window as any).__goideEditor.getPosition().lineNumber as number)
const activeTab = (page: Page, name: string) => expect(page.getByRole('tab', { name: new RegExp(`^${name.replace('.', '\\.')}(, não salvo)?$`) })).toHaveAttribute('aria-selected', 'true')

async function doubleShift(page: Page) {
  await page.keyboard.press('Shift')
  await page.keyboard.press('Shift')
}

test.describe('F05 Buscar em tudo', () => {
  test('F05-H1 Shift duas vezes, achar arquivo pelo nome e abrir na linha', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await doubleShift(page)
    const dlg = everywhere(page)
    await expect(dlg).toBeVisible()
    await expect(dlg.getByRole('tab', { name: 'Tudo' })).toHaveAttribute('aria-selected', 'true')
    const field = dlg.getByRole('combobox', { name: 'Buscar em tudo' })
    await expect(field).toBeFocused()

    await field.fill('cart')
    await expect(dlg.getByRole('option', { name: /^cart\.go, internal\/cart/ })).toBeVisible()
    expect(await a11y(page)).toEqual([])
    // "arquivo:linha" vai direto à linha.
    await field.fill('cart.go:22')
    await expect(dlg.getByRole('option').first()).toHaveAccessibleName(/^cart\.go, internal\/cart/)
    await field.press('Enter')
    await expect(dlg).toBeHidden()
    await activeTab(page, 'cart.go')
    await expect.poll(() => cursorLine(page)).toBe(22)

    // Vazio: arquivos recentes.
    await openFile(page, 'cmd/shop/main.go')
    await doubleShift(page)
    await expect(dlg.getByRole('group', { name: 'Arquivos' })).toContainText('Arquivos recentes')
    await expect(dlg.getByRole('option').first()).toHaveAccessibleName(/^cart\.go/) // o anterior vem primeiro
    await page.keyboard.press('Escape')
    await expect(dlg).toBeHidden()
  })

  test('F05-H2 símbolos do gopls e Tab entre abas', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await page.keyboard.press(`${mod}+Alt+Shift+N`)
    const dlg = everywhere(page)
    await expect(dlg.getByRole('tab', { name: 'Símbolos' })).toHaveAttribute('aria-selected', 'true')
    const field = dlg.getByRole('combobox')
    await field.fill('Total')
    const opt = dlg.getByRole('option', { name: /^(\S+\.)?Total, método · internal\/cart\/cart\.go:\d+/ })
    await expect(opt).toBeVisible({ timeout: 30_000 })
    await opt.click()
    await activeTab(page, 'cart.go')
    const line = await cursorLine(page)
    expect(fx.read(fx.base + '/demo-shop', 'internal/cart/cart.go').split('\n')[line - 1]).toContain('func (c *Cart) Total()')

    // Tab troca de aba sem perder a consulta.
    await page.keyboard.press(`${mod}+Shift+N`)
    await expect(dlg.getByRole('tab', { name: 'Arquivos' })).toHaveAttribute('aria-selected', 'true')
    await dlg.getByRole('combobox').fill('catalog')
    await dlg.getByRole('combobox').press('Tab')
    await expect(dlg.getByRole('tab', { name: 'Símbolos' })).toHaveAttribute('aria-selected', 'true')
    await expect(dlg.getByRole('combobox')).toHaveValue('catalog')
    await expect(dlg.getByRole('combobox')).toBeFocused()
  })

  test('F05-H3 ações: achar e executar', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await page.keyboard.press(`${mod}+Shift+A`)
    const dlg = everywhere(page)
    await dlg.getByRole('combobox').fill('commit')
    await expect(dlg.getByRole('option').first()).toHaveAccessibleName(/^Commit, Ctrl\+K|^Commit, ⌘K/)
    await dlg.getByRole('combobox').press('Enter')
    await expect(dlg).toBeHidden()
    await expect(page.getByRole('region', { name: 'Commit' })).toBeVisible()
  })

  test('F05-N1 sem resultado oferece buscar nos arquivos; digitar maiúsculas não abre o popup', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await openFile(page, 'internal/cart/cart.go')
    await cursorAt(page, '// Total devolve')
    // "AB": Shift, A, Shift, B. Dois Shifts, mas com letras no meio.
    await page.keyboard.press('Shift+A')
    await page.keyboard.press('Shift+B')
    await page.waitForTimeout(400)
    await expect(everywhere(page)).toBeHidden()
    await expect.poll(() => editorValue(page)).toContain('// Total devolveAB')

    await doubleShift(page)
    const dlg = everywhere(page)
    await dlg.getByRole('combobox').fill('zzqqxx')
    await expect(dlg).toContainText('Nada encontrado para "zzqqxx".')
    await dlg.getByRole('button', { name: /Buscar "zzqqxx" nos arquivos/ }).click()
    await expect(findDlg(page)).toBeVisible()
    await expect(findDlg(page).getByLabel('Texto a buscar')).toHaveValue('zzqqxx')
    await expect(findDlg(page).getByRole('status')).toContainText('0 ocorrências em 0 arquivos')
  })
})

test.describe('F05 Buscar nos arquivos', () => {
  test('F05-H4 buscar, navegar pelos resultados e abrir; texto não salvo entra na busca', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await openFile(page, 'internal/cart/cart.go')
    await cursorAt(page, '// Total devolve o total em centavos.')
    await page.keyboard.type(' freteGratis')

    await page.keyboard.press(`${mod}+Shift+F`)
    const dlg = findDlg(page)
    await expect(dlg.getByRole('heading', { name: 'Buscar nos arquivos' })).toBeVisible()
    const field = dlg.getByLabel('Texto a buscar')
    await field.fill('fretegratis')
    await expect(dlg.getByRole('status')).toContainText('1 ocorrência em 1 arquivo')
    await expect(dlg.getByRole('option')).toHaveAccessibleName(/cart\.go linha \d+$/)

    await field.fill('Total')
    await expect(dlg.getByRole('status')).toContainText(/\d+ ocorrências em 3 arquivos/)
    expect(await a11y(page)).toEqual([])
    // Diferenciar maiúsculas (Alt+C) e palavra inteira (Alt+W): "total :=" e "total +=" saem.
    await field.press('Alt+c')
    await expect(dlg.getByRole('button', { name: 'Diferenciar maiúsculas' })).toHaveAttribute('aria-pressed', 'true')
    await expect(dlg.getByRole('status')).toContainText(/ocorrências em 3 arquivos/)
    const n = Number((await dlg.getByRole('status').innerText()).match(/(\d+) ocorrências/)![1])
    expect(n).toBeGreaterThan(3)

    await field.press('ArrowDown')
    await expect(dlg.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true')
    const second = await dlg.getByRole('option').nth(1).getAttribute('aria-label')
    const [, file, line] = second!.match(/, (\S+) linha (\d+)$/)!
    await expect(dlg.getByText(new RegExp(`(^|/)${file.replace('.', '\\.')}$`))).toBeVisible() // a pré-visualização mostra o arquivo
    await field.press('Enter')
    await expect(dlg).toBeHidden()
    await activeTab(page, file)
    await expect.poll(() => cursorLine(page)).toBe(Number(line))
  })

  test('F05-H5 máscara, pasta e regex', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await page.keyboard.press(`${mod}+Shift+F`)
    const dlg = findDlg(page)
    const field = dlg.getByLabel('Texto a buscar')
    await field.fill('package')
    // "package" e "// Package ..." (sem diferenciar maiúsculas) nos 4 .go.
    await expect(dlg.getByRole('status')).toContainText('6 ocorrências em 4 arquivos')
    await dlg.getByLabel('Máscara de arquivo').fill('*.go, !*_test.go')
    await expect(dlg.getByRole('status')).toContainText('5 ocorrências em 3 arquivos')
    await dlg.getByRole('radio', { name: 'Pasta' }).click()
    await dlg.getByLabel('Pasta').fill('internal/cart')
    await expect(dlg.getByRole('status')).toContainText('2 ocorrências em 1 arquivo')
    await dlg.getByRole('radio', { name: 'Projeto' }).click()

    await field.fill('func \\(c \\*Cart\\) (\\w+)')
    await field.press('Alt+x')
    await expect(dlg.getByRole('status')).toContainText('2 ocorrências em 1 arquivo')
    await field.fill('func (')
    await expect(dlg.getByText(/expressão regular inválida/)).toBeVisible()
    await expect(field).toHaveAttribute('aria-invalid', 'true')
  })

  test('F05-H6 substituir uma e substituir tudo, com o editor aberto', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir)
    await openFile(page, 'internal/catalog/catalog.go')
    await page.keyboard.press(`${mod}+Shift+R`)
    const dlg = findDlg(page)
    await expect(dlg.getByRole('heading', { name: 'Substituir nos arquivos' })).toBeVisible()
    await dlg.getByLabel('Texto a buscar').fill('CAF-01')
    await dlg.getByLabel('Substituir por').fill('CAFE-01')
    await expect(dlg.getByRole('status')).toContainText('3 ocorrências em 3 arquivos')

    // Só a primeira (a lista vem em ordem de caminho: cmd/shop/main.go).
    await expect(dlg.getByRole('option').first()).toHaveAccessibleName(/main\.go linha/)
    await dlg.getByRole('button', { name: 'Substituir', exact: true }).click()
    await expect(page.getByText('1 ocorrência substituída em 1 arquivo')).toBeVisible()
    await expect(dlg.getByRole('status')).toContainText('2 ocorrências em 2 arquivos')
    expect(fx.read(dir, 'cmd/shop/main.go')).toContain('"CAFE-01", "CAN-02"')
    expect(fx.read(dir, 'internal/catalog/catalog.go')).toContain('"CAF-01"')

    await dlg.getByRole('button', { name: 'Substituir tudo' }).click()
    const confirm = page.getByRole('dialog', { name: 'Substituir tudo?' })
    await expect(confirm).toContainText('2 ocorrências em 2 arquivos vão virar "CAFE-01"')
    await confirm.getByRole('button', { name: 'Substituir 2' }).click()
    await expect(page.getByText('2 ocorrências substituídas em 2 arquivos')).toBeVisible()
    await expect(dlg.getByRole('status')).toContainText('0 ocorrências em 0 arquivos')
    expect(fx.read(dir, 'internal/catalog/catalog.go')).toContain('{SKU: "CAFE-01"')
    expect(fx.read(dir, 'internal/cart/cart_test.go')).toContain('c.Add("CAFE-01", 2)')

    // O editor aberto foi relido do disco.
    await page.keyboard.press('Escape')
    await expect(dlg).toBeHidden()
    expect(await editorValue(page)).toContain('{SKU: "CAFE-01"')
  })
})
