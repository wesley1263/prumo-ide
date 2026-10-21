// Segurança da ponte local e da regra de confiança, direto na API (sem UI).
import { join } from 'node:path'
import { test, expect, API, token } from './helpers'

const rpc = (request: import('@playwright/test').APIRequestContext, method: string, args: unknown[], headers: Record<string, string> = {}) =>
  request.post(`${API}/rpc`, {
    data: { method, args },
    headers: { 'Content-Type': 'application/json', 'X-Prumo-Token': token(), ...headers },
  })

test.describe('SEC ponte local', () => {
  test('SEC-1 sem token: 401', async ({ request }) => {
    const r = await request.post(`${API}/rpc`, { data: { method: 'Projects.ListRecent', args: [] } })
    expect(r.status()).toBe(401)
  })

  test('SEC-2 Origin de outro site: 403', async ({ request }) => {
    const r = await rpc(request, 'Projects.ListRecent', [], { Origin: 'https://site-malicioso.example' })
    expect(r.status()).toBe(403)
  })

  test('SEC-3 corpo que não é JSON (form de outro site): recusado', async ({ request }) => {
    const r = await request.post(`${API}/rpc`, { form: { method: 'Projects.ListRecent' }, headers: { 'X-Prumo-Token': token() } })
    expect(r.status()).toBe(415)
  })

  test('SEC-4 ler arquivo fora do projeto por ../ é recusado', async ({ request, fx }) => {
    const dir = fx.seed()
    const open = await (await rpc(request, 'Projects.Open', [dir])).json()
    const id = open.result.project.id
    const r = await (await rpc(request, 'Files.Read', [id, '../../../../../../etc/passwd'])).json()
    expect(r.error).toMatch(/fora do projeto/)
    const w = await (await rpc(request, 'Files.Write', [id, '../fora.txt', 'x', 0])).json()
    expect(w.error).toMatch(/fora do projeto/)
  })

  test('SEC-5 ReadExternal só aceita GOROOT e cache de módulos', async ({ request, fx }) => {
    const dir = fx.seed()
    const id = (await (await rpc(request, 'Projects.Open', [dir])).json()).result.project.id
    const r = await (await rpc(request, 'Files.ReadExternal', [id, '/etc/passwd'])).json()
    expect(r.error).toMatch(/fora do projeto/)
    const ok = await (await rpc(request, 'Files.ReadExternal', [id, join(dir, 'go.mod')])).json()
    expect(ok.error).toBeTruthy() // dentro do projeto também não: para isso existe Files.Read
  })

  test('SEC-6 projeto não confiável não roda, não commita e não sobe gopls', async ({ request, fx, page }) => {
    const dir = fx.seed()
    const id = (await (await rpc(request, 'Projects.Open', [dir])).json()).result.project.id
    const cfg = (await (await rpc(request, 'RunConfigs.FromContext', [id, 'cmd/shop/main.go', ''])).json()).result
    expect((await (await rpc(request, 'Runs.Start', [id, cfg.id])).json()).error).toMatch(/não confiável/)
    expect((await (await rpc(request, 'Git.Commit', [id, { files: ['NOTES.md'], message: 'x', amend: false }])).json()).error).toMatch(/não confiável/)
    // WebSocket do LSP fecha com 4001.
    await page.goto('/') // Origin permitida: o que deve barrar é a falta de confiança
    const code = await page.evaluate(
      ([url]) =>
        new Promise<number>((res) => {
          const ws = new WebSocket(url)
          ws.onclose = (e) => res(e.code)
        }),
      [`ws://127.0.0.1:7799/lsp/${id}?token=${token()}`],
    )
    expect(code).toBe(4001)
  })

  test('SEC-7 método inexistente: 404 sem stack trace', async ({ request }) => {
    const r = await rpc(request, 'Projects.Delete', [])
    expect(r.status()).toBe(404)
    expect(await r.text()).not.toMatch(/goroutine|\.go:\d+/)
  })
})
