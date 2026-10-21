// F14 conflitos: S25 lista de arquivos (o meu, o deles, mesclar) e S26 merge em 3 painéis.
import { test, expect, openProject, a11y, type Fixture } from './helpers'
import type { Page } from '@playwright/test'

const commitPanel = (page: Page) => page.getByRole('region', { name: 'Commit' })
const conflicts = (page: Page) => page.getByRole('dialog', { name: /^Conflitos/ })
const merge = (page: Page) => page.getByRole('dialog', { name: /^Mesclar / })

/**
 * Merge da branch feat na main parado em conflito:
 * - catalog.go: as duas mudaram o preço do café (conflito) e só a feat mudou o comentário do pacote (mescla sozinho);
 * - README.md: as duas reescreveram o título (conflito).
 */
function seedConflict(fx: Fixture) {
  const dir = fx.seed()
  fx.git(dir, 'commit', '-qam', 'catálogo: Count')
  const cat = fx.read(dir, 'internal/catalog/catalog.go')
  fx.git(dir, 'checkout', '-qb', 'feat')
  fx.write(dir, 'internal/catalog/catalog.go', cat.replace('da loja.', 'da loja online.').replace('Price: 3490', 'Price: 3290'))
  fx.write(dir, 'README.md', '# demo-shop (feat)\n')
  fx.git(dir, 'commit', '-qam', 'feat: preço e readme')
  fx.git(dir, 'checkout', '-q', 'main')
  fx.write(dir, 'internal/catalog/catalog.go', cat.replace('Price: 3490', 'Price: 3590'))
  fx.write(dir, 'README.md', '# demo-shop (main)\n')
  fx.git(dir, 'commit', '-qam', 'main: preço e readme')
  try {
    fx.git(dir, 'merge', 'feat')
  } catch {
    /* parou em conflito, como esperado */
  }
  return dir
}

test.describe('F14 conflitos', () => {
  test('F14-H3 mesclar em 3 painéis, aceitar o deles noutro arquivo e concluir o merge', async ({ page, fx }) => {
    const dir = seedConflict(fx)
    await openProject(page, dir)
    await page.keyboard.press('Alt+0')
    await expect(commitPanel(page)).toContainText('Merge em andamento: 2 arquivo(s) em conflito.')
    await commitPanel(page).getByRole('button', { name: 'Resolver conflitos…' }).click()
    await expect(conflicts(page)).toHaveAccessibleName('Conflitos (2)')
    expect(await a11y(page)).toEqual([])

    // README: fica com a versão que chegou, inteira.
    await conflicts(page).getByRole('button', { name: 'Aceitar o deles: README.md' }).click()
    await expect(conflicts(page)).toHaveAccessibleName('Conflitos (1)')
    expect(fx.read(dir, 'README.md')).toBe('# demo-shop (feat)\n')

    // catalog.go: merge em 3 painéis.
    await conflicts(page).getByRole('button', { name: 'Mesclar: internal/catalog/catalog.go' }).click()
    await expect(merge(page)).toBeVisible()
    await expect(merge(page).getByRole('status')).toHaveText('1 de 1 conflito(s) por resolver')
    await expect(merge(page).getByRole('region', { name: /^Suas mudanças \(main\)/ })).toContainText('3590')
    await expect(merge(page).getByRole('region', { name: /^Mudanças que chegaram \(feat/ })).toContainText('3290')
    // O que não conflita já está no resultado; o conflito começa com a base (3490).
    const result = merge(page).getByRole('region', { name: 'Resultado' })
    await expect(result).toContainText('da loja online.')
    await expect(result).toContainText('3490')
    expect(await a11y(page)).toEqual([])
    await merge(page).getByRole('button', { name: 'Aceitar o deles' }).click()
    await expect(merge(page).getByRole('status')).toHaveText('Todos os conflitos resolvidos')
    await expect(result).toContainText('3290')
    await merge(page).getByRole('button', { name: 'Aplicar' }).click()
    await expect(merge(page)).toBeHidden()
    const cat = fx.read(dir, 'internal/catalog/catalog.go')
    expect(cat).toContain('da loja online.')
    expect(cat).toContain('Price: 3290')
    expect(cat).not.toContain('<<<<')

    // De volta à lista: tudo resolvido, concluir cria o commit de merge.
    await expect(conflicts(page)).toHaveAccessibleName('Conflitos resolvidos')
    await conflicts(page).getByRole('button', { name: 'Concluir merge' }).click()
    await expect(page.getByText('Merge concluído.')).toBeVisible()
    await expect(commitPanel(page).getByText(/Merge em andamento/)).toBeHidden()
    expect(fx.git(dir, 'log', '-1', '--format=%P').split(' ')).toHaveLength(2)
    expect(fx.git(dir, 'status', '--porcelain')).toBe('?? NOTES.md')
  })

  test('F14-H4 aceitar os dois; aplicar com conflito pendente pede confirmação', async ({ page, fx }) => {
    const dir = seedConflict(fx)
    await openProject(page, dir)
    await page.keyboard.press('Alt+0')
    await commitPanel(page).getByRole('button', { name: 'Resolver conflitos…' }).click()
    await conflicts(page).getByRole('button', { name: 'Mesclar: README.md' }).click()
    await expect(merge(page).getByRole('status')).toHaveText('1 de 1 conflito(s) por resolver')
    await merge(page).getByRole('button', { name: 'Aceitar os dois' }).click()
    await merge(page).getByRole('button', { name: 'Aplicar' }).click()
    await expect(merge(page)).toBeHidden()
    expect(fx.read(dir, 'README.md')).toBe('# demo-shop (main)\n# demo-shop (feat)\n')

    await conflicts(page).getByRole('button', { name: 'Mesclar: internal/catalog/catalog.go' }).click()
    await merge(page).getByRole('button', { name: 'Aplicar' }).click()
    const confirm = page.getByRole('dialog', { name: 'Ainda há conflitos sem resolver' })
    await expect(confirm).toContainText('1 conflito(s) ficam com o texto da base')
    await confirm.getByRole('button', { name: 'Aplicar mesmo assim' }).click()
    await expect(merge(page)).toBeHidden()
    expect(fx.read(dir, 'internal/catalog/catalog.go')).toContain('Price: 3490')

    // Cancelar na lista e abortar pelo aviso: volta ao estado de antes do merge.
    await conflicts(page).getByRole('button', { name: 'Abortar merge' }).click()
    await expect(commitPanel(page).getByText(/Merge em andamento/)).toBeHidden()
    expect(fx.read(dir, 'README.md')).toBe('# demo-shop (main)\n')
  })
})
