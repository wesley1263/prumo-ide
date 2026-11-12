// F16 Pull requests do GitHub, como no VS Code: conta, seções, visão geral com checks e revisores, diff com a
// conversa na linha, resposta, revisão pendente, aprovar, merge, checkout e criar.
// O "GitHub" (Enterprise, API em /api/v3) é um servidor falso aqui no teste; o remoto aponta para ele e o
// insteadOf leva o git para o bare.
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, expect, openProject, token, API } from './helpers'
import type { Page } from '@playwright/test'

const ana = { login: 'ana' }
const bia = { login: 'bia' }
const me = { login: 'eu' }

interface Fake {
  url: string
  sent: Record<string, unknown[]>
  close: () => Promise<void>
}

async function fakeGitHub(sha: () => { head: string; base: string }): Promise<Fake> {
  const sent: Record<string, unknown[]> = {}
  const pulls: Array<Record<string, unknown>> = [
    { number: 3, title: 'Frete grátis acima de R$ 100', body: '## Por quê\nPedido do **comercial**.', state: 'open', user: ana, head: { ref: 'frete', repo: { full_name: 'dono/demo-shop' } }, base: { ref: 'main' }, requested_reviewers: [bia], comments: 1, review_comments: 1, mergeable: true, mergeable_state: 'clean', commits: 1, additions: 4 },
  ]
  const comments: Array<Record<string, unknown>> = [
    { id: 20, path: 'internal/catalog/frete.go', line: 4, side: 'RIGHT', body: 'Por que 100?', user: ana, created_at: '2026-11-01T10:00:00Z', pull_request_review_id: 10 },
  ]
  const body = (r: IncomingMessage) =>
    new Promise<Record<string, unknown>>((res) => {
      let s = ''
      r.on('data', (c) => (s += c))
      r.on('end', () => res(s ? JSON.parse(s) : {}))
    })
  const srv: Server = createServer(async (req, res) => {
    const send = (code: number, v: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(v))
    }
    if (req.headers.authorization !== 'Bearer segredo') return send(401, { message: 'Bad credentials' })
    const u = new URL(req.url!, 'http://x')
    const p = u.pathname.replace('/api/v3', '')
    const repo = '/repos/dono/demo-shop'
    const record = async () => {
      const b = await body(req)
      ;(sent[`${req.method} ${p}`] ??= []).push(b)
      return b
    }
    const full = (pr: Record<string, unknown>) => ({ ...pr, head: { ...(pr.head as object), sha: sha().head }, base: { ...(pr.base as object), sha: sha().base } })
    if (p === '/user') return send(200, me)
    if (p === repo) return send(200, { full_name: 'dono/demo-shop', html_url: 'https://github.example/dono/demo-shop', default_branch: 'main', permissions: { push: true } })
    if (p === '/search/issues') {
      const q = u.searchParams.get('q') ?? ''
      return send(200, { items: q.includes('review-requested:@me') ? pulls.filter((x) => x.number === 3).map((x) => ({ ...x, user: x.user })) : [] })
    }
    if (p === repo + '/pulls' && req.method === 'GET') {
      const head = u.searchParams.get('head')
      return send(200, (head ? pulls.filter((x) => `dono:${(x.head as { ref: string }).ref}` === head) : pulls).map(full))
    }
    if (p === repo + '/pulls' && req.method === 'POST') {
      const b = await record()
      const pr = { number: 9, title: b.title, body: b.body, state: 'open', draft: b.draft, user: me, head: { ref: b.head, repo: { full_name: 'dono/demo-shop' } }, base: { ref: b.base }, requested_reviewers: [], commits: 1 }
      pulls.unshift(pr)
      return send(201, full(pr))
    }
    if (p === repo + '/assignees') return send(200, [ana, bia, me])
    const m = /^\/repos\/dono\/demo-shop\/(pulls|issues)\/(\d+)(\/.*)?$/.exec(p)
    if (m) {
      const pr = pulls.find((x) => x.number === Number(m[2]))
      if (!pr) return send(404, { message: 'Not Found' })
      const rest = m[3] ?? ''
      if (req.method !== 'GET') {
        const b = await record()
        if (rest === '/merge') return send(200, { merged: true })
        if (/^\/comments\/\d+\/replies$/.test(rest)) {
          const c = { id: 100 + comments.length, in_reply_to_id: 20, path: 'internal/catalog/frete.go', line: 4, side: 'RIGHT', body: b.body, user: me, created_at: '2026-11-05T10:00:00Z' }
          comments.push(c)
          return send(201, c)
        }
        return send(201, {})
      }
      if (m[1] === 'issues' && rest === '/comments') return send(200, pr.number === 3 ? [{ id: 1, user: bia, body: 'Ficou bom?', created_at: '2026-11-02T10:00:00Z' }] : [])
      if (rest === '/reviews') return send(200, pr.number === 3 ? [{ id: 10, user: ana, body: '', state: 'COMMENTED', submitted_at: '2026-11-01T10:00:00Z' }] : [])
      if (rest === '/comments') return send(200, pr.number === 3 ? comments : [])
      if (rest === '') return send(200, full(pr))
    }
    if (/\/commits\/[^/]+\/check-runs$/.test(p)) return send(200, { check_runs: [{ name: 'test', status: 'completed', conclusion: 'success' }, { name: 'lint', status: 'completed', conclusion: 'failure', html_url: 'https://github.example/run/2' }] })
    if (/\/commits\/[^/]+\/status$/.test(p)) return send(200, { statuses: [] })
    send(404, { message: 'Not Found' })
  })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`
  return { url, sent, close: () => new Promise((r) => srv.close(() => r())) }
}

async function rpc(method: string, ...args: unknown[]) {
  const r = await fetch(`${API}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Prumo-Token': token() }, body: JSON.stringify({ method, args }) })
  return (await r.json()).result
}

const panel = (page: Page) => page.getByRole('region', { name: 'Pull requests' })

async function addAccount(page: Page, server: string) {
  const dlg = page.getByRole('dialog', { name: 'Configurações' })
  const sec = dlg.getByRole('region', { name: 'Contas do GitHub' })
  await expect(sec).toBeVisible()
  await sec.getByLabel('Servidor do GitHub').fill(server)
  await sec.getByLabel('Token de acesso pessoal').fill('segredo')
  await sec.getByRole('button', { name: 'Conectar conta' }).click()
  await expect(sec.getByRole('list', { name: 'Contas cadastradas' })).toContainText('@eu')
  await page.keyboard.press('Escape')
  await expect(dlg).toBeHidden()
}

/** Remoto apontando para o GitHub falso; o git vai para o bare. */
function linkRemote(fx: { git: (dir: string, ...a: string[]) => string }, dir: string, bare: string, url: string) {
  const remoteUrl = `${url}/dono/demo-shop.git`
  fx.git(dir, 'remote', 'set-url', 'origin', remoteUrl)
  fx.git(dir, 'config', `url.${bare}.insteadOf`, remoteUrl)
}

test.describe('F16 pull requests (GitHub)', () => {
  test('F16-H3 conta, seções, visão geral, conversa no diff, revisão pendente, aprovar, merge e checkout', async ({ page, fx }) => {
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
    fx.git(bare, 'update-ref', 'refs/pull/3/head', head)
    const gh = await fakeGitHub(() => ({ head, base }))
    linkRemote(fx, dir, bare, gh.url)
    try {
      await openProject(page, dir)
      await page.getByRole('button', { name: 'Pull requests', exact: true }).click()
      // Sem conta, um servidor sem "github" no nome não é reconhecido: a janela leva ao cadastro.
      await expect(panel(page).getByText('Este projeto não está no GitHub')).toBeVisible()
      await panel(page).getByRole('button', { name: 'Cadastrar servidor GitHub' }).click()
      await addAccount(page, gh.url)

      // Seções como no VS Code: o pull request aparece em "Esperando a minha revisão".
      const review = panel(page).getByRole('region', { name: 'Esperando a minha revisão' })
      const item = review.getByRole('button', { name: '#3 Frete grátis acima de R$ 100' })
      await expect(item).toBeVisible()
      await expect(panel(page).getByRole('region', { name: 'Criados por mim' })).toContainText('Nenhum pull request.')
      await item.click()
      await expect(item).toHaveAttribute('aria-expanded', 'true')
      const file = review.getByRole('button', { name: 'internal/catalog/frete.go, abrir o diff' })
      await expect(file).toBeVisible()

      // Visão geral numa aba do editor.
      await review.getByRole('button', { name: 'Descrição' }).click()
      await expect(page.getByRole('tab', { name: '#3 Frete grátis acima de R$ 100' })).toHaveAttribute('aria-selected', 'true')
      const overview = page.getByRole('article', { name: 'Pull request #3' })
      await expect(overview.getByRole('heading', { name: /Frete grátis acima de R\$ 100/ })).toBeVisible()
      await expect(overview.getByText('1 de 2 checks falharam')).toBeVisible()
      await expect(overview.getByLabel('bia: revisão pedida')).toBeVisible()
      await expect(overview.getByRole('region', { name: 'Descrição' })).toContainText('Pedido do comercial.')
      await expect(overview.getByRole('list', { name: 'Linha do tempo' })).toContainText('Ficou bom?')

      // Diff do arquivo, com a conversa na linha 4.
      await file.click()
      await expect(page.getByRole('tab', { name: 'frete.go (#3)' })).toHaveAttribute('aria-selected', 'true')
      await expect(page.locator('.monaco-diff-editor .modified-in-monaco-diff-editor')).toContainText('FreteGratis')
      const thread = page.getByRole('region', { name: 'Conversa na linha 4' })
      await expect(thread).toContainText('Por que 100?')
      await thread.getByRole('button', { name: 'Responder' }).click()
      await thread.getByRole('textbox', { name: 'Responder' }).fill('Regra do comercial.')
      await thread.getByRole('button', { name: 'Responder' }).click()
      await expect(page.getByRole('region', { name: 'Conversa na linha 4' })).toContainText('Regra do comercial.')
      expect(gh.sent['POST /repos/dono/demo-shop/pulls/3/comments/20/replies']).toEqual([{ body: 'Regra do comercial.' }])

      // Comentário novo na linha 3, que fica na revisão pendente.
      await page.evaluate(() => {
        const e = (window as unknown as { __prumoDiffEditor: { getModifiedEditor: () => { setPosition: (p: object) => void; getAction: (id: string) => { run: () => void } } } }).__prumoDiffEditor
        const m = e.getModifiedEditor()
        m.setPosition({ lineNumber: 3, column: 1 })
        m.getAction('prumo.pr.comment').run()
      })
      await page.getByRole('textbox', { name: 'Comentário na linha 3' }).fill('Documente o limite.')
      await page.getByRole('button', { name: 'Começar uma revisão' }).click()
      await expect(page.getByRole('note', { name: 'Comentário pendente na linha 3' })).toContainText('Documente o limite.')
      await expect(panel(page).getByText('1 pendente')).toBeVisible()

      // Aprovar envia a revisão com o comentário pendente.
      await page.getByRole('button', { name: 'Revisão #3 (1 pendentes)' }).click()
      await expect(overview.getByRole('list', { name: 'Comentários pendentes' })).toContainText('Documente o limite.')
      await overview.getByRole('button', { name: 'Aprovar' }).click()
      await expect(page.getByText('Pull request aprovado')).toBeVisible()
      expect(gh.sent['POST /repos/dono/demo-shop/pulls/3/reviews']).toEqual([
        { event: 'APPROVE', body: '', commit_id: head, comments: [{ path: 'internal/catalog/frete.go', line: 3, side: 'RIGHT', body: 'Documente o limite.' }] },
      ])
      await expect(overview.getByRole('list', { name: 'Comentários pendentes' })).toBeHidden()

      // Merge com squash.
      await overview.getByLabel('Forma do merge').selectOption('squash')
      await overview.getByRole('button', { name: 'Fazer merge' }).click()
      await expect(page.getByText('Pull request #3 juntado')).toBeVisible()
      expect(gh.sent['PUT /repos/dono/demo-shop/pulls/3/merge']).toEqual([{ merge_method: 'squash', sha: head }])

      // Checkout: a branch do pull request, acompanhando a remota.
      await overview.getByRole('button', { name: 'Fazer checkout' }).click()
      await expect(page.getByRole('banner').getByRole('button', { name: 'Branch: frete' })).toBeVisible()
      expect(fx.git(dir, 'rev-parse', 'HEAD')).toBe(head)
      expect(fx.git(dir, 'rev-parse', '--abbrev-ref', 'frete@{u}')).toBe('origin/frete')
    } finally {
      await rpc('GitHub.RemoveAccount', gh.url)
      await gh.close()
    }
  })

  test('F16-H4 criar pull request: push da branch, título do commit, revisor e abre a visão geral', async ({ page, fx }) => {
    const dir = fx.seed()
    const bare = fx.remote(dir)
    fx.git(dir, 'switch', '-q', '-c', 'feat/cupom')
    fx.write(dir, 'internal/catalog/cupom.go', 'package catalog\n\n// Cupom é um desconto.\ntype Cupom struct{ Codigo string }\n')
    fx.git(dir, 'add', 'internal/catalog/cupom.go')
    fx.git(dir, 'commit', '-qm', 'feat: cupom de desconto')
    fx.write(dir, '.github/pull_request_template.md', '## O que muda\n')
    const gh = await fakeGitHub(() => ({ head: '', base: '' }))
    linkRemote(fx, dir, bare, gh.url)
    await rpc('GitHub.SaveAccount', gh.url, 'segredo')
    try {
      await openProject(page, dir)
      await page.getByRole('button', { name: 'Pull requests', exact: true }).click()
      await panel(page).getByRole('button', { name: 'Criar pull request de feat/cupom' }).click()
      const dlg = page.getByRole('dialog', { name: 'Novo pull request' })
      await expect(dlg.getByLabel('Branch de destino')).toHaveValue('main')
      await expect(dlg.getByRole('textbox', { name: 'Título' })).toHaveValue('feat: cupom de desconto')
      await expect(dlg.getByRole('textbox', { name: 'Descrição (Markdown)' })).toHaveValue('## O que muda\n') // modelo do repositório
      await expect(dlg.getByRole('checkbox', { name: /Enviar feat\/cupom para origin antes/ })).toBeChecked()
      await dlg.getByRole('textbox', { name: 'Descrição (Markdown)' }).fill('Cupom simples.')
      await dlg.getByRole('textbox', { name: 'Revisores' }).fill('an')
      await dlg.getByRole('list', { name: 'Pessoas encontradas' }).getByRole('button', { name: '@ana' }).click()
      await expect(dlg.getByRole('list', { name: 'Revisores escolhidos' })).toContainText('@ana')
      await dlg.getByText('Rascunho (Draft)').click()
      await dlg.getByRole('button', { name: 'Criar pull request' }).click()

      await expect(dlg).toBeHidden()
      await expect(page.getByText('Pull request #9 criado')).toBeVisible()
      await expect(page.getByRole('tab', { name: '#9 feat: cupom de desconto' })).toHaveAttribute('aria-selected', 'true')
      expect(gh.sent['POST /repos/dono/demo-shop/pulls']).toEqual([{ title: 'feat: cupom de desconto', head: 'feat/cupom', base: 'main', body: 'Cupom simples.', draft: true }])
      expect(gh.sent['POST /repos/dono/demo-shop/pulls/9/requested_reviewers']).toEqual([{ reviewers: ['ana'] }])
      expect(gh.sent['POST /repos/dono/demo-shop/issues/9/assignees']).toEqual([{ assignees: ['eu'] }])
      // A branch foi enviada antes e passou a acompanhar a remota.
      expect(fx.git(bare, 'rev-parse', 'feat/cupom')).toBe(fx.git(dir, 'rev-parse', 'HEAD'))
      expect(fx.git(dir, 'rev-parse', '--abbrev-ref', 'feat/cupom@{u}')).toBe('origin/feat/cupom')

      // Na janela, a branch atual já mostra o pull request; o diálogo de novo leva até ele.
      await expect(panel(page).getByRole('region', { name: 'Branch atual' }).getByRole('button', { name: '#9 feat: cupom de desconto' })).toBeVisible()
      await panel(page).getByRole('button', { name: 'Novo pull request' }).click()
      await expect(dlg.getByText(/já tem um pull request aberto: #9/)).toBeVisible()
      await dlg.getByRole('button', { name: 'Abrir #9' }).click()
      await expect(page.getByRole('tab', { name: '#9 feat: cupom de desconto' })).toHaveAttribute('aria-selected', 'true')
    } finally {
      await rpc('GitHub.RemoveAccount', gh.url)
      await gh.close()
    }
  })
})
