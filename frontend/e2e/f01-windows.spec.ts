// F01 Vários projetos abertos: abrir outro projeto pergunta "esta janela ou nova janela". No app cada janela é
// um processo do Prumo; aqui (modo dev, navegador) a janela nova é outra aba no mesmo backend.
import { test, expect, openProject } from './helpers'
import type { Page } from '@playwright/test'

const projectButton = (page: Page, name: string) => page.getByRole('banner').getByRole('button', { name: `Projeto: ${name}` })

/** Projeto sem confiança: a pergunta volta a cada abertura; responde "Modo restrito". */
async function restricted(page: Page) {
  const dlg = page.getByRole('dialog', { name: 'Confiar neste projeto?' })
  await dlg.getByRole('button', { name: 'Modo restrito' }).click()
  await expect(dlg).toBeHidden()
}

async function pickRecent(page: Page, current: string, other: string) {
  await projectButton(page, current).click()
  await page.getByRole('menuitem', { name: new RegExp(`^${other}`) }).click()
}

test.describe('F01 várias janelas', () => {
  test('F01-H5 abrir outro projeto: nova janela mantém o atual; esta janela troca; cancelar não faz nada', async ({ page, fx }) => {
    const a = fx.seed('loja-a')
    const b = fx.seed('loja-b')
    await openProject(page, b, { trust: false })
    // "Abrir ou clonar outro…" também pergunta; nesta janela, volta para a tela inicial.
    await projectButton(page, 'loja-b').click()
    await page.getByRole('menuitem', { name: 'Abrir ou clonar outro…' }).click()
    let dlg = page.getByRole('dialog', { name: 'Abrir outro projeto' })
    await expect(dlg).toContainText('loja-b continua aberto')
    await dlg.getByRole('button', { name: 'Esta janela' }).click()
    await expect(page.getByRole('button', { name: 'Abrir', exact: true }).first()).toBeVisible() // tela inicial
    await openProject(page, a, { trust: false })
    await expect(page).toHaveTitle('loja-a – Prumo')

    // Cancelar: nada muda.
    await pickRecent(page, 'loja-a', 'loja-b')
    dlg = page.getByRole('dialog', { name: 'Abrir loja-b' })
    await dlg.getByRole('button', { name: 'Cancelar' }).click()
    await expect(dlg).toBeHidden()
    await expect(projectButton(page, 'loja-a')).toBeVisible()

    // Nova janela: o projeto abre nela, e esta continua no projeto atual.
    await pickRecent(page, 'loja-a', 'loja-b')
    const [win] = await Promise.all([page.context().waitForEvent('page'), dlg.getByRole('button', { name: 'Nova janela' }).click()])
    await restricted(win)
    await expect(projectButton(win, 'loja-b')).toBeVisible()
    await expect(win).toHaveTitle('loja-b – Prumo')
    await expect(win).not.toHaveURL(/project=/) // recarregar a janela nova não reabre por cima
    await expect(projectButton(page, 'loja-a')).toBeVisible()
    await win.close()

    // Esta janela: troca de projeto.
    await pickRecent(page, 'loja-a', 'loja-b')
    await dlg.getByRole('button', { name: 'Esta janela' }).click()
    await restricted(page)
    await expect(projectButton(page, 'loja-b')).toBeVisible()
  })

  test('F01-H6 "lembrar a escolha" deixa de perguntar e volta a perguntar pelas Configurações', async ({ page, fx }) => {
    const a = fx.seed('loja-a')
    const b = fx.seed('loja-b')
    await openProject(page, b, { trust: false })
    await openProject(page, a, { trust: false }) // recarrega: os dois ficam nos recentes
    await pickRecent(page, 'loja-a', 'loja-b')
    const dlg = page.getByRole('dialog', { name: 'Abrir loja-b' })
    await dlg.getByText('Lembrar a escolha e não perguntar de novo').click()
    await dlg.getByRole('button', { name: 'Esta janela' }).click()
    await restricted(page)
    await expect(projectButton(page, 'loja-b')).toBeVisible()

    // Sem perguntar: troca direto.
    await pickRecent(page, 'loja-b', 'loja-a')
    await restricted(page)
    await expect(projectButton(page, 'loja-a')).toBeVisible()
    await expect(page.getByRole('dialog', { name: /^Abrir/ })).toBeHidden()

    // Configurações → Aparência mostra a escolha e volta para "Perguntar".
    await page.getByRole('button', { name: 'Menu principal' }).click()
    await page.getByRole('menuitem', { name: 'Configurações…' }).click()
    const settings = page.getByRole('dialog', { name: 'Configurações' })
    const group = settings.getByRole('radiogroup', { name: 'Abrir outro projeto com um já aberto' })
    await expect(group.getByRole('radio', { name: 'Nesta janela' })).toBeChecked()
    await group.getByText('Perguntar').click()
    await settings.getByRole('button', { name: 'Cancelar' }).click()
    await pickRecent(page, 'loja-a', 'loja-b')
    await expect(page.getByRole('dialog', { name: 'Abrir loja-b' })).toBeVisible()
  })
})
