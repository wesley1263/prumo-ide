// F15 histórico: S24 Git > Log (grafo, filtros, detalhes, diff de um commit) e S27 anotar com git blame.
import { test, expect, openProject, openFile, a11y, mod, type Fixture } from './helpers'
import type { Page } from '@playwright/test'

const panel = (page: Page) => page.getByRole('region', { name: 'Git' })
const grid = (page: Page) => panel(page).getByRole('grid', { name: 'Commits' })

/** Projeto de exemplo com mais histórico: dois commits na main e um numa branch. */
function seedHistory(fx: Fixture) {
  const dir = fx.seed()
  fx.git(dir, 'commit', '-qam', 'catálogo: Count')
  fx.git(dir, 'checkout', '-qb', 'feat/frete')
  fx.write(dir, 'internal/cart/frete.go', 'package cart\n\n// Frete grátis acima de R$ 100.\nfunc Frete(total int) int {\n\tif total >= 10000 {\n\t\treturn 0\n\t}\n\treturn 1500\n}\n')
  fx.git(dir, 'add', '-A')
  fx.git(dir, 'commit', '-qm', 'frete grátis acima de 100')
  fx.git(dir, 'checkout', '-q', 'main')
  return dir
}

async function runAction(page: Page, name: string) {
  await page.keyboard.press(`${mod}+Shift+A`)
  const dlg = page.getByRole('dialog', { name: 'Buscar em tudo' })
  await dlg.getByRole('combobox').fill(name)
  await expect(dlg.getByRole('option').first()).toHaveAccessibleName(new RegExp(`^${name}`))
  await dlg.getByRole('combobox').press('Enter')
  await expect(dlg).toBeHidden()
}

test.describe('F15 histórico do git', () => {
  test('F15-H1 Log com grafo e branches, detalhes do commit e diff', async ({ page, fx }) => {
    await openProject(page, seedHistory(fx))
    await page.keyboard.press('Alt+9')
    await expect(grid(page)).toBeVisible()
    const rows = grid(page).getByRole('row')
    await expect(rows).toHaveCount(3)
    // Ordem por data, com os rótulos de branch.
    await expect(rows.filter({ hasText: 'frete grátis acima de 100' })).toHaveAccessibleName(/feat\/frete/)
    await expect(rows.filter({ hasText: 'catálogo: Count' })).toHaveAccessibleName(/main/)
    await expect(grid(page).locator('svg path')).not.toHaveCount(0) // o grafo foi desenhado
    expect(await a11y(page)).toEqual([])

    // Selecionar: detalhes e arquivos alterados; duplo clique abre o diff daquele commit.
    await rows.filter({ hasText: 'frete grátis' }).click()
    const details = panel(page).getByRole('region', { name: 'Detalhes do commit' })
    await expect(details).toContainText('frete grátis acima de 100')
    await expect(details).toContainText('Em: feat/frete')
    await details.getByRole('button', { name: 'internal/cart/frete.go, adicionado' }).dblclick()
    await expect(page.getByRole('tab', { name: /^frete\.go \([0-9a-f]{7}\)$/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.monaco-diff-editor .editor.modified')).toContainText('Frete grátis acima')

    // Teclado: ↓ seleciona o próximo commit.
    await grid(page).focus()
    await page.keyboard.press('ArrowDown')
    await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true')

    // Filtros: texto e branch.
    await panel(page).getByLabel('Filtrar por mensagem').fill('catálogo')
    await expect(rows).toHaveCount(2)
    await panel(page).getByRole('button', { name: 'Limpar filtros' }).click()
    await expect(rows).toHaveCount(3)
    await panel(page).getByRole('button', { name: /^Branch: / }).click()
    await page.getByRole('menuitem', { name: 'main', exact: true }).click()
    await expect(rows).toHaveCount(2)
    await panel(page).getByLabel('Filtrar por mensagem').fill('nada disso')
    await expect(panel(page)).toContainText('Nenhum commit com esses filtros')
  })

  test('F15-H2 commit novo aparece no Log sem recarregar', async ({ page, fx }) => {
    const dir = seedHistory(fx)
    fx.write(dir, 'README.md', fx.read(dir, 'README.md') + '\nFrete grátis acima de R$ 100.\n')
    await openProject(page, dir)
    await page.keyboard.press('Alt+9')
    await expect(grid(page).getByRole('row')).toHaveCount(3)
    // Commit pela própria IDE (Ctrl+K): o Log se atualiza pelo evento git:status.
    await page.keyboard.press(`${mod}+K`)
    const commit = page.getByRole('region', { name: 'Commit' })
    await commit.getByLabel('Mensagem do commit').fill('notas do frete')
    await commit.getByRole('button', { name: 'Commit', exact: true }).click()
    // O Log continua aberto embaixo (o Commit fica à esquerda).
    await expect(grid(page).getByRole('row').first()).toHaveAccessibleName(/^notas do frete/)
  })

  test('F15-H3 anotar com git blame, clicar na anotação, histórico do arquivo', async ({ page, fx }) => {
    const dir = seedHistory(fx)
    fx.write(dir, 'internal/catalog/catalog.go', fx.read(dir, 'internal/catalog/catalog.go') + '\n// ainda não commitado\n')
    await openProject(page, dir)
    await openFile(page, 'internal/catalog/catalog.go')
    await runAction(page, 'Anotar com git blame')
    const notes = page.locator('.monaco-editor .prumo-blame')
    await expect(notes.first()).toContainText(/[0-9a-f]{7}\sDemo/) // o Monaco desenha os espaços como &nbsp;
    await expect(page.locator('.monaco-editor .prumo-blame-age-pending').first()).toContainText(/não\scommitado/)

    // Clicar na anotação da 1ª linha abre o commit dela no Log.
    await notes.first().click()
    await expect(grid(page)).toBeVisible()
    await expect(grid(page).getByRole('row', { selected: true })).toHaveAccessibleName(/^catálogo e carrinho/)

    // De novo: desliga.
    await page.getByRole('tab', { name: /^catalog\.go/ }).click()
    await runAction(page, 'Anotar com git blame')
    await expect(notes).toHaveCount(0)

    // Histórico do arquivo: só os commits que mexeram nele.
    await runAction(page, 'Histórico do arquivo')
    await expect(panel(page)).toContainText('Arquivo: internal/catalog/catalog.go')
    await expect(grid(page).getByRole('row')).toHaveCount(2)
    await panel(page).getByRole('button', { name: 'Tirar o filtro de arquivo' }).click()
    await expect(grid(page).getByRole('row')).toHaveCount(3)
  })

  test('F15-H5 pelo Log: cherry-pick, revert e reset hard com confirmação', async ({ page, fx }) => {
    const dir = seedHistory(fx)
    await openProject(page, dir)
    await page.keyboard.press('Alt+9')
    const rows = grid(page).getByRole('row')
    await expect(rows).toHaveCount(3)
    const subject = () => fx.git(dir, 'log', '-1', '--format=%s', 'main')

    // Cherry-pick do commit da feat/frete na main (o branch atual).
    await rows.filter({ hasText: 'frete grátis acima de 100' }).click({ button: 'right' })
    const menu = page.getByRole('menu', { name: /^Commit [0-9a-f]{7}$/ })
    await expect(menu).toBeVisible()
    expect(await a11y(page)).toEqual([])
    await menu.getByRole('menuitem', { name: 'Cherry-pick no branch atual' }).click()
    await expect(page.getByText('Cherry-pick feito.')).toBeVisible()
    expect(subject()).toBe('frete grátis acima de 100')
    expect(fx.read(dir, 'internal/cart/frete.go')).toContain('func Frete')
    await expect(rows).toHaveCount(4)

    // Revert do que entrou: commit novo que desfaz.
    await rows.filter({ hasText: 'frete grátis acima de 100' }).filter({ has: page.getByText('main', { exact: true }) }).click({ button: 'right' })
    await menu.getByRole('menuitem', { name: 'Reverter o commit' }).click()
    await expect(page.getByText(/Revert feito/)).toBeVisible()
    expect(subject()).toBe('Revert "frete grátis acima de 100"')
    await expect(rows).toHaveCount(5)

    // Reset hard pela tecla de menu, com confirmação: volta ao "catálogo: Count".
    await rows.filter({ hasText: 'catálogo: Count' }).click()
    await grid(page).press('ContextMenu')
    await menu.getByRole('menuitem', { name: /hard: descarta/ }).click()
    const confirm = page.getByRole('dialog', { name: 'Reset hard?' })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Descartar e mover' }).click()
    await expect(page.getByText(/Branch movido para [0-9a-f]{7}\./)).toBeVisible()
    expect(subject()).toBe('catálogo: Count')
    await expect(rows).toHaveCount(3)
  })

  test('F15-H7 rebase interativo: reword, fixup e drop pelo Log', async ({ page, fx }) => {
    const dir = fx.seed()
    fx.git(dir, 'commit', '-qam', 'base')
    for (const n of ['um', 'dois', 'três']) {
      fx.write(dir, `notas/${n}.txt`, n + '\n')
      fx.git(dir, 'add', '-A')
      fx.git(dir, 'commit', '-qm', `nota ${n}`)
    }
    await openProject(page, dir)
    await page.keyboard.press('Alt+9')
    await grid(page).getByRole('row').filter({ hasText: /^.*base/ }).first().click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Rebase interativo a partir daqui…' }).click()
    const dlg = page.getByRole('dialog', { name: /^Rebase interativo depois de [0-9a-f]{7}$/ })
    const rows = dlg.getByRole('list', { name: 'Commits do rebase' }).getByRole('listitem')
    await expect(rows).toHaveCount(3)
    expect(await a11y(page)).toEqual([])
    await dlg.getByLabel('Ação para nota um').selectOption('reword')
    await dlg.getByLabel('Nova mensagem de nota um').fill('notas: um (revisado)')
    await dlg.getByLabel('Ação para nota dois').selectOption('fixup')
    await dlg.getByLabel('Ação para nota três').selectOption('drop')
    await dlg.getByRole('button', { name: 'Começar o rebase' }).click()
    await expect(page.getByText('Rebase interativo concluído.')).toBeVisible({ timeout: 20_000 })
    expect(fx.git(dir, 'log', '-2', '--format=%s')).toBe('notas: um (revisado)\nbase')
    expect(fx.git(dir, 'ls-files', 'notas')).toBe('notas/dois.txt\nnotas/um.txt')
  })
})
