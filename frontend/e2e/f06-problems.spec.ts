// S10 Problemas: filtros por gravidade e por arquivo, e "Corrigir…" abre as correções do gopls no lugar.
import { test, expect, openProject, openFile, editorValue, a11y } from './helpers'
import type { Page } from '@playwright/test'

const panel = (page: Page) => page.getByRole('region', { name: 'Problemas' })

test('F06-H3 filtrar problemas e corrigir pela lista', async ({ page, fx }) => {
  const dir = fx.seed()
  // Um erro com correção (import faltando) e, noutro pacote, um aviso (formato do Printf errado):
  // o gopls não roda os analisadores num pacote que tem erro de tipo.
  fx.write(dir, 'internal/cart/extra.go', 'package cart\n\nfunc Upper(s string) string { return strings.ToUpper(s) }\n')
  fx.write(dir, 'internal/catalog/mostra.go', 'package catalog\n\nimport "fmt"\n\nfunc Mostra() { fmt.Printf("%d\\n", "texto") }\n')
  await openProject(page, dir)
  await openFile(page, 'internal/catalog/mostra.go')
  await openFile(page, 'internal/cart/extra.go')
  await page.keyboard.press('Alt+6')
  const list = panel(page).getByRole('list', { name: 'Problemas por arquivo' })
  await expect(list.getByRole('button', { name: /^Erro: undefined: strings/ })).toBeVisible({ timeout: 60_000 })
  await expect(list.getByRole('button', { name: /^Aviso: .*Printf format %d/ })).toBeVisible()
  expect(await a11y(page)).toEqual([])

  // Só avisos.
  await panel(page).getByRole('button', { name: /^Erros \(/ }).click()
  await expect(list.getByRole('button', { name: /^Erro:/ })).toHaveCount(0)
  await expect(list.getByRole('button', { name: /^Aviso:/ })).toHaveCount(1)
  await panel(page).getByRole('button', { name: /^Erros \(/ }).click()

  // Só o arquivo atual: outro arquivo aberto, a lista esvazia.
  await panel(page).getByRole('button', { name: 'Só o arquivo atual' }).click()
  await openFile(page, 'cmd/shop/main.go')
  await expect(panel(page)).toContainText('Nada com esses filtros')
  await panel(page).getByRole('button', { name: 'Só o arquivo atual' }).click()

  // Corrigir: abre o arquivo no erro e mostra as correções; escolher "Add import" resolve.
  const row = list.getByRole('listitem').filter({ has: page.getByRole('button', { name: /^Erro: undefined: strings/ }) }).last() // o do arquivo também contém
  await row.hover()
  await row.getByRole('button', { name: 'Corrigir…' }).click()
  await expect(page.getByRole('tab', { name: 'extra.go', exact: true })).toHaveAttribute('aria-selected', 'true')
  const fixAction = page.locator('.action-widget').getByText(/import "strings"|Add import/i).first()
  await expect(fixAction).toBeVisible({ timeout: 30_000 })
  await fixAction.click()
  await expect.poll(() => editorValue(page)).toMatch(/import \(\s*"fmt"\s*"strings"\s*\)|"strings"/)
})
