// Verificações antes do commit: formatar (gofmt e imports) e go vet, que pergunta antes de commitar com problema.
import { test, expect, openProject, API, token } from './helpers'
import type { Page } from '@playwright/test'

const commit = (page: Page) => page.getByRole('region', { name: 'Commit' })

// As opções ficam nas preferências do app: voltam ao padrão para não afetar outros testes.
test.afterEach(async () => {
  for (const k of ['commit.format', 'commit.vet', 'commit.tests'])
    await fetch(`${API}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Prumo-Token': token() }, body: JSON.stringify({ method: 'Settings.Set', args: [k, false] }) })
})

test('F12-H6 formatar ao commitar e go vet que pede confirmação', async ({ page, fx }) => {
  const dir = fx.seed()
  fx.write(dir, 'internal/catalog/catalog.go', fx.read(dir, 'internal/catalog/catalog.go') + '\nfunc   Feio( )int{return 1}\n')
  fx.write(dir, 'internal/catalog/vet.go', 'package catalog\n\nimport "fmt"\n\nfunc Mostra() { fmt.Printf("%d\\n", "texto") }\n')
  fx.git(dir, 'add', 'internal/catalog/vet.go')
  await openProject(page, dir)
  await page.keyboard.press('Alt+0')
  await commit(page).getByRole('checkbox', { name: /Formatar o código/ }).click({ force: true })
  await commit(page).getByRole('checkbox', { name: 'Analisar com go vet' }).click({ force: true })
  await commit(page).getByLabel('Mensagem do commit').fill('catálogo com checagens')
  await commit(page).getByRole('button', { name: 'Commit', exact: true }).click()

  // O go vet reclamou: mostra a saída e não commitou ainda; o código já foi formatado.
  const dlg = page.getByRole('dialog', { name: 'O go vet encontrou problemas' })
  await expect(dlg.getByLabel('Saída do go vet')).toContainText('wrong type', { timeout: 60_000 })
  expect(fx.git(dir, 'rev-list', '--count', 'HEAD')).toBe('1')
  expect(fx.read(dir, 'internal/catalog/catalog.go')).toContain('func Feio() int { return 1 }')
  await dlg.getByRole('button', { name: 'Commitar mesmo assim' }).click()
  await expect(page.getByText(/Commit [0-9a-f]{7} criado/)).toBeVisible()
  expect(fx.git(dir, 'show', 'HEAD:internal/catalog/catalog.go')).toContain('func Feio() int { return 1 }')
})

test('F12-H7 rodar os testes antes do commit: falha pergunta antes de commitar', async ({ page, fx }) => {
  const dir = fx.seed()
  // O teste do carrinho passa a falhar: o total esperado muda.
  fx.write(dir, 'internal/cart/cart_test.go', fx.read(dir, 'internal/cart/cart_test.go').replace('6980', '1'))
  await openProject(page, dir)
  await page.keyboard.press('Alt+0')
  await commit(page).getByRole('checkbox', { name: 'Rodar os testes dos pacotes' }).click({ force: true })
  await commit(page).getByLabel('Mensagem do commit').fill('teste quebrado')
  await commit(page).getByRole('button', { name: 'Commit', exact: true }).click()
  const dlg = page.getByRole('dialog', { name: 'Testes falharam' })
  await expect(dlg.getByLabel('Saída do go test')).toContainText('Total = 6980', { timeout: 90_000 })
  await dlg.getByRole('button', { name: 'Voltar' }).click()
  expect(fx.git(dir, 'rev-list', '--count', 'HEAD')).toBe('1')
})
