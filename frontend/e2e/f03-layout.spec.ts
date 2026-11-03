// F03 Layout salvo por outra versão do Prumo: janelas que esta versão não tem ficam de fora, sem quebrar a tela.
import { test, expect, openProject, token, API } from './helpers'

async function rpc(method: string, ...args: unknown[]) {
  const r = await fetch(`${API}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Prumo-Token': token() }, body: JSON.stringify({ method, args }) })
  return (await r.json()).result
}

test('F03-E11 layout com janela desconhecida (salvo por outra versão) abre o projeto normalmente', async ({ page, fx }) => {
  const dir = fx.seed()
  await openProject(page, dir, { trust: false })
  const recent: Array<{ id: string; rootPath: string }> = await rpc('Projects.ListRecent')
  const id = recent.find((p) => p.rootPath === dir)!.id
  await page.goto('about:blank') // sai da IDE: o layout atual não é salvo por cima
  await rpc('Workspace.Save', id, {
    layout: {
      open: { left: 'janelaDeOutraVersao', bottom: 'outraQueNaoExiste', right: null },
      sizes: { left: 300, bottom: 260, right: 280 },
      placement: { janelaDeOutraVersao: 'float', terminal: 'lado-errado' },
      floats: { janelaDeOutraVersao: { x: 0, y: 0, w: 100, h: 100 } },
    },
  })
  await openProject(page, dir, { trust: false })
  await expect(page.getByRole('tree', { name: 'Arquivos do projeto' })).toBeVisible()
  // As janelas que existem continuam abrindo no lugar de sempre.
  await page.keyboard.press('Alt+F12')
  await expect(page.getByRole('region', { name: 'Terminal' })).toBeVisible()
})
