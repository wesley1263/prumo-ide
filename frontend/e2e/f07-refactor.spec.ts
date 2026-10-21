// Refatorações pelo gopls: inline (Ctrl+Alt+N), mudar assinatura (Ctrl+F6) e safe delete (Alt+Delete).
import { test, expect, openProject, openFile, cursorAt, editorValue, a11y } from './helpers'

const CALC = `package cart

// dobro devolve o dobro.
func dobro(x int) int { return x * 2 }

// soma junta a e b.
func soma(a int, b string) string { return b }

func usa() string {
	_ = dobro(3)
	return soma(1, "x")
}

// sobra não é usada por ninguém.
func sobra() {}
`

test('F07-H7 inline, mudar assinatura e safe delete', async ({ page, fx }) => {
  const dir = fx.seed()
  fx.write(dir, 'internal/cart/calc.go', CALC)
  await openProject(page, dir)
  await openFile(page, 'internal/cart/calc.go')

  // Inline da chamada dobro(3).
  await cursorAt(page, '_ = dob')
  await page.keyboard.press('Control+Alt+N')
  await expect.poll(() => editorValue(page), { timeout: 20_000 }).toMatch(/_ = 3 \* 2/)

  // Mudar assinatura: mover o parâmetro "a" para a direita; a chamada acompanha.
  await cursorAt(page, 'func soma(a', 'after')
  await page.keyboard.press('ArrowLeft')
  // Logo depois do inline o gopls ainda pode estar reanalisando: se o menu vier sem a ação, fecha e pede de novo.
  await expect(async () => {
    await page.keyboard.press('Control+F6')
    await expect(page.getByText('Move parameter right', { exact: true })).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
  await page.getByText('Move parameter right', { exact: true }).click()
  await expect.poll(() => editorValue(page), { timeout: 20_000 }).toContain('func soma(b string, a int) string')
  expect(await editorValue(page)).toContain('soma("x", 1)')

  // Safe delete de quem é usado: recusa e mostra os usos.
  await cursorAt(page, 'func soma', 'after')
  await page.keyboard.press('Alt+Delete')
  const blocked = page.getByRole('dialog', { name: 'soma ainda é usado' })
  await expect(blocked).toBeVisible({ timeout: 20_000 })
  await expect(blocked.getByRole('list', { name: 'Usos' })).toContainText('internal/cart/calc.go:')
  expect(await a11y(page)).toEqual([])
  await blocked.getByRole('button', { name: 'Cancelar' }).click()

  // Safe delete de quem ninguém usa: some, com o comentário de doc.
  await cursorAt(page, 'func sobra', 'after')
  await page.keyboard.press('Alt+Delete')
  await expect(page.getByText('sobra apagado')).toBeVisible({ timeout: 20_000 })
  const v = await editorValue(page)
  expect(v).not.toContain('sobra')
  expect(v.endsWith('}\n')).toBe(true)
})
