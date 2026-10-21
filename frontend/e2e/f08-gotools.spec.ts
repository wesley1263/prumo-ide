// Ferramentas do Go pelo menu principal: go mod tidy e go vet, com a saída na janela Executar.
import { test, expect, openProject } from './helpers'
import type { Page } from '@playwright/test'

const log = (page: Page) => page.getByRole('region', { name: 'Executar' }).getByRole('log')

test('F08-H5 go mod tidy pelo menu limpa o go.mod; go vet aponta o problema', async ({ page, fx }) => {
  const dir = fx.seed()
  fx.write(dir, 'go.mod', fx.read(dir, 'go.mod') + '\nrequire example.com/nada v1.0.0\n')
  fx.write(dir, 'internal/cart/vet.go', 'package cart\n\nimport "fmt"\n\nfunc errado() { fmt.Printf("%d\\n", "texto") }\n')
  await openProject(page, dir)
  await page.getByRole('button', { name: 'Menu principal' }).click()
  await page.getByRole('menuitem', { name: 'go mod tidy' }).click()
  await expect(log(page)).toContainText('$ go mod tidy')
  await expect(log(page)).toContainText('Pronto.', { timeout: 60_000 })
  await expect.poll(() => fx.read(dir, 'go.mod')).not.toContain('example.com/nada')

  await page.keyboard.press('Control+Shift+A')
  const se = page.getByRole('dialog', { name: 'Buscar em tudo' })
  await se.getByRole('combobox').fill('go vet')
  await se.getByRole('combobox').press('Enter')
  await expect(log(page)).toContainText('$ go vet ./...')
  await expect(log(page)).toContainText(/Printf format %d has arg "texto" of wrong type string/, { timeout: 60_000 })
  await expect(log(page)).toContainText(/Terminou com código [1-9]/)
})
