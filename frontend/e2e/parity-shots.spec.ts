// Capturas para o /replica-diff (não roda na suíte normal).
//   GOIDE_SHOTS=1 npx playwright test parity-shots
// A referência do original é a ilustração pública do tour da interface (replica/screens/S03-original.png):
// janela de ~1000x650 em 2x, tema claro, árvore recolhida, README.md aberto. A captura do clone imita esse estado.
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, openProject, openFile } from './helpers'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCREENS = resolve(__dirname, '../../replica/screens')
const CLONE = resolve(__dirname, '../../replica/clone-screens')

test.skip(!process.env.GOIDE_SHOTS, 'só para o /replica-diff')
test.use({ viewport: { width: 1000, height: 648 }, deviceScaleFactor: 2 })

test('S03 janela principal no estado da ilustração da documentação', async ({ page, fx }) => {
  const dir = fx.seed('Samples')
  await openProject(page, dir)
  await openFile(page, 'README.md')
  // Mesmo estado da referência: árvore com a raiz recolhida, tema claro, cursor parado.
  await page.getByRole('treeitem', { name: /^Samples/ }).click()
  await page.getByRole('button', { name: 'Menu principal' }).click()
  await page.getByRole('menuitem', { name: 'Tema claro' }).click()
  await page.mouse.move(0, 0)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${CLONE}/S03-estado-referencia.png` })
})

test('recorte da referência do original (só a janela)', async ({ page }) => {
  // A ilustração tem uma faixa preta embaixo, fora da janela: recorta a janela (2084x1350 px).
  const png = readFileSync(`${SCREENS}/S03-original.png`).toString('base64')
  await page.setViewportSize({ width: 1042, height: 834 })
  await page.setContent(`<body style="margin:0"><img id="i" style="width:1042px" src="data:image/png;base64,${png}"></body>`)
  await expect(page.locator('#i')).toBeVisible()
  await page.screenshot({ path: `${SCREENS}/S03.png`, clip: { x: 0, y: 0, width: 1042, height: 675 } })
})

test('S06 buscar em tudo e S07 buscar nos arquivos', async ({ page, fx }) => {
  await openProject(page, fx.seed())
  await openFile(page, 'internal/cart/cart.go')
  await page.keyboard.press('Shift')
  await page.keyboard.press('Shift')
  const se = page.getByRole('dialog', { name: 'Buscar em tudo' })
  await se.getByRole('combobox').fill('cart')
  await expect(se.getByRole('group', { name: 'Símbolos' })).toBeVisible({ timeout: 30_000 })
  await page.mouse.move(0, 0)
  await page.screenshot({ path: `${CLONE}/S06.png` })
  await page.keyboard.press('Escape')

  await page.keyboard.press('Control+Shift+R')
  const find = page.getByRole('dialog', { name: 'Substituir nos arquivos' })
  await find.getByLabel('Texto a buscar').fill('total')
  await find.getByLabel('Substituir por').fill('soma')
  await expect(find.getByRole('status')).toContainText('ocorrências em 3 arquivos')
  await find.getByLabel('Texto a buscar').press('ArrowDown')
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${CLONE}/S07.png` })
})

test('S19 terminal', async ({ page, fx }) => {
  await openProject(page, fx.seed())
  await openFile(page, 'cmd/shop/main.go')
  await page.keyboard.press('Alt+F12')
  await page.locator('[data-terminal] .xterm-helper-textarea').focus()
  await page.keyboard.type('git --no-pager log --oneline; ls --color=always; go build ./... && echo "build $((1+0)) ok"')
  await page.keyboard.press('Enter')
  await expect.poll(() => page.locator('[data-terminal] .xterm-rows').innerText(), { timeout: 30_000 }).toContain('build 1 ok')
  await page.waitForTimeout(300)
  await page.mouse.move(0, 0)
  await page.screenshot({ path: `${CLONE}/S19.png` })
})

test('S28 configurações', async ({ page, fx }) => {
  await openProject(page, fx.seed())
  await page.keyboard.press('Control+Alt+S')
  const dlg = page.getByRole('dialog', { name: 'Configurações' })
  await dlg.getByRole('navigation').getByRole('button', { name: 'Ferramentas' }).click()
  await expect(dlg.getByRole('listitem').filter({ hasText: 'gopls' })).toBeVisible()
  await page.mouse.move(0, 0)
  await page.screenshot({ path: `${CLONE}/S28.png` })
})

test('S24 log do git e S27 anotar', async ({ page, fx }) => {
  const dir = fx.seed()
  fx.git(dir, 'commit', '-qam', 'catálogo: Count')
  fx.git(dir, 'checkout', '-qb', 'feat/frete')
  fx.write(dir, 'internal/cart/frete.go', 'package cart\n\nfunc Frete(total int) int { return 0 }\n')
  fx.git(dir, 'add', '-A')
  fx.git(dir, 'commit', '-qm', 'frete grátis acima de 100')
  fx.git(dir, 'checkout', '-q', 'main')
  fx.write(dir, 'README.md', fx.read(dir, 'README.md') + '\nfrete\n')
  fx.git(dir, 'commit', '-qam', 'readme: frete')
  fx.git(dir, 'merge', '-q', '--no-ff', '-m', 'merge feat/frete', 'feat/frete')
  await openProject(page, dir)
  await openFile(page, 'internal/catalog/catalog.go')
  await page.keyboard.press('Control+Shift+A')
  const se = page.getByRole('dialog', { name: 'Buscar em tudo' })
  await se.getByRole('combobox').fill('Anotar com git blame')
  await se.getByRole('combobox').press('Enter')
  await expect(page.locator('.goide-blame').first()).toBeVisible()
  await page.keyboard.press('Alt+9')
  const grid = page.getByRole('grid', { name: 'Commits' })
  await grid.getByRole('row').filter({ hasText: 'merge feat/frete' }).click()
  await expect(page.getByRole('region', { name: 'Detalhes do commit' })).toContainText('merge feat/frete')
  await page.mouse.move(0, 0)
  await page.screenshot({ path: `${CLONE}/S24.png` })
})

test('S26 merge em 3 painéis', async ({ page, fx }) => {
  const dir = fx.seed()
  fx.git(dir, 'commit', '-qam', 'catálogo: Count')
  const cat = fx.read(dir, 'internal/catalog/catalog.go')
  fx.git(dir, 'checkout', '-qb', 'feat')
  fx.write(dir, 'internal/catalog/catalog.go', cat.replace('da loja.', 'da loja online.').replace('Price: 3490', 'Price: 3290'))
  fx.git(dir, 'commit', '-qam', 'feat')
  fx.git(dir, 'checkout', '-q', 'main')
  fx.write(dir, 'internal/catalog/catalog.go', cat.replace('Price: 3490', 'Price: 3590').replace('Price: 5900', 'Price: 6100'))
  fx.git(dir, 'commit', '-qam', 'main')
  try {
    fx.git(dir, 'merge', 'feat')
  } catch {
    /* conflito */
  }
  await openProject(page, dir)
  await page.keyboard.press('Alt+0')
  await page.getByRole('region', { name: 'Commit' }).getByRole('button', { name: 'Resolver conflitos…' }).click()
  await page.getByRole('button', { name: 'Mesclar: internal/catalog/catalog.go' }).click()
  await expect(page.getByRole('dialog', { name: /^Mesclar / }).getByRole('status')).toContainText('por resolver')
  await page.waitForTimeout(400)
  await page.mouse.move(0, 0)
  await page.screenshot({ path: `${CLONE}/S26.png` })
})

test('S12 configurações de execução', async ({ page, fx }) => {
  await openProject(page, fx.seed())
  await openFile(page, 'cmd/shop/main.go')
  await page.locator('.goide-run-glyph').first().click()
  await expect(page.getByRole('log').getByText('Total: R$ 93,90')).toBeVisible({ timeout: 60_000 })
  await page.getByRole('banner').getByRole('button', { name: /^Configuração: / }).click()
  await page.getByRole('menuitem', { name: 'Editar configurações…' }).click()
  const dlg = page.getByRole('dialog', { name: 'Configurações de execução' })
  await dlg.getByRole('button', { name: 'Adicionar variável' }).click()
  await dlg.getByLabel('Nome da variável 1').fill('PORTA')
  await dlg.getByLabel('Valor da variável 1').fill('8080')
  await dlg.getByLabel('Argumentos do go').fill('-race')
  await page.mouse.move(0, 0)
  await page.screenshot({ path: `${CLONE}/S12.png` })
})

test('S29 clonar repositório', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Clonar', exact: true }).first().click()
  const dlg = page.getByRole('dialog', { name: 'Clonar repositório' })
  await dlg.getByLabel('URL do repositório').fill('git@github.com:exemplo/demo-shop.git')
  await page.mouse.move(0, 0)
  await page.screenshot({ path: `${CLONE}/S29.png` })
})

test('S09 usos e editor dividido', async ({ page, fx }) => {
  await openProject(page, fx.seed())
  await openFile(page, 'internal/cart/cart.go')
  await page.getByRole('button', { name: 'Dividir à direita' }).click()
  await openFile(page, 'cmd/shop/main.go')
  await page.evaluate(() => {
    const ed = (window as any).__goideSplitEditor
    const m = ed.getModel()
    ed.setPosition(m.getPositionAt(m.getValue().indexOf('func (c *Cart) Total') + 16))
    ed.focus()
  })
  await page.keyboard.press('Alt+F7')
  await expect(page.getByRole('tree', { name: 'Usos de Total' })).toBeVisible({ timeout: 30_000 })
  await page.mouse.move(0, 0)
  await page.screenshot({ path: `${CLONE}/S09.png` })
})

test('S03 janela flutuante e diff unificado', async ({ page, fx }) => {
  await openProject(page, fx.seed())
  await page.keyboard.press('Alt+0')
  await page.getByRole('region', { name: 'Commit' }).getByText('catalog.go').dblclick()
  await page.getByRole('toolbar', { name: 'Diff' }).getByRole('radio', { name: 'Unificado' }).click()
  await page.keyboard.press('Alt+6')
  await page.getByRole('region', { name: 'Problemas' }).getByRole('button', { name: 'Mover para' }).click()
  await page.getByRole('menuitem', { name: 'Flutuante' }).click()
  await page.mouse.move(0, 0)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${CLONE}/S03-flutuante.png` })
})

test('S18 cobertura', async ({ page, fx }) => {
  await openProject(page, fx.seed())
  await openFile(page, 'internal/cart/cart_test.go')
  await page.locator('.goide-run-glyph').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Rodar os testes do pacote com cobertura' }).click()
  const panel = page.getByRole('region', { name: 'Cobertura' })
  await panel.getByRole('treeitem', { name: /^internal\/cart\/cart\.go/ }).dblclick({ timeout: 90_000 })
  await page.mouse.move(0, 0)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${CLONE}/S18.png` })
})
