// F16 Merge requests do GitLab: conta, lista, detalhe, diff, comentário, checkout e criar.
// O "GitLab" é um servidor falso aqui no teste; o remoto aponta para ele e o insteadOf leva o git para o bare.
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, expect, openProject, token, API } from './helpers'
import type { Page } from '@playwright/test'

interface Fake {
  url: string
  created: Record<string, unknown>[]
  notes: string[]
  mrs: Array<Record<string, unknown>>
  close: () => Promise<void>
}

const ana = { id: 8, username: 'ana', name: 'Ana Revisora' }
const me = { id: 7, username: 'eu', name: 'Eu Mesmo' }

async function fakeGitLab(diffRefs: () => { base_sha: string; head_sha: string }): Promise<Fake> {
  const created: Record<string, unknown>[] = []
  const notes: string[] = []
  const mrs: Array<Record<string, unknown>> = [
    { iid: 1, title: 'Frete grátis acima de R$ 100', state: 'opened', author: ana, source_branch: 'frete', target_branch: 'main', user_notes_count: 1, source_project_id: 1, target_project_id: 1 },
  ]
  const body = (r: IncomingMessage) => new Promise<Record<string, unknown>>((res) => {
    let s = ''
    r.on('data', (c) => (s += c))
    r.on('end', () => res(s ? JSON.parse(s) : {}))
  })
  const srv: Server = createServer(async (req, res) => {
    const send = (code: number, v: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(v))
    }
    if (req.headers.authorization !== 'Bearer segredo') return send(401, { message: '401 Unauthorized' })
    const u = new URL(req.url!, 'http://x')
    const p = u.pathname.replace('/api/v4', '')
    const proj = '/projects/' + encodeURIComponent('grupo/demo-shop')
    if (p === '/user') return send(200, me)
    if (p === proj) return send(200, { id: 1, path_with_namespace: 'grupo/demo-shop', web_url: 'https://gitlab.example/grupo/demo-shop', default_branch: 'main' })
    if (p === proj + '/merge_requests' && req.method === 'GET') {
      const src = u.searchParams.get('source_branch')
      return send(200, src ? mrs.filter((m) => m.source_branch === src) : mrs)
    }
    if (p === proj + '/merge_requests' && req.method === 'POST') {
      const b = await body(req)
      created.push(b)
      const mr = { iid: 5, title: b.title, state: 'opened', author: me, source_branch: b.source_branch, target_branch: b.target_branch, source_project_id: 1, target_project_id: 1 }
      mrs.unshift(mr)
      return send(201, mr)
    }
    const m = /^\/projects\/[^/]+\/merge_requests\/(\d+)(\/\w+)?$/.exec(p)
    if (m) {
      const mr = mrs.find((x) => x.iid === Number(m[1]))
      if (!mr) return send(404, { message: '404 Not found' })
      if (m[2] === '/approvals') return send(200, { approvals_left: 0, approved_by: [{ user: ana }] })
      if (m[2] === '/notes' && req.method === 'POST') {
        const b = await body(req)
        notes.push(String(b.body))
        return send(201, { id: 100 + notes.length, body: b.body, author: me })
      }
      if (m[2] === '/notes')
        return send(200, [
          { id: 1, body: 'Faltou o teste do limite?', author: ana, created_at: '2026-10-20T10:00:00Z', system: false },
          ...notes.map((n, i) => ({ id: 100 + i + 1, body: n, author: me, created_at: '2026-10-21T10:00:00Z', system: false })),
        ])
      return send(200, {
        ...mr,
        description: '## Por quê\nPedido do **comercial**.',
        head_pipeline: { id: 99, status: 'failed', web_url: 'https://gitlab.example/p/99' },
        diff_refs: diffRefs(),
      })
    }
    if (p === proj + '/members/all') return send(200, [ana, me].filter((x) => x.name.toLowerCase().includes((u.searchParams.get('query') ?? '').toLowerCase())))
    send(404, { message: '404 Not Found' })
  })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`
  return { url, created, notes, mrs, close: () => new Promise((r) => srv.close(() => r())) }
}

async function rpc(method: string, ...args: unknown[]) {
  const r = await fetch(`${API}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Prumo-Token': token() }, body: JSON.stringify({ method, args }) })
  return (await r.json()).result
}

const panel = (page: Page) => page.getByRole('region', { name: 'Merge requests' })

async function addAccount(page: Page, server: string) {
  const dlg = page.getByRole('dialog', { name: 'Configurações' })
  await expect(dlg.getByRole('region', { name: 'Contas do GitLab' })).toBeVisible()
  await dlg.getByLabel('Servidor do GitLab').fill(server)
  await dlg.getByLabel('Token de acesso pessoal').fill('segredo')
  await dlg.getByRole('button', { name: 'Conectar conta' }).click()
  await expect(dlg.getByRole('list', { name: 'Contas cadastradas' })).toContainText('@eu')
  await page.keyboard.press('Escape')
  await expect(dlg).toBeHidden()
}

test.describe('F16 merge requests (GitLab)', () => {
  test('F16-H1 conta, lista, detalhe com CI e aprovação, diff do arquivo, comentário e checkout', async ({ page, fx }) => {
    const dir = fx.seed()
    const bare = fx.remote(dir)
    const other = fx.otherClone(bare)
    fx.git(other, 'switch', '-q', '-c', 'frete')
    fx.write(other, 'internal/catalog/frete.go', 'package catalog\n\n// FreteGratis diz se a compra não paga frete.\nfunc FreteGratis(total float64) bool { return total >= 100 }\n')
    fx.git(other, 'add', '-A')
    fx.git(other, 'commit', '-qm', 'feat: frete grátis')
    fx.git(other, 'push', '-q', 'origin', 'frete')
    const head = fx.git(other, 'rev-parse', 'HEAD')
    const base = fx.git(other, 'rev-parse', 'main')
    fx.git(bare, 'update-ref', 'refs/merge-requests/1/head', head)
    const gl = await fakeGitLab(() => ({ base_sha: base, head_sha: head }))
    const remoteUrl = `${gl.url}/grupo/demo-shop.git`
    fx.git(dir, 'remote', 'set-url', 'origin', remoteUrl)
    fx.git(dir, 'config', `url.${bare}.insteadOf`, remoteUrl)
    try {
      await openProject(page, dir)
      await page.getByRole('button', { name: 'Merge requests', exact: true }).click()
      // Sem conta, um servidor sem "gitlab" no nome não é reconhecido: a janela leva ao cadastro.
      await expect(panel(page).getByText('Este projeto não está no GitLab')).toBeVisible()
      await panel(page).getByRole('button', { name: 'Cadastrar servidor GitLab' }).click()
      await addAccount(page, gl.url)

      const item = panel(page).getByRole('button', { name: '!1 Frete grátis acima de R$ 100' })
      await expect(item).toBeVisible()
      await expect(item).toContainText('Ana Revisora · frete → main')
      await item.click()
      await expect(panel(page).getByRole('heading', { name: 'Frete grátis acima de R$ 100' })).toBeVisible()
      await expect(panel(page).getByText('Pipeline #99: falhou')).toBeVisible()
      await expect(panel(page).getByText('Aprovado por Ana Revisora')).toBeVisible()
      await expect(panel(page).getByRole('region', { name: 'Descrição' })).toContainText('Pedido do comercial.')
      await expect(panel(page).getByRole('list', { name: 'Comentários' })).toContainText('Faltou o teste do limite?')

      // Arquivos (o merge request é buscado no repositório local) e o diff do arquivo numa aba.
      await panel(page).getByRole('button', { name: 'internal/catalog/frete.go, abrir o diff' }).click()
      await expect(page.getByRole('tab', { name: 'frete.go (!1)' })).toHaveAttribute('aria-selected', 'true')
      await expect(page.locator('.monaco-diff-editor .modified-in-monaco-diff-editor')).toContainText('FreteGratis')

      // Comentar.
      await panel(page).getByRole('textbox', { name: 'Novo comentário' }).fill('Adicionei o teste, valeu!')
      await panel(page).getByRole('button', { name: 'Comentar', exact: true }).click()
      await expect(panel(page).getByRole('list', { name: 'Comentários' })).toContainText('Adicionei o teste, valeu!')
      expect(gl.notes).toEqual(['Adicionei o teste, valeu!'])

      // Checkout: a branch do merge request, acompanhando a remota.
      await panel(page).getByRole('button', { name: 'Fazer checkout' }).click()
      await expect(page.getByRole('banner').getByRole('button', { name: 'Branch: frete' })).toBeVisible()
      expect(fx.git(dir, 'rev-parse', 'HEAD')).toBe(head)
      expect(fx.git(dir, 'rev-parse', '--abbrev-ref', 'frete@{u}')).toBe('origin/frete')
    } finally {
      await rpc('GitLab.RemoveAccount', gl.url)
      await gl.close()
    }
  })

  test('F16-H2 criar merge request: push da branch, título do commit, revisor e abre o criado', async ({ page, fx }) => {
    const dir = fx.seed()
    const bare = fx.remote(dir)
    fx.git(dir, 'switch', '-q', '-c', 'feat/cupom')
    fx.write(dir, 'internal/catalog/cupom.go', 'package catalog\n\n// Cupom é um desconto.\ntype Cupom struct{ Codigo string }\n')
    fx.git(dir, 'add', 'internal/catalog/cupom.go')
    fx.git(dir, 'commit', '-qm', 'feat: cupom de desconto')
    const gl = await fakeGitLab(() => ({ base_sha: '', head_sha: '' }))
    const remoteUrl = `${gl.url}/grupo/demo-shop.git`
    fx.git(dir, 'remote', 'set-url', 'origin', remoteUrl)
    fx.git(dir, 'config', `url.${bare}.insteadOf`, remoteUrl)
    await rpc('GitLab.SaveAccount', gl.url, 'segredo')
    try {
      await openProject(page, dir)
      await page.getByRole('button', { name: 'Merge requests', exact: true }).click()
      await panel(page).getByRole('button', { name: 'Criar merge request de feat/cupom' }).click()
      const dlg = page.getByRole('dialog', { name: 'Novo merge request' })
      await expect(dlg.getByLabel('Branch de destino')).toHaveValue('main')
      await expect(dlg.getByRole('textbox', { name: 'Título' })).toHaveValue('feat: cupom de desconto')
      await expect(dlg.getByRole('checkbox', { name: /Enviar feat\/cupom para origin antes/ })).toBeChecked()
      await dlg.getByRole('textbox', { name: 'Descrição (Markdown)' }).fill('Cupom simples, sem validade ainda.')
      await dlg.getByRole('textbox', { name: 'Revisores' }).fill('ana')
      await dlg.getByRole('list', { name: 'Pessoas encontradas' }).getByRole('button', { name: /Ana Revisora/ }).click()
      await expect(dlg.getByRole('list', { name: 'Revisores escolhidos' })).toContainText('Ana Revisora')
      await dlg.getByText('Rascunho (Draft)').click()
      await dlg.getByRole('button', { name: 'Criar merge request' }).click()

      await expect(dlg).toBeHidden()
      await expect(page.getByText('Merge request !5 criado')).toBeVisible()
      await expect(panel(page).getByRole('heading', { name: 'Draft: feat: cupom de desconto' })).toBeVisible()
      expect(gl.created).toEqual([
        expect.objectContaining({
          source_branch: 'feat/cupom',
          target_branch: 'main',
          title: 'Draft: feat: cupom de desconto',
          description: 'Cupom simples, sem validade ainda.',
          reviewer_ids: [8],
          assignee_id: 7,
          remove_source_branch: true,
        }),
      ])
      // A branch foi enviada antes e passou a acompanhar a remota.
      expect(fx.git(bare, 'rev-parse', 'feat/cupom')).toBe(fx.git(dir, 'rev-parse', 'HEAD'))
      expect(fx.git(dir, 'rev-parse', '--abbrev-ref', 'feat/cupom@{u}')).toBe('origin/feat/cupom')

      // De novo: a branch já tem merge request aberto, e o diálogo leva até ele.
      await panel(page).getByRole('button', { name: 'Voltar para a lista' }).click()
      await panel(page).getByRole('button', { name: 'Novo merge request' }).click()
      await expect(dlg.getByText(/já tem um merge request aberto: !5/)).toBeVisible()
      await dlg.getByRole('button', { name: 'Abrir !5' }).click()
      await expect(panel(page).getByRole('heading', { name: 'Draft: feat: cupom de desconto' })).toBeVisible()
    } finally {
      await rpc('GitLab.RemoveAccount', gl.url)
      await gl.close()
    }
  })
})
