// S21 diff: navegar entre diferenças, lado a lado x unificado e reverter um trecho no diff do disco.
import { test, expect, openProject, a11y } from './helpers'
import type { Page } from '@playwright/test'

const commitPanel = (page: Page) => page.getByRole('region', { name: 'Commit' })
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Diff' })

test.describe('S21 diff', () => {
  test('S21-H1 F7 entre diferenças, unificado e reverter trecho grava o arquivo', async ({ page, fx }) => {
    const dir = fx.seed()
    // Além do Count adicionado no fim (a fixture já traz), muda o preço do café: 2 trechos.
    fx.write(dir, 'internal/catalog/catalog.go', fx.read(dir, 'internal/catalog/catalog.go').replace('Price: 3490', 'Price: 3590'))
    await openProject(page, dir)
    await page.keyboard.press('Alt+0')
    await commitPanel(page).getByText('catalog.go').dblclick()
    await expect(page.getByRole('tab', { name: 'catalog.go (diff)', exact: true })).toHaveAttribute('aria-selected', 'true')
    const status = toolbar(page).getByRole('status')
    await expect(status).toHaveText('1 de 2 · modificado')
    expect(await a11y(page)).toEqual([])

    await toolbar(page).getByRole('button', { name: 'Próxima diferença' }).click()
    await expect(status).toHaveText('2 de 2 · adicionado')
    await page.locator('.monaco-diff-editor .editor.modified textarea').focus()
    await page.keyboard.press('Shift+F7')
    await expect(status).toHaveText('1 de 2 · modificado')

    // Unificado: um editor só, com as linhas antigas e novas intercaladas.
    await toolbar(page).getByRole('radio', { name: 'Unificado' }).click()
    await expect(toolbar(page).getByRole('radio', { name: 'Unificado' })).toHaveAttribute('aria-checked', 'true')
    // No unificado o lado esquerdo vira só a coluna dos números de linha antigos.
    const leftWidth = () => page.locator('.monaco-diff-editor .editor.original').evaluate((el) => el.getBoundingClientRect().width)
    await expect.poll(leftWidth).toBeLessThan(100)
    await toolbar(page).getByRole('radio', { name: 'Lado a lado' }).click()
    await expect.poll(leftWidth).toBeGreaterThan(200)

    // Reverter o trecho do preço: volta a 3490 no disco (salvamento automático) e sobra só o Count.
    await toolbar(page).getByRole('button', { name: 'Reverter trecho' }).click()
    await expect(status).toHaveText('1 de 1 · adicionado')
    await page.getByRole('button', { name: 'Abrir no editor' }).click() // tira o foco do diff: salva
    await expect.poll(() => fx.read(dir, 'internal/catalog/catalog.go')).toContain('Price: 3490')
    expect(fx.read(dir, 'internal/catalog/catalog.go')).toContain('func Count()')
  })

  test('S21-H2 diff de um commit é só leitura (sem reverter)', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.git(dir, 'commit', '-qam', 'catálogo: Count')
    await openProject(page, dir)
    await page.keyboard.press('Alt+9')
    const grid = page.getByRole('grid', { name: 'Commits' })
    await grid.getByRole('row').filter({ hasText: 'catálogo: Count' }).click()
    await page.getByRole('region', { name: 'Detalhes do commit' }).getByRole('button', { name: /catalog\.go, modificado/ }).dblclick()
    await expect(toolbar(page).getByRole('status')).toHaveText('1 de 1 · adicionado')
    await expect(toolbar(page).getByRole('button', { name: 'Reverter trecho' })).toHaveCount(0)
  })
})
