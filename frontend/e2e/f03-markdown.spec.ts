// F03 Arquivos .md abrem na visualização renderizada; o botão da aba alterna para o texto.
import { test, expect, openProject, openFile, editorValue } from './helpers'

test.describe('F03 visualização de markdown', () => {
  test('F03-H12 .md abre renderizado, alterna para o texto e sanitiza HTML', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(dir, 'DOC.md', '# Título\n\nUm **forte** e `code`.\n\n- a\n- b\n\n<img src=x onerror="window.__pwned=1">\n<script>window.__pwned=1</script>\n')
    await openProject(page, dir, { trust: false })
    await openFile(page, 'DOC.md', { preview: true })

    const preview = page.getByTestId('markdown-preview')
    await expect(preview.getByRole('heading', { name: 'Título', level: 1 })).toBeVisible()
    await expect(preview.locator('strong')).toHaveText('forte')
    await expect(preview.locator('li')).toHaveCount(2)
    expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined()

    await page.getByRole('button', { name: 'Editar markdown' }).click()
    await expect(preview).toBeHidden()
    await expect.poll(() => editorValue(page)).toContain('# Título')

    await page.getByRole('button', { name: 'Visualizar markdown' }).click()
    await expect(preview).toBeVisible()
  })
})
