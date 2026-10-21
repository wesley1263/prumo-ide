// S02 Novo projeto: cria a pasta, roda go mod init, escreve o main.go e abre já confiável.
import { test, expect, a11y } from './helpers'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { Page } from '@playwright/test'

const dlg = (page: Page) => page.getByRole('dialog', { name: 'Novo projeto Go' })

async function openNew(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Novo projeto' }).first().click()
  await expect(dlg(page)).toBeVisible()
}

test.describe('S02 novo projeto', () => {
  test('S02-H1 cria o módulo com main.go e abre sem pedir confiança', async ({ page, fx }) => {
    await openNew(page)
    await dlg(page).getByLabel('Pasta-mãe').fill(fx.base)
    await dlg(page).getByLabel('Nome do projeto').fill('minha-api')
    // O caminho do módulo acompanha o nome até ser editado.
    await expect(dlg(page).getByLabel('Caminho do módulo')).toHaveValue('minha-api')
    await dlg(page).getByLabel('Caminho do módulo').fill('example.com/org/minha-api')
    await expect(dlg(page)).toContainText(`Vai criar ${join(fx.base, 'minha-api')}`)
    expect(await a11y(page)).toEqual([])
    await dlg(page).getByRole('button', { name: 'Criar' }).click()

    const tree = page.getByRole('tree', { name: 'Arquivos do projeto' })
    await expect(tree.getByRole('treeitem', { name: /^main\.go/ })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('dialog', { name: 'Confiar neste projeto?' })).toHaveCount(0)
    const root = join(fx.base, 'minha-api')
    expect(readFileSync(join(root, 'go.mod'), 'utf8')).toContain('module example.com/org/minha-api')
    expect(readFileSync(join(root, 'main.go'), 'utf8')).toContain('func main()')
  })

  test('S02-N1 nome inválido, pasta ocupada e sem main.go', async ({ page, fx }) => {
    mkdirSync(join(fx.base, 'ocupada'))
    writeFileSync(join(fx.base, 'ocupada', 'x.txt'), 'x')
    await openNew(page)
    await dlg(page).getByLabel('Pasta-mãe').fill(fx.base)
    const name = dlg(page).getByLabel('Nome do projeto')
    await name.fill('com espaço')
    await dlg(page).getByRole('button', { name: 'Criar' }).click()
    await expect(dlg(page)).toContainText('nome de pasta inválido')
    await name.fill('ocupada')
    await dlg(page).getByRole('button', { name: 'Criar' }).click()
    await expect(dlg(page)).toContainText('já existe e não está vazia')

    await name.fill('so-mod')
    await dlg(page).getByRole('checkbox', { name: 'Criar um main.go de exemplo' }).click({ force: true })
    await dlg(page).getByRole('button', { name: 'Criar' }).click()
    await expect(page.getByRole('tree', { name: 'Arquivos do projeto' }).getByRole('treeitem', { name: /^go\.mod/ })).toBeVisible({ timeout: 30_000 })
    expect(existsSync(join(fx.base, 'so-mod', 'main.go'))).toBe(false)
  })
})
