// Percorre o fluxo mínimo no navegador (Chrome do sistema) e salva screenshots para o /replica-diff.
// Pré-requisitos: go run ./cmd/devserver  +  npm run dev  +  scripts/seed-fixture.sh
//   node scripts/screenshots.mjs [--headed]
// Falha (exit 1) se algum passo não acontecer ou se a página logar erro no console.
import { chromium } from 'playwright-core'
import { mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = process.env.GOIDE_URL ?? 'http://127.0.0.1:5173'
const OUT = resolve('../replica/clone-screens')
const FIXTURE = resolve('../.fixtures/demo-shop')
const CHROME = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: CHROME, headless: !process.argv.includes('--headed') })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))

const results = []
async function step(name, fn) {
  const t = Date.now()
  try {
    await fn()
    results.push(`ok    ${name} (${Date.now() - t}ms)`)
  } catch (e) {
    results.push(`FALHA ${name}: ${e.message.split('\n').slice(0, 12).join('\n      ')}`)
    await page.screenshot({ path: `${OUT}/_falha-${name.replace(/\W+/g, '-')}.png` })
    throw e
  }
}
const shot = (id) => page.screenshot({ path: `${OUT}/${id}.png` })
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

// Digita uma linha nova logo antes do "}" que fecha o main (o arquivo termina com "}\n").
async function insertInMain(text) {
  await page.locator('.monaco-editor .view-lines').first().click()
  await page.keyboard.press(`${mod}+End`)
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Home')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.type(text)
}

try {
  await step('S01 tela inicial', async () => {
    await page.goto(BASE)
    await page.getByRole('button', { name: 'Abrir', exact: true }).first().waitFor()
    await shot('S01')
  })

  await step('abrir projeto pelo caminho', async () => {
    await page.getByRole('button', { name: 'Abrir', exact: true }).first().click()
    const field = page.getByLabel('Caminho da pasta')
    await field.fill(FIXTURE)
    await field.press('Enter')
  })

  await step('diálogo de confiança', async () => {
    const dlg = page.getByRole('dialog', { name: 'Confiar neste projeto?' })
    if (await dlg.isVisible({ timeout: 3000 }).catch(() => false)) {
      await shot('S03-confianca')
      await dlg.getByRole('button', { name: 'Confiar' }).click()
    }
    await page.getByRole('banner').getByText('demo-shop').waitFor()
    // A sessão anterior pode ter deixado outro layout salvo: garante a janela do projeto.
    await page.waitForTimeout(500)
    if (!(await page.getByRole('tree', { name: 'Arquivos do projeto' }).isVisible())) await page.keyboard.press('Alt+1')
    await page.getByRole('tree', { name: 'Arquivos do projeto' }).waitFor()
  })

  await step('S05 árvore do projeto', async () => {
    const tree = page.getByRole('tree', { name: 'Arquivos do projeto' })
    await tree.getByRole('treeitem', { name: 'cmd', exact: true }).click()
    await tree.getByRole('treeitem', { name: 'shop', exact: true }).click()
    await tree.getByRole('treeitem', { name: 'main.go', exact: true }).dblclick()
    await page.getByRole('tab', { name: /main\.go/ }).waitFor()
    await shot('S05')
  })

  await step('S04 editor com gopls pronto', async () => {
    await page.getByText('gopls pronto').waitFor({ timeout: 60000 })
    await page.locator('.goide-run-glyph').first().waitFor()
    await shot('S04')
  })

  await step('diagnóstico de erro de tipo', async () => {
    await page.locator('.monaco-editor .view-lines').click()
    await insertInMain('_ = naoExiste')
    await page.locator('.squiggly-error').first().waitFor({ timeout: 30000 })
    await page.getByRole('button', { name: /1 erros/ }).waitFor()
  })

  await step('S10 problemas', async () => {
    await page.getByRole('button', { name: /1 erros/ }).click()
    await page.getByText(/undefined: naoExiste/).first().waitFor()
    await shot('S10')
  })

  await step('completion com import automático', async () => {
    await page.locator('.monaco-editor .view-lines').click()
    await page.keyboard.press(`${mod}+z`) // desfaz o erro (Monaco agrupa a digitação)
    for (let i = 0; i < 3 && (await page.locator('.squiggly-error').count()) > 0; i++) await page.keyboard.press(`${mod}+z`)
    await insertInMain('strings.ToUp')
    const suggest = page.locator('.suggest-widget .monaco-list-row', { hasText: 'ToUpper' }).first()
    await suggest.waitFor({ timeout: 20000 })
    await shot('S04-completion')
    await page.keyboard.press('Enter')
    await page.keyboard.type('("x")')
    // O import de "strings" entra pelo additionalTextEdits do item.
    await page.locator('.view-line', { hasText: '"strings"' }).waitFor({ timeout: 10000 })
  })

  await step('salvar com formatação', async () => {
    await page.keyboard.press(`${mod}+s`)
    await page.getByRole('tab', { name: /main\.go/ }).locator('[aria-label="não salvo"]').waitFor({ state: 'detached', timeout: 10000 })
  })

  await step('ir para definição em outro arquivo', async () => {
    // "cart.Cart" na linha 12: cursor em Cart e Ctrl+B abre internal/cart/cart.go.
    await page.locator('.view-line', { hasText: 'var c cart.Cart' }).locator('span', { hasText: /^Cart$/ }).first().click()
    await page.keyboard.press(`${mod}+b`)
    await page.getByRole('tab', { name: 'cart.go', exact: true }).waitFor({ timeout: 15000 })
    await page.locator('.view-line', { hasText: 'type Cart struct' }).waitFor()
    await page.getByRole('tab', { name: 'main.go', exact: true }).click()
  })

  await step('S13 rodar pelo gutter', async () => {
    await page.locator('.goide-run-glyph').first().click()
    await page.getByRole('log').getByText('Total: R$ 93,90').waitFor({ timeout: 60000 })
    await page.getByRole('log').getByText(/código 0/).waitFor({ timeout: 10000 })
    await shot('S13')
  })

  await step('S20 commit só dos arquivos marcados', async () => {
    await page.keyboard.press('Alt+0')
    const panel = page.getByRole('region', { name: 'Commit' })
    await panel.getByText('Mudanças').waitFor()
    await shot('S20')
    // NOTES.md (não versionado) fica de fora por padrão.
    await panel.getByLabel('Mensagem do commit').fill('carrinho: imprime total em reais')
    await panel.getByRole('button', { name: 'Commit', exact: true }).click()
    await page.getByText(/Commit [0-9a-f]{7} criado/).waitFor({ timeout: 15000 })
    await panel.getByText('Não versionados').waitFor()
    await panel.getByText('Mudanças').waitFor({ state: 'detached' })
    await shot('S20-depois')
  })

  await step('S21 diff', async () => {
    await page.locator('.monaco-editor .view-lines').first().click()
    await page.keyboard.press(`${mod}+End`)
    await page.keyboard.type('\n// rascunho\n')
    await page.keyboard.press(`${mod}+s`)
    const panel = page.getByRole('region', { name: 'Commit' })
    await panel.getByText('main.go').waitFor({ timeout: 10000 })
    await panel.getByText('main.go').dblclick()
    await page.locator('.monaco-diff-editor .line-insert').first().waitFor({ timeout: 10000 })
    await shot('S21')
  })

  await step('S03 janela principal nos dois temas', async () => {
    // O tema é persistido: não dá para supor de qual se parte.
    const setTheme = async (want) => {
      if ((await page.evaluate(() => document.documentElement.dataset.theme)) === want) return
      await page.getByRole('button', { name: 'Menu principal' }).click()
      await page.getByRole('menuitem', { name: want === 'light' ? 'Tema claro' : 'Tema escuro' }).click()
      await page.waitForFunction((w) => document.documentElement.dataset.theme === w, want)
    }
    await page.getByRole('tab', { name: 'main.go', exact: true }).click()
    await setTheme('light')
    await shot('S03-claro')
    await setTheme('dark')
    await shot('S03')
  })

  await step('janela mínima (800x500)', async () => {
    await page.setViewportSize({ width: 800, height: 500 })
    await shot('S03-800x500')
    await page.setViewportSize({ width: 1440, height: 900 })
  })

  await step('sistema de design', async () => {
    await page.goto(BASE + '/#design')
    await page.getByRole('heading', { name: /Sistema de design/ }).waitFor()
    await page.screenshot({ path: `${OUT}/design.png`, fullPage: true })
  })
} catch {
  // o passo que falhou já registrou o motivo e o screenshot
} finally {
  await browser.close()
  const relevant = errors.filter((e) => !/Failed to load resource.*favicon/.test(e))
  console.log(results.join('\n'))
  if (relevant.length) console.log('\nErros no console:\n' + relevant.join('\n'))
  process.exit(results.some((r) => r.startsWith('FALHA')) || relevant.length ? 1 : 0)
}
