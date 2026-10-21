// S03 tool windows: mover entre os lados (menu e arrastar), modo flutuante, e o lugar fica salvo.
import { test, expect, openProject, a11y } from './helpers'
import type { Page } from '@playwright/test'

const leftStripe = (page: Page) => page.getByRole('toolbar', { name: 'Janelas da esquerda e de baixo' })
const rightStripe = (page: Page) => page.getByRole('toolbar', { name: 'Janelas da direita' })
const box = async (page: Page, id: string) => (await page.locator(`[data-floating="${id}"]`).boundingBox())!

test.describe('S03 tool windows', () => {
  test('S03-H1 mover para a direita pelo menu; atalho e lugar valem depois de recarregar', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir)
    await page.keyboard.press('Alt+6')
    const problems = page.getByRole('region', { name: 'Problemas' })
    await expect(problems).toBeVisible()
    await problems.getByRole('button', { name: 'Mover para' }).click()
    await page.getByRole('menuitem', { name: 'Direita' }).click()
    await expect(rightStripe(page).getByRole('button', { name: 'Problemas' })).toHaveAttribute('aria-pressed', 'true')
    await expect(leftStripe(page).getByRole('button', { name: 'Problemas' })).toHaveCount(0)
    // Está à direita do editor.
    const editorX = (await page.locator('main').boundingBox())!.x
    expect((await problems.boundingBox())!.x).toBeGreaterThan(editorX + 100)
    await page.keyboard.press('Alt+6')
    await expect(problems).toBeHidden()

    // O lugar é do projeto: recarregar e reabrir mantém.
    await page.waitForTimeout(1200) // o layout é gravado com 1 s de folga
    await page.reload()
    const recent = page.getByRole('list', { name: 'Projetos recentes' })
    await recent.getByRole('button', { name: new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click()
    await expect(rightStripe(page).getByRole('button', { name: 'Problemas' })).toBeVisible()
  })

  test('S03-H2 arrastar o ícone para a outra barra move a janela', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await leftStripe(page).getByRole('button', { name: 'Executar' }).dragTo(rightStripe(page).getByRole('group', { name: 'Direita' }))
    await expect(rightStripe(page).getByRole('button', { name: 'Executar' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('region', { name: 'Executar' })).toBeVisible()
    // E de volta para baixo.
    await rightStripe(page).getByRole('button', { name: 'Executar' }).dragTo(leftStripe(page).getByRole('group', { name: 'Embaixo' }))
    await expect(leftStripe(page).getByRole('group', { name: 'Embaixo' }).getByRole('button', { name: 'Executar' })).toBeVisible()
  })

  test('S03-H3 janela flutuante: arrastar, redimensionar, esconder e reabrir no mesmo lugar', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await page.keyboard.press('Alt+6')
    await page.getByRole('region', { name: 'Problemas' }).getByRole('button', { name: 'Mover para' }).click()
    await page.getByRole('menuitem', { name: 'Flutuante' }).click()
    const float = page.locator('[data-floating="problems"]')
    await expect(float).toBeVisible()
    await expect(leftStripe(page).getByRole('group', { name: 'Flutuantes' }).getByRole('button', { name: 'Problemas' })).toHaveAttribute('aria-pressed', 'true')
    expect(await a11y(page)).toEqual([])

    // Arrastar pelo título.
    const b0 = await box(page, 'problems')
    const title = float.getByRole('heading', { name: 'Problemas' })
    const t = (await title.boundingBox())!
    await page.mouse.move(t.x + 10, t.y + t.height / 2)
    await page.mouse.down()
    await page.mouse.move(t.x + 110, t.y + t.height / 2 + 60, { steps: 5 })
    await page.mouse.up()
    const b1 = await box(page, 'problems')
    expect(Math.round(b1.x - b0.x)).toBe(100)
    expect(Math.round(b1.y - b0.y)).toBe(60)

    // Redimensionar pelo canto.
    await page.mouse.move(b1.x + b1.width - 7, b1.y + b1.height - 7)
    await page.mouse.down()
    await page.mouse.move(b1.x + b1.width + 43, b1.y + b1.height + 13, { steps: 5 })
    await page.mouse.up()
    const b2 = await box(page, 'problems')
    expect(Math.round(b2.width - b1.width)).toBe(50)

    // Shift+Esc esconde; Alt+6 reabre flutuando no mesmo lugar.
    await float.getByRole('region', { name: 'Problemas' }).focus()
    await page.keyboard.press('Shift+Escape')
    await expect(float).toBeHidden()
    await page.keyboard.press('Alt+6')
    await expect(float).toBeVisible()
    expect(Math.round((await box(page, 'problems')).x)).toBe(Math.round(b2.x))
  })
})
