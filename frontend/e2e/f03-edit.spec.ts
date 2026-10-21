// F03 Escrever código com completion, imports automáticos e formatação ao salvar.
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, openProject, openFile, editorValue, cursorAt, mod } from './helpers'

test.describe('F03 editar e salvar', () => {
  test('F03-H1 completion de pacote não importado adiciona o import', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir)
    await openFile(page, 'cmd/shop/main.go')
    await cursorAt(page, 'c.Total()%100)')
    await page.keyboard.press('Enter')
    await page.keyboard.type('strings.ToUp')
    await page.locator('.suggest-widget').getByText('ToUpper', { exact: true }).first().waitFor()
    await page.keyboard.press('Enter')
    await expect.poll(() => editorValue(page)).toContain('"strings"')
  })

  test('F03-H2 salvar formata (gofmt) e organiza imports', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(dir, 'cmd/shop/extra.go', 'package main\n\nimport "os"\n\nfunc   extra( )int{\nreturn   1}\n')
    await openProject(page, dir)
    await openFile(page, 'cmd/shop/extra.go')
    await cursorAt(page, 'return   1}')
    await page.keyboard.type(' ')
    await page.keyboard.press(`${mod}+s`)
    await expect.poll(() => fx.read(dir, 'cmd/shop/extra.go')).toBe('package main\n\nfunc extra() int {\n\treturn 1\n}\n')
  })

  test('F03-E1 arquivo mudou no disco: "Manter a minha" grava a versão do editor', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir)
    await openFile(page, 'README.md')
    await cursorAt(page, 'IDE.')
    await page.keyboard.type(' (editor)')
    await page.waitForTimeout(50)
    fx.write(dir, 'README.md', '# alterado fora\n')
    await page.keyboard.press(`${mod}+s`)
    const dlg = page.getByRole('dialog', { name: 'O arquivo mudou no disco' })
    await expect(dlg).toBeVisible()
    await dlg.getByRole('button', { name: 'Manter a minha' }).click()
    await expect.poll(() => fx.read(dir, 'README.md')).toContain('(editor)')
  })

  test('F03-E2 arquivo mudou no disco: "Usar a versão do disco" recarrega o editor', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir)
    await openFile(page, 'README.md')
    await cursorAt(page, 'IDE.')
    await page.keyboard.type(' (editor)')
    fx.write(dir, 'README.md', '# alterado fora\n')
    await page.keyboard.press(`${mod}+s`)
    await page.getByRole('dialog', { name: 'O arquivo mudou no disco' }).getByRole('button', { name: 'Usar a versão do disco' }).click()
    await expect.poll(() => editorValue(page)).toBe('# alterado fora\n')
    await expect(page.getByRole('tab', { name: 'README.md', exact: true })).toBeVisible() // sem ", não salvo"
  })

  test('F03-E3 Ctrl+S duas vezes seguidas não acusa conflito falso', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir)
    await openFile(page, 'README.md')
    await cursorAt(page, 'IDE.')
    await page.keyboard.type(' um')
    await page.keyboard.press(`${mod}+s`)
    await page.keyboard.type(' dois')
    await page.keyboard.press(`${mod}+s`)
    await expect.poll(() => fx.read(dir, 'README.md')).toContain('IDE. um dois')
    await expect(page.getByRole('dialog', { name: 'O arquivo mudou no disco' })).toBeHidden()
  })

  test('F03-E4 arquivo binário abre só com aviso', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(dir, 'logo.bin', Buffer.from([0, 1, 2, 3, 255]))
    await openProject(page, dir, { trust: false })
    await openFile(page, 'logo.bin')
    await expect(page.getByText('Arquivo binário: não dá para mostrar o conteúdo.')).toBeVisible()
  })

  test('F03-E5 arquivo maior que 5 MB abre só leitura com aviso', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(dir, 'grande.txt', 'x'.repeat(5 * 1024 * 1024 + 10))
    await openProject(page, dir, { trust: false })
    await openFile(page, 'grande.txt')
    await expect(page.getByText(/grande demais para o editor/)).toBeVisible()
  })

  test('F03-E6 acentos e emoji sobrevivem a salvar (UTF-8)', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir)
    await openFile(page, 'NOTES.md')
    await cursorAt(page, 'frete')
    await page.keyboard.type(' — ação, coração ☕ 🚀')
    await page.keyboard.press(`${mod}+s`)
    await expect.poll(() => fx.read(dir, 'NOTES.md')).toBe('TODO: frete — ação, coração ☕ 🚀\n')
  })

  test('F03-E7 arquivo com CRLF continua CRLF depois de salvar', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(dir, 'win.txt', 'linha 1\r\nlinha 2\r\n')
    await openProject(page, dir, { trust: false })
    await openFile(page, 'win.txt')
    await expect(page.getByRole('contentinfo').getByText('CRLF')).toBeVisible()
    await cursorAt(page, 'linha 2')
    await page.keyboard.press('Enter')
    await page.keyboard.type('linha 3')
    await page.keyboard.press(`${mod}+s`)
    await expect.poll(() => fx.read(dir, 'win.txt')).toBe('linha 1\r\nlinha 2\r\nlinha 3\r\n')
  })

  test('F03-E8 fechar aba com alteração salva antes de fechar', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir, { trust: false })
    await openFile(page, 'NOTES.md')
    await cursorAt(page, 'frete')
    await page.keyboard.type('!')
    await page.keyboard.press(`${mod}+F4`)
    await expect(page.getByRole('tab', { name: /NOTES\.md/ })).toHaveCount(0)
    await expect.poll(() => fx.read(dir, 'NOTES.md')).toBe('TODO: frete!\n')
  })

  test('F03-E9 modo restrito: edita e salva sem formatar', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(dir, 'cmd/shop/extra.go', 'package main\n\nfunc   extra( )int{ return 1}\n')
    await openProject(page, dir, { trust: false })
    await openFile(page, 'cmd/shop/extra.go')
    await cursorAt(page, 'return 1}')
    await page.keyboard.type(' ')
    await page.keyboard.press(`${mod}+s`)
    await expect.poll(() => fx.read(dir, 'cmd/shop/extra.go')).toBe('package main\n\nfunc   extra( )int{ return 1} \n')
  })

  test('F03-E10 recarregar com alteração não salva não perde o texto', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir, { trust: false })
    await openFile(page, 'NOTES.md')
    await cursorAt(page, 'frete')
    await page.keyboard.type(' urgente')
    const before = statSync(join(dir, 'NOTES.md')).mtimeMs
    await page.reload()
    await page.getByRole('button', { name: 'Abrir', exact: true }).first().waitFor()
    // O texto digitado precisa ter ido para o disco (como o autosave das IDEs desktop).
    expect(fx.read(dir, 'NOTES.md'), `mtime antes ${before}`).toBe('TODO: frete urgente\n')
  })
})
