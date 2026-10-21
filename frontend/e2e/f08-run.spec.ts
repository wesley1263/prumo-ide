// F08 Rodar o programa.
import { test, expect, openProject, openFile, editorValue, cursorAt, mod } from './helpers'

const log = (page: import('@playwright/test').Page) => page.getByRole('log')

test.describe('F08 rodar', () => {
  test('F08-H1 ▶ no gutter compila, roda e mostra a saída', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await openFile(page, 'cmd/shop/main.go')
    await page.locator('.prumo-run-glyph').first().click()
    await expect(log(page).getByText('Total: R$ 93,90')).toBeVisible({ timeout: 60_000 })
    await expect(log(page).getByText('Processo encerrado com código 0.')).toBeVisible()
    await expect(page.getByRole('banner').getByRole('button', { name: 'Configuração: go build cmd/shop' })).toBeVisible()
  })

  test('F08-E1 erro de compilação tem link que abre o arquivo na linha', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(dir, 'cmd/shop/quebrado.go', 'package main\n\nfunc quebrado() int {\n\treturn "texto"\n}\n')
    await openProject(page, dir)
    await openFile(page, 'cmd/shop/main.go')
    await page.locator('.prumo-run-glyph').first().click()
    await expect(log(page).getByText(/A compilação falhou/)).toBeVisible({ timeout: 60_000 })
    await log(page).getByRole('button', { name: /quebrado\.go:4/ }).click()
    await expect(page.getByRole('tab', { name: 'quebrado.go', exact: true })).toHaveAttribute('aria-selected', 'true')
    const line = await page.evaluate(() => (window as any).__prumoEditor.getPosition().lineNumber)
    expect(line).toBe(4)
  })

  test('F08-E2 programa que lê a entrada recebe o que é digitado', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(
      dir,
      'cmd/ola/main.go',
      'package main\n\nimport (\n\t"bufio"\n\t"fmt"\n\t"os"\n)\n\nfunc main() {\n\tfmt.Println("Seu nome?")\n\tsc := bufio.NewScanner(os.Stdin)\n\tsc.Scan()\n\tfmt.Printf("Olá, %s!\\n", sc.Text())\n}\n',
    )
    await openProject(page, dir)
    await openFile(page, 'cmd/ola/main.go')
    await page.locator('.prumo-run-glyph').first().click()
    await expect(log(page).getByText('Seu nome?')).toBeVisible({ timeout: 60_000 })
    const input = page.getByLabel('Entrada do programa')
    await input.fill('Ana Júlia')
    await input.press('Enter')
    await expect(log(page).getByText('Olá, Ana Júlia!')).toBeVisible()
  })

  test('F08-E3 parar um programa que não termina', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(dir, 'cmd/loop/main.go', 'package main\n\nimport "time"\n\nfunc main() {\n\tprintln("rodando")\n\tfor {\n\t\ttime.Sleep(time.Second)\n\t}\n}\n')
    await openProject(page, dir)
    await openFile(page, 'cmd/loop/main.go')
    await page.locator('.prumo-run-glyph').first().click()
    await expect(log(page).getByText('rodando')).toBeVisible({ timeout: 60_000 })
    await page.keyboard.press(`${mod}+F2`)
    await expect(log(page).getByText('Parado.')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('banner').getByRole('button', { name: 'Parar' })).toBeDisabled()
  })

  test('F08-E4 código de saída diferente de zero aparece', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(dir, 'cmd/sai/main.go', 'package main\n\nimport "os"\n\nfunc main() { os.Exit(3) }\n')
    await openProject(page, dir)
    await openFile(page, 'cmd/sai/main.go')
    await page.locator('.prumo-run-glyph').first().click()
    await expect(log(page).getByText('Processo encerrado com código 3.')).toBeVisible({ timeout: 60_000 })
  })

  test('F08-E5 saída com acentos e emoji', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(dir, 'cmd/utf/main.go', 'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("ação ☕ 🚀 coração") }\n')
    await openProject(page, dir)
    await openFile(page, 'cmd/utf/main.go')
    await page.locator('.prumo-run-glyph').first().click()
    await expect(log(page).getByText('ação ☕ 🚀 coração')).toBeVisible({ timeout: 60_000 })
  })

  test('F08-E6 saída grande (200 mil linhas) não trava a interface', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(dir, 'cmd/muito/main.go', 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfor i := 0; i < 200000; i++ {\n\t\tfmt.Println("linha", i)\n\t}\n}\n')
    await openProject(page, dir)
    await openFile(page, 'cmd/muito/main.go')
    await page.locator('.prumo-run-glyph').first().click()
    await expect(log(page).getByText('Processo encerrado com código 0.')).toBeVisible({ timeout: 60_000 })
    // A interface ainda responde: digitar no editor reflete em menos de 2s.
    await cursorAt(page, 'package main')
    const t = Date.now()
    await page.keyboard.type('//')
    await expect.poll(() => editorValue(page), { timeout: 2000 }).toContain('package main//')
    expect(Date.now() - t).toBeLessThan(2000)
  })

  test('F08-E7 Shift+F10 roda de novo a configuração escolhida', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await openFile(page, 'cmd/shop/main.go')
    await page.locator('.prumo-run-glyph').first().click()
    await expect(log(page).getByText('Processo encerrado com código 0.')).toBeVisible({ timeout: 60_000 })
    await page.keyboard.press('Shift+F10')
    await expect(page.getByRole('tab', { name: /go build cmd\/shop/ })).toHaveCount(2)
  })

  test('F08-E8 rodar com alteração não salva usa o texto do editor', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir)
    await openFile(page, 'cmd/shop/main.go')
    await cursorAt(page, '"Total: R$ ')
    await page.keyboard.type('Novo ')
    await page.locator('.prumo-run-glyph').first().click()
    await expect(log(page).getByText('Total: R$ Novo 93,90')).toBeVisible({ timeout: 60_000 })
    expect(await editorValue(page)).toContain('Total: R$ Novo')
  })
})
