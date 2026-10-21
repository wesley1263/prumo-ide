// Exit points (cursor no "func" ou num "return" destaca as saídas) e ↻ nas chamadas recursivas.
import { test, expect, openProject, openFile, cursorAt } from './helpers'

const FAT = `package cart

// Fat é o fatorial.
func Fat(n int) int {
	if n <= 1 {
		return 1
	}
	return n * Fat(n-1)
}

// Conta não é recursiva: o Fat dela é a variável.
func Conta() int {
	Fat := func(n int) int { return n }
	return Fat(2)
}
`

test('F03-H10 exit points e chamada recursiva marcada', async ({ page, fx }) => {
  const dir = fx.seed()
  fx.write(dir, 'internal/cart/fat.go', FAT)
  await openProject(page, dir)
  await openFile(page, 'internal/cart/fat.go')
  // Só a chamada de verdade (linha 8) ganha o ↻; a closure sombreada em Conta, não.
  await expect(page.locator('.goide-recursion')).toHaveCount(1, { timeout: 30_000 })
  const hover = await page.evaluate(() => {
    const m = (window as any).__goideEditor.getModel()
    return m.getAllDecorations().filter((d: any) => d.options.glyphMarginClassName === 'goide-recursion').map((d: any) => d.range.startLineNumber)
  })
  expect(hover).toEqual([8])

  // Cursor no "func" do Fat: os dois return ficam destacados.
  await cursorAt(page, 'func Fat', 'before')
  await expect(page.locator('.monaco-editor .wordHighlightText, .monaco-editor .wordHighlight')).toHaveCount(3, { timeout: 15_000 })
})
