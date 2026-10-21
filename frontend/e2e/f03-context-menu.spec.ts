// Menu do botão direito no editor (o do Monaco, num shadow DOM): fundo sólido e texto legível nos dois temas.
import { test, expect, openProject, openFile } from './helpers'
import type { Page } from '@playwright/test'

async function menuColors(page: Page) {
  const box = await page.locator('.monaco-editor .view-lines').first().boundingBox()
  await page.mouse.click(box!.x + 120, box!.y + 200, { button: 'right' })
  const menu = page.locator('.monaco-menu') // o locator do Playwright atravessa o shadow DOM
  await expect(menu.getByText('Ir para definição', { exact: true })).toBeVisible()
  const c = await menu.first().evaluate((el) => {
    const item = el.querySelector('.action-label') as HTMLElement
    // O fundo de verdade: o primeiro ancestral do item que não é transparente (dentro do shadow DOM e fora dele).
    let n: Element | null = item
    let bg = 'rgba(0, 0, 0, 0)'
    while (n) {
      const c = getComputedStyle(n).backgroundColor
      if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') {
        bg = c
        break
      }
      n = n.parentElement ?? ((n.getRootNode() as ShadowRoot).host ?? null)
      if (n === document.body) break
    }
    return { bg, fg: getComputedStyle(item).color }
  })
  await page.keyboard.press('Escape')
  return c
}

// Luminância relativa (WCAG) de "rgb(r, g, b)".
const lum = (rgb: string) => {
  const [r, g, b] = rgb.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

test('F03-H12 menu do botão direito no editor é legível nos dois temas', async ({ page, fx }) => {
  await openProject(page, fx.seed())
  await openFile(page, 'internal/cart/cart.go')
  for (const theme of ['dark', 'light'] as const) {
    if (theme === 'light') {
      await page.evaluate(async () => {
        document.documentElement.dataset.theme = 'light'
        ;(await import('/src/editor/monaco.ts')).monaco.editor.setTheme('prumo-light')
      })
    }
    const { bg, fg } = await menuColors(page)
    expect(bg, `${theme}: fundo do menu`).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
    expect(contrast(bg, fg), `${theme}: contraste ${fg} sobre ${bg}`).toBeGreaterThan(4.5)
  }
})
