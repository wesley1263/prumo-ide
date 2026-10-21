// Mensagem de commit pelo agente de IA da máquina: aqui um agente falso (script) que guarda o pedido e responde.
// As preferências são globais: roda no projeto "configuracoes" e volta tudo ao padrão.
import { test, expect, openProject, API, token, a11y } from './helpers'
import { join } from 'node:path'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import type { Page } from '@playwright/test'

const set = (k: string, v: unknown) =>
  fetch(`${API}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Prumo-Token': token() }, body: JSON.stringify({ method: 'Settings.Set', args: [k, v] }) })
const reset = async () => {
  for (const [k, v] of Object.entries({ 'commit.agent': 'auto', 'commit.agentCommand': '', 'commit.agentLanguage': 'auto', 'commit.agentInstructions': '', 'commit.agentConsent': false })) await set(k, v)
}
test.afterEach(reset)

const commit = (page: Page) => page.getByRole('region', { name: 'Commit' })

function fakeAgent(dir: string) {
  const script = join(dir, 'agente-falso')
  writeFileSync(script, `#!/bin/sh\ncat > "${join(dir, 'pedido.txt')}"\nprintf '\`\`\`\\nfeat(cart): frete grátis acima de 100\\n\`\`\`\\n'\n`)
  chmodSync(script, 0o755)
  return script
}

test('F12-H11 mensagem de commit pelo agente: aviso na primeira vez, só o marcado vai, desfazer', async ({ page, fx }) => {
  const dir = fx.seed()
  fx.write(dir, 'internal/cart/cart.go', fx.read(dir, 'internal/cart/cart.go').replace('// Cart é um carrinho de compras.', '// Cart guarda as linhas do pedido.'))
  const script = fakeAgent(fx.base)
  await set('commit.agent', 'custom')
  await set('commit.agentCommand', script)
  await openProject(page, dir)
  await page.keyboard.press('Alt+0')
  // Só o cart.go vai para o commit (o catalog.go fica desmarcado).
  await commit(page).getByRole('checkbox', { name: /^Incluir internal\/catalog\/catalog\.go/ }).click({ force: true })

  await commit(page).getByRole('button', { name: 'Gerar a mensagem com agente-falso' }).click()
  const ask = page.getByRole('dialog', { name: 'Gerar a mensagem com agente-falso?' })
  await expect(ask).toContainText('vai para o comando agente-falso')
  expect(await a11y(page)).toEqual([])
  await ask.getByRole('button', { name: 'Gerar', exact: true }).click()
  const box = commit(page).getByLabel('Mensagem do commit')
  await expect(box).toHaveValue('feat(cart): frete grátis acima de 100', { timeout: 30_000 })
  await expect(page.getByText('Mensagem escrita pelo agente-falso')).toBeVisible()

  const pedido = readFileSync(join(fx.base, 'pedido.txt'), 'utf8')
  expect(pedido).toContain('+// Cart guarda as linhas do pedido.')
  expect(pedido).toContain('M internal/cart/cart.go')
  expect(pedido).not.toContain('catalog.go')
  expect(pedido).toContain('Recent commits:')

  // Segunda vez: sem perguntar; com texto no campo, dá para desfazer.
  await box.fill('meu rascunho')
  await commit(page).getByRole('button', { name: 'Gerar a mensagem com agente-falso' }).click()
  await expect(ask).toHaveCount(0)
  await expect(box).toHaveValue('feat(cart): frete grátis acima de 100', { timeout: 30_000 })
  await page.getByRole('button', { name: 'Desfazer' }).last().click()
  await expect(box).toHaveValue('meu rascunho')
})

test('F12-H12 configurar o agente: lista o que achou; desligado esconde o botão; comando inexistente avisa', async ({ page, fx }) => {
  await openProject(page, fx.seed())
  await page.keyboard.press('Control+Alt+s')
  const dlg = page.getByRole('dialog', { name: 'Configurações' })
  await dlg.getByRole('navigation', { name: 'Categorias' }).getByRole('button', { name: 'Ferramentas' }).click()
  const section = dlg.getByRole('region', { name: 'Mensagens de commit com IA' })
  await expect(section.getByRole('list', { name: 'Agentes encontrados' }).getByRole('listitem')).toHaveCount(3)
  expect(await a11y(page)).toEqual([])
  const select = section.getByLabel('Agente para mensagens de commit')
  await select.selectOption('custom')
  await section.getByLabel('Comando do agente').fill('/nao/existe/agente')
  await section.getByLabel('Comando do agente').press('Enter')
  await expect(section).toContainText('comando do agente não encontrado: /nao/existe/agente')
  await select.selectOption('off')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Alt+0')
  await expect(commit(page).getByLabel('Mensagem do commit')).toBeVisible()
  await expect(commit(page).getByRole('button', { name: /^Gerar a mensagem com/ })).toHaveCount(0)
})
