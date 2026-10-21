// S12 configurações de execução: criar Go Build e Go Test pelo diálogo, validação no campo, rodar com elas,
// temporária virando permanente e apagar.
import { test, expect, openProject, openFile, a11y } from './helpers'
import type { Page } from '@playwright/test'

const dlg = (page: Page) => page.getByRole('dialog', { name: 'Configurações de execução' })
const list = (page: Page) => dlg(page).getByRole('listbox', { name: 'Lista de configurações' })
const log = (page: Page) => page.getByRole('log')
const cfgButton = (page: Page) => page.getByRole('banner').getByRole('button', { name: /^Configuração: / })

async function openDialog(page: Page) {
  await cfgButton(page).click()
  await page.getByRole('menuitem', { name: 'Editar configurações…' }).click()
  await expect(dlg(page)).toBeVisible()
}

async function newConfig(page: Page, type: 'Go Build' | 'Go Test') {
  await dlg(page).getByRole('button', { name: 'Nova configuração' }).click()
  await page.getByRole('menuitem', { name: type }).click()
}

test.describe('S12 configurações de execução', () => {
  test('S12-H1 Go Build com argumentos, variável e entrada; erro no campo segura o OK; rodar com Shift+F10', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(
      dir,
      'cmd/eco/main.go',
      'package main\n\nimport (\n\t"bufio"\n\t"fmt"\n\t"os"\n)\n\nfunc main() {\n\tsc := bufio.NewScanner(os.Stdin)\n\tsc.Scan()\n\tfmt.Printf("args=%v porta=%s entrada=%s\\n", os.Args[1:], os.Getenv("PORTA"), sc.Text())\n}\n',
    )
    fx.write(dir, 'testdata/in.txt', 'olá do arquivo\n')
    await openProject(page, dir)
    await openDialog(page)
    await expect(dlg(page)).toContainText('Nenhuma configuração escolhida')
    await newConfig(page, 'Go Build')
    await expect(list(page).getByRole('option', { name: /^Go Build, alterada$/ })).toHaveAttribute('aria-selected', 'true')

    await dlg(page).getByLabel('Nome').fill('Eco')
    await dlg(page).getByRole('textbox', { name: 'Pasta', exact: true }).fill('cmd/nao-existe')
    await expect(dlg(page).getByText('Pasta não encontrada no projeto.')).toBeVisible()
    await dlg(page).getByRole('button', { name: 'OK' }).click()
    await expect(dlg(page)).toBeVisible() // não fecha com erro
    await expect(list(page).getByRole('option', { name: /^Eco, com erro/ })).toBeVisible()

    await dlg(page).getByRole('textbox', { name: 'Pasta', exact: true }).fill('cmd/eco')
    await dlg(page).getByLabel('Argumentos do programa').fill('-v "dois termos"')
    await dlg(page).getByRole('button', { name: 'Adicionar variável' }).click()
    await dlg(page).getByLabel('Nome da variável 1').fill('PORTA')
    await dlg(page).getByLabel('Valor da variável 1').fill('8080')
    await dlg(page).getByLabel('Entrada (stdin) de').fill('testdata/in.txt')
    await expect(dlg(page).getByText('Pasta não encontrada no projeto.')).toBeHidden()
    expect(await a11y(page)).toEqual([])
    await dlg(page).getByRole('button', { name: 'OK' }).click()
    await expect(dlg(page)).toBeHidden()
    await expect(page.getByText('Configurações salvas')).toBeVisible()
    await expect(cfgButton(page)).toHaveAccessibleName('Configuração: Eco')

    await page.keyboard.press('Shift+F10')
    await expect(log(page).getByText('args=[-v dois termos] porta=8080 entrada=olá do arquivo')).toBeVisible({ timeout: 60_000 })
  })

  test('S12-H2 Go Test com padrão e -v; validação do padrão', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await openDialog(page)
    await newConfig(page, 'Go Test')
    await dlg(page).getByLabel('Nome').fill('Só o Total')
    await dlg(page).getByRole('radio', { name: 'Pacote' }).click({ force: true })
    await dlg(page).getByRole('textbox', { name: 'Pacote', exact: true }).fill('./internal/cart')
    await dlg(page).getByLabel('Padrão (-run)').fill('TestTotal(')
    await expect(dlg(page).getByText(/Expressão regular inválida/)).toBeVisible()
    await dlg(page).getByLabel('Padrão (-run)').fill('^TestTotal$')
    await dlg(page).getByLabel('Argumentos do go').fill('-v -count=1')
    await dlg(page).getByRole('button', { name: 'OK' }).click()
    await expect(cfgButton(page)).toHaveAccessibleName('Configuração: Só o Total')
    await page.keyboard.press('Shift+F10')
    await expect(page.getByRole('region', { name: 'Testes' }).getByRole('treeitem', { name: /^TestTotal, passou/ })).toBeVisible({ timeout: 60_000 })
  })

  test('S12-H4 emular terminal: isatty verdadeiro, cores ANSI e barra de progresso com \\r', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(
      dir,
      'cmd/cores/main.go',
      'package main\n\nimport (\n\t"fmt"\n\t"os"\n)\n\nfunc main() {\n\tst, _ := os.Stdout.Stat()\n\tfmt.Printf("tty=%v\\n", st.Mode()&os.ModeCharDevice != 0)\n\tfor _, p := range []int{10, 50, 100} {\n\t\tfmt.Printf("\\rprogresso %3d%%", p)\n\t}\n\tfmt.Println()\n\tfmt.Println("\\x1b[32mverde\\x1b[0m normal")\n}\n',
    )
    await openProject(page, dir)
    await openDialog(page)
    await newConfig(page, 'Go Build')
    await dlg(page).getByLabel('Nome').fill('Cores')
    await dlg(page).getByRole('textbox', { name: 'Pasta', exact: true }).fill('cmd/cores')
    await dlg(page).getByRole('checkbox', { name: 'Emular terminal no console' }).click({ force: true })
    await dlg(page).getByRole('button', { name: 'OK' }).click()
    await expect(dlg(page)).toBeHidden()
    await page.keyboard.press('Shift+F10')
    await expect(log(page)).toContainText('tty=true', { timeout: 60_000 })
    await expect(log(page)).toContainText('progresso 100%')
    await expect(log(page)).not.toContainText('progresso  10%')
    const green = log(page).getByText('verde', { exact: true })
    await expect(green).toHaveAttribute('style', /--color-ansi-green/)
    await expect(log(page)).not.toContainText('[32m')
  })

  test('S12-H5 antes de rodar: go generate; comando que falha impede a compilação', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(dir, 'cmd/gen/main.go', 'package main\n\n//go:generate go run ./tool\n\nfunc main() { println(Gerado) }\n')
    fx.write(dir, 'cmd/gen/tool/main.go', 'package main\n\nimport "os"\n\nfunc main() { os.WriteFile("gerado.go", []byte("package main\\n\\nconst Gerado = \\"veio do generate\\"\\n"), 0o644) }\n')
    await openProject(page, dir)
    await openDialog(page)
    await newConfig(page, 'Go Build')
    await dlg(page).getByLabel('Nome').fill('Gerar e rodar')
    await dlg(page).getByRole('textbox', { name: 'Pasta', exact: true }).fill('cmd/gen')
    await dlg(page).getByRole('button', { name: 'Adicionar tarefa' }).click()
    await page.getByRole('menuitem', { name: 'go generate' }).click()
    await expect(dlg(page).getByRole('list', { name: 'Tarefas antes de rodar' }).getByRole('listitem')).toHaveCount(1)
    expect(await a11y(page)).toEqual([])
    await dlg(page).getByRole('button', { name: 'OK' }).click()
    await expect(dlg(page)).toBeHidden()
    await page.keyboard.press('Shift+F10')
    await expect(log(page)).toContainText('veio do generate', { timeout: 90_000 })

    // Um comando que falha antes: nada é compilado.
    await openDialog(page)
    await dlg(page).getByRole('button', { name: 'Adicionar tarefa' }).click()
    await page.getByRole('menuitem', { name: 'Comando' }).click()
    await dlg(page).getByLabel('Comando da tarefa 2').fill('go vet ./nao-existe')
    await dlg(page).getByRole('button', { name: 'Subir a tarefa 2' }).click()
    await dlg(page).getByRole('button', { name: 'OK' }).click()
    await expect(dlg(page)).toBeHidden() // gravou: só então roda
    await page.keyboard.press('Shift+F10')
    await expect(log(page)).toContainText('A tarefa 1 antes de rodar falhou', { timeout: 60_000 })
    await expect(log(page)).not.toContainText('$ go build')
  })

  test('S12-H6 guardar como arquivo do projeto; o arquivo que chega pelo git aparece na lista', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.write(dir, '.goide/run/Do colega.json', JSON.stringify({ name: 'Do colega', type: 'go_build', runKind: 'directory', directory: 'cmd/shop', runAfterBuild: true, useBuildTags: true, programArgs: '-v' }))
    await openProject(page, dir)
    await openDialog(page)
    await expect(list(page).getByRole('option', { name: /^Do colega/ })).toBeVisible()
    await newConfig(page, 'Go Build')
    await dlg(page).getByLabel('Nome').fill('Minha')
    await dlg(page).getByRole('textbox', { name: 'Pasta', exact: true }).fill('cmd/shop')
    await dlg(page).getByRole('checkbox', { name: 'Guardar como arquivo do projeto' }).click({ force: true })
    await expect(dlg(page)).toContainText('Fica em .goide/run/')
    await dlg(page).getByRole('button', { name: 'OK' }).click()
    await expect(dlg(page)).toBeHidden()
    const saved = JSON.parse(fx.read(dir, '.goide/run/Minha.json'))
    expect(saved).toMatchObject({ name: 'Minha', directory: 'cmd/shop' })
    expect(saved.id).toBeUndefined()
  })

  test('S12-H3 temporária do gutter vira permanente; duplicar; apagar; Cancelar descarta', async ({ page, fx }) => {
    await openProject(page, fx.seed())
    await openFile(page, 'cmd/shop/main.go')
    await page.locator('.goide-run-glyph').first().click()
    await expect(log(page).getByText('Total: R$ 93,90')).toBeVisible({ timeout: 60_000 })
    await openDialog(page)
    await expect(list(page).getByRole('option', { name: 'go build cmd/shop, temporária' })).toHaveAttribute('aria-selected', 'true')
    await dlg(page).getByRole('button', { name: 'Salvar como permanente' }).click()
    await dlg(page).getByRole('button', { name: 'Duplicar' }).click()
    await expect(list(page).getByRole('option', { name: /^go build cmd\/shop \(cópia\)/ })).toHaveAttribute('aria-selected', 'true')
    await dlg(page).getByRole('button', { name: 'Aplicar' }).click()
    // Aplicado: nenhuma fica marcada como alterada.
    await expect(list(page).getByRole('option', { name: 'go build cmd/shop', exact: true })).toBeVisible()
    await expect(list(page).getByRole('option', { name: 'go build cmd/shop (cópia)', exact: true })).toBeVisible()

    // Apagar e cancelar: nada muda.
    await dlg(page).getByRole('button', { name: 'Apagar' }).click()
    await expect(list(page).getByRole('option')).toHaveCount(1)
    await dlg(page).getByRole('button', { name: 'Cancelar' }).click()
    await openDialog(page)
    await expect(list(page).getByRole('option')).toHaveCount(2)
    // Apagar e OK: some de verdade (e do menu do cabeçalho).
    await list(page).getByRole('option', { name: 'go build cmd/shop (cópia)', exact: true }).click()
    await dlg(page).getByRole('button', { name: 'Apagar' }).click()
    await dlg(page).getByRole('button', { name: 'OK' }).click()
    await cfgButton(page).click()
    await expect(page.getByRole('menuitem', { name: /cópia/ })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'go build cmd/shop ★' })).toBeVisible()
  })
})
