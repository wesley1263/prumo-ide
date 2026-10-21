// Anexar o depurador a um "dlv --headless" (modo remoto): para no breakpoint; parar só desconecta.
import { test, expect, openProject, openFile } from './helpers'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

test.describe.configure({ timeout: 180_000 })

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
  })

test('F10-H8 anexar a um Delve remoto', async ({ page, fx }) => {
  const dir = fx.seed()
  const dlv = existsSync(join(homedir(), 'go', 'bin', 'dlv')) ? join(homedir(), 'go', 'bin', 'dlv') : 'dlv'
  const port = await freePort()
  const head = spawn(dlv, ['debug', './cmd/shop', '--headless', `--listen=127.0.0.1:${port}`, '--api-version=2', '--accept-multiclient'], { cwd: dir, detached: true })
  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('dlv headless não subiu')), 120_000)
      head.stdout.on('data', (b) => String(b).includes('API server listening') && (clearTimeout(t), resolve()))
    })
    await openProject(page, dir)
    await openFile(page, 'internal/cart/cart.go')
    await page.locator('.monaco-editor .line-numbers').filter({ hasText: /^35$/ }).click()
    await expect(page.locator('.goide-bp')).toHaveCount(1)
    await page.keyboard.press('Control+Alt+F5')
    const dlg = page.getByRole('dialog', { name: 'Anexar o depurador' })
    await dlg.getByRole('tab', { name: 'Delve remoto (headless)' }).click()
    await dlg.getByLabel('Endereço do Delve').fill(`127.0.0.1:${port}`)
    await dlg.getByRole('button', { name: 'Anexar' }).click()
    const dbg = page.getByRole('region', { name: 'Depurar' })
    await expect(dbg.getByText(/parado \(breakpoint\)/)).toBeVisible({ timeout: 60_000 })
    await page.keyboard.press('Control+F2')
    await expect(dbg.getByText(/encerrado/)).toBeVisible({ timeout: 20_000 })
    expect(head.exitCode).toBeNull() // o headless continua de pé
  } finally {
    try {
      process.kill(-head.pid!, 'SIGKILL')
    } catch {}
  }
})
