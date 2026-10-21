// S19 Terminal: shell real na pasta do projeto, sessão que sobrevive a esconder a janela, abas, links e saída.
import { test, expect, openProject, a11y } from './helpers'
import type { Page } from '@playwright/test'

const panel = (page: Page) => page.getByRole('region', { name: 'Terminal' })
const screenText = (page: Page) => page.locator('[data-terminal]:not(.hidden) .xterm-rows').innerText()
const tabs = (page: Page) => panel(page).getByRole('tablist', { name: 'Terminais' }).getByRole('tab')

async function run(page: Page, cmd: string) {
  await page.locator('[data-terminal]:not(.hidden) .xterm-helper-textarea').focus()
  await page.keyboard.type(cmd)
  await page.keyboard.press('Enter')
}

test.describe('F19 terminal', () => {
  test('F19-H1 abrir com Alt+F12, rodar comandos na pasta do projeto, sessão sobrevive a esconder', async ({ page, fx }) => {
    const dir = fx.seed()
    await openProject(page, dir)
    await page.keyboard.press('Alt+F12')
    await expect(panel(page)).toBeVisible()
    await expect(tabs(page)).toHaveText(['Local'])
    await run(page, 'echo "prumo-$((40+2))"; pwd; echo "pid=$$"')
    await expect.poll(() => screenText(page)).toContain('prumo-42')
    const text = await screenText(page)
    expect(text).toContain(dir.split('/').pop()!)
    const pid = text.match(/pid=(\d+)/)![1]

    // Atalhos da IDE não roubam teclas do shell: Ctrl+K é "apagar até o fim da linha", não Commit.
    await page.keyboard.press('Control+K')
    await expect(page.getByRole('region', { name: 'Commit' })).toBeHidden()

    // Esconder e mostrar: mesmo shell, histórico preservado.
    await page.keyboard.press('Alt+F12')
    await expect(panel(page)).toBeHidden()
    await page.keyboard.press('Alt+F12')
    await expect.poll(() => screenText(page)).toContain('prumo-42')
    await run(page, 'echo "pid=$$ de novo"')
    await expect.poll(() => screenText(page)).toContain(`pid=${pid} de novo`)
    expect(await a11y(page)).toEqual([])
  })

  test('F19-H2 abas, link para o editor e saída do shell', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await page.keyboard.press('Alt+F12')
    await expect(tabs(page)).toHaveText(['Local'])
    await panel(page).getByRole('button', { name: 'Novo terminal' }).click()
    await expect(tabs(page)).toHaveText(['Local', 'Local (2)'])
    await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true')

    // arquivo.go:linha vira link (Ctrl+clique abre no editor).
    await run(page, 'printf "veja %s\\n" cmd/shop/main.go:12')
    const link = page.locator('[data-terminal]:not(.hidden) .xterm-rows span', { hasText: /^veja cmd\/shop\/main\.go:12/ }).last()
    await expect(link).toBeVisible()
    const box = (await link.boundingBox())!
    // O meio de "veja cmd/shop/main.go:12" cai dentro do link; o xterm detecta o link ao passar o mouse.
    await page.mouse.move(box.x + box.width / 2 - 4, box.y + box.height / 2)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(300)
    await page.keyboard.down('Control')
    await page.mouse.down()
    await page.mouse.up()
    await page.keyboard.up('Control')
    await expect(page.getByRole('tab', { name: 'main.go' })).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => page.evaluate(() => (window as any).__prumoEditor.getPosition().lineNumber)).toBe(12)

    // Shell que sai: a aba fica marcada como encerrada, com o código.
    await page.keyboard.press('Alt+F12')
    await page.keyboard.press('Alt+F12')
    await run(page, 'exit 7')
    await expect.poll(() => screenText(page)).toContain('[processo encerrado com código 7]')
    await expect(tabs(page).nth(1)).toHaveAccessibleName(/Local \(2\).*\(encerrado\)/)

    await panel(page).getByRole('button', { name: 'Fechar terminal' }).click()
    await expect(tabs(page)).toHaveText(['Local'])
  })

  test('F19-N1 modo restrito: terminal desligado até confiar', async ({ page, fx }) => {
    await openProject(page, fx.seed(), { trust: false })
    await page.keyboard.press('Alt+F12')
    await expect(panel(page)).toContainText('Terminal desligado no modo restrito')
    await panel(page).getByRole('button', { name: 'Confiar no projeto…' }).click()
    const dlg = page.getByRole('dialog', { name: 'Confiar neste projeto?' })
    await dlg.getByRole('button', { name: 'Confiar' }).click()
    await expect(tabs(page)).toHaveText(['Local'])
    await run(page, `echo ok-${'$'}((1+1))`)
    await expect.poll(() => screenText(page)).toContain('ok-2')
  })
})
