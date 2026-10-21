// F02 clonar um repositório e abrir (S29), a partir da tela inicial.
import { test, expect, a11y } from './helpers'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { Page } from '@playwright/test'

const dlg = (page: Page) => page.getByRole('dialog', { name: 'Clonar repositório' })

async function openClone(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Clonar', exact: true }).first().click()
  await expect(dlg(page)).toBeVisible()
}

test.describe('F02 clonar', () => {
  test('F02-H1 clonar, confiar e abrir o projeto', async ({ page, fx }) => {
    const bare = fx.remote(fx.seed())
    await openClone(page)
    await dlg(page).getByLabel('URL do repositório').fill(bare)
    await dlg(page).getByLabel('Pasta de destino').fill(fx.base)
    // O nome sai da URL (remoto.git → remoto), mas dá para trocar.
    await expect(dlg(page).getByLabel('Nome da pasta')).toHaveValue('remoto')
    await dlg(page).getByLabel('Nome da pasta').fill('minha-loja')
    await expect(dlg(page)).toContainText(`Vai clonar em ${join(fx.base, 'minha-loja')}`)
    expect(await a11y(page)).toEqual([])
    await dlg(page).getByRole('button', { name: 'Clonar', exact: true }).click()

    const trust = page.getByRole('dialog', { name: 'Confiar neste projeto?' })
    await expect(trust).toBeVisible({ timeout: 30_000 })
    await trust.getByRole('button', { name: 'Confiar' }).click()
    await expect(page.getByRole('tree', { name: 'Arquivos do projeto' }).getByRole('treeitem', { name: /^minha-loja/ })).toBeVisible()
    expect(existsSync(join(fx.base, 'minha-loja', 'go.mod'))).toBe(true)
    expect(fx.git(join(fx.base, 'minha-loja'), 'remote', 'get-url', 'origin')).toBe(bare)
  })

  test('F02-N1 URL inválida, repositório inexistente e pasta ocupada', async ({ page, fx }) => {
    await openClone(page)
    const url = dlg(page).getByLabel('URL do repositório')
    await url.fill('repo sem esquema')
    await dlg(page).getByLabel('Pasta de destino').fill(fx.base)
    await dlg(page).getByRole('button', { name: 'Clonar', exact: true }).click()
    await expect(dlg(page)).toContainText('URL inválida')

    await url.fill(join(fx.base, 'nao-existe.git'))
    await dlg(page).getByRole('button', { name: 'Clonar', exact: true }).click()
    await expect(dlg(page)).toContainText('Repositório não encontrado', { timeout: 30_000 })
    expect(existsSync(join(fx.base, 'nao-existe'))).toBe(false) // nada pela metade

    fx.seed('ocupada')
    await url.fill(fx.remote(join(fx.base, 'ocupada')))
    await dlg(page).getByLabel('Nome da pasta').fill('ocupada')
    await dlg(page).getByRole('button', { name: 'Clonar', exact: true }).click()
    await expect(dlg(page)).toContainText('já existe e não está vazia')
  })
})
