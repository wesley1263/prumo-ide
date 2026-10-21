// S30 notificações: o histórico guarda os avisos da sessão; o ícone mostra quantas são novas até abrir.
import { test, expect, openProject, a11y } from './helpers'
import type { Page } from '@playwright/test'

const rightStripe = (page: Page) => page.getByRole('toolbar', { name: 'Janelas da direita' })

test('S30-H1 avisos vão para o histórico; abrir marca como vistos; limpar', async ({ page, fx }) => {
  await openProject(page, fx.seed())
  // Um aviso de verdade: "Rodar com cobertura" sem uma configuração Go Test escolhida.
  await page.getByRole('tree', { name: 'Arquivos do projeto' }).getByRole('treeitem', { name: 'cmd', exact: true }).click()
  await page.keyboard.press('Control+Shift+A')
  const se = page.getByRole('dialog', { name: 'Buscar em tudo' })
  await se.getByRole('combobox').fill('Rodar com cobertura')
  await se.getByRole('combobox').press('Enter') // sem config Go Test: avisa
  await expect(page.getByText('Escolha uma configuração Go Test').first()).toBeVisible()

  const btn = rightStripe(page).getByRole('button', { name: /^Notificações \(\d+ novas?\)$/ })
  await expect(btn).toBeVisible()
  await btn.click()
  const panel = page.getByRole('region', { name: 'Notificações' })
  await expect(panel.getByRole('list', { name: 'Notificações' })).toContainText('Escolha uma configuração Go Test')
  await expect(rightStripe(page).getByRole('button', { name: 'Notificações', exact: true })).toBeVisible() // vistas
  expect(await a11y(page)).toEqual([])
  await panel.getByRole('button', { name: 'Limpar notificações' }).click()
  await expect(panel).toContainText('Nenhuma notificação')
})
