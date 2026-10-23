// F03 Ctrl+\ no editor: pede código ao agente de IA da máquina (aqui um agente falso) e aceita ou desfaz o resultado.
// As preferências são globais: volta tudo ao padrão no fim.
import { test, expect, openProject, openFile, editorValue, cursorAt, mod, API, token } from './helpers'
import { join } from 'node:path'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'

const set = (k: string, v: unknown) =>
  fetch(`${API}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Prumo-Token': token() }, body: JSON.stringify({ method: 'Settings.Set', args: [k, v] }) })
test.afterEach(async () => {
  for (const [k, v] of Object.entries({ 'commit.agent': 'auto', 'commit.agentCommand': '', 'agent.editConsent': false })) await set(k, v)
})

function fakeAgent(dir: string) {
  const script = join(dir, 'agente-falso')
  writeFileSync(script, `#!/bin/sh\ncat > "${join(dir, 'pedido.txt')}"\nprintf '\`\`\`go\\nvar b = 20 // dobrado\\n\`\`\`\\n'\n`)
  chmodSync(script, 0o755)
  return script
}

test('F03-H13 Ctrl+\\ troca a linha pelo código da IA: aviso na primeira vez, aceitar e desfazer', async ({ page, fx }) => {
  const dir = fx.seed()
  fx.write(dir, 'ai.go', 'package main\n\nvar a = 1\nvar b = 2\nvar c = 3\n')
  await set('commit.agent', 'custom')
  await set('commit.agentCommand', fakeAgent(fx.base))
  await openProject(page, dir)
  await openFile(page, 'ai.go')

  await cursorAt(page, 'var b = 2')
  await page.keyboard.press(`${mod}+\\`)
  const box = page.getByTestId('ai-edit')
  await expect(box).toBeVisible()
  await box.getByLabel('O que a IA deve fazer').fill('dobre o valor')
  await page.keyboard.press('Enter')
  // Primeira vez: avisa que o código vai para o agente.
  await expect(box).toContainText('vai para o comando agente-falso')
  await box.getByRole('button', { name: 'Enviar' }).click()
  await expect.poll(() => editorValue(page), { timeout: 30_000 }).toBe('package main\n\nvar a = 1\nvar b = 20 // dobrado\nvar c = 3\n')
  await expect(box).toContainText('Revise o trecho')

  const pedido = readFileSync(join(fx.base, 'pedido.txt'), 'utf8')
  expect(pedido).toContain('File: ai.go')
  expect(pedido).toContain('var a = 1\n<TARGET>var b = 2</TARGET>\nvar c = 3')
  expect(pedido).toContain('dobre o valor')

  // Desfazer devolve o original numa edição só.
  await box.getByRole('button', { name: 'Desfazer' }).click()
  await expect(box).toHaveCount(0)
  await expect.poll(() => editorValue(page)).toBe('package main\n\nvar a = 1\nvar b = 2\nvar c = 3\n')

  // Segunda vez: sem perguntar; aceitar mantém o código.
  await cursorAt(page, 'var b = 2')
  await page.keyboard.press(`${mod}+\\`)
  await box.getByLabel('O que a IA deve fazer').fill('dobre o valor')
  await page.keyboard.press('Enter')
  await expect(box).toContainText('Revise o trecho', { timeout: 30_000 })
  await page.keyboard.press('Enter')
  await expect(box).toHaveCount(0)
  expect(await editorValue(page)).toContain('var b = 20 // dobrado')
})

test('F03-H14 Ctrl+\\ com a IA desligada só avisa; Esc fecha a caixa', async ({ page, fx }) => {
  const dir = fx.seed()
  fx.write(dir, 'ai.go', 'package main\n\nvar a = 1\n')
  await set('commit.agent', 'off')
  await openProject(page, dir)
  await openFile(page, 'ai.go')
  await cursorAt(page, 'var a')
  await page.keyboard.press(`${mod}+\\`)
  const box = page.getByTestId('ai-edit')
  await expect(box).toContainText('A IA está desligada')
  await page.keyboard.press('Escape')
  await expect(box).toHaveCount(0)
})
