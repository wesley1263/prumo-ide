// Infraestrutura comum dos testes e2e.
import { test as base, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url)) // o pacote é ESM

const SEED = resolve(__dirname, '../../scripts/seed-fixture.sh')
export const API = 'http://127.0.0.1:7799'
export const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

/** Uma cópia descartável do projeto de exemplo (go.mod, git com 1 commit, 1 mudança e 1 arquivo novo). */
export class Fixture {
  constructor(public base: string) {}
  seed(name = 'demo-shop'): string {
    const dir = join(this.base, name)
    execFileSync('bash', [SEED, dir], { stdio: 'pipe' })
    return dir
  }
  read(dir: string, rel: string) {
    return readFileSync(join(dir, rel), 'utf8')
  }
  write(dir: string, rel: string, content: string | Buffer) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, rel), content)
  }
  git(dir: string, ...args: string[]): string {
    return execFileSync('git', ['-C', dir, '-c', 'user.name=Demo', '-c', 'user.email=demo@example.com', ...args], {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' },
    }).trim()
  }
  /** Cria um remoto local (bare) "origin" com a main publicada e acompanhada. */
  remote(dir: string): string {
    const bare = join(this.base, 'remoto.git')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare])
    this.git(dir, 'remote', 'add', 'origin', bare)
    this.git(dir, 'push', '-q', '-u', 'origin', 'main')
    return bare
  }
  /** Um clone de "outra pessoa", para simular commits empurrados por outro dev. */
  otherClone(bare: string): string {
    const other = join(this.base, 'outra-pessoa')
    execFileSync('git', ['clone', '-q', bare, other])
    return other
  }
}

export const test = base.extend<{ guard: void; fx: Fixture }>({
  // Todo teste falha com erro no console, erro de página ou resposta 5xx.
  guard: [
    async ({ page }, use) => {
      const problems: string[] = []
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
      page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`))
      page.on('response', (r) => r.status() >= 500 && problems.push(`${r.status()} ${r.url()}`))
      await use()
      expect(problems, 'erros no console ou respostas 5xx').toEqual([])
    },
    { auto: true },
  ],
  fx: async ({}, use) => {
    const base = mkdtempSync(join(tmpdir(), 'prumo-e2e-'))
    await use(new Fixture(base))
    await closeProjectsUnder(base)
    rmSync(base, { recursive: true, force: true })
  },
})
export { expect }

/** Fecha no backend os projetos abertos pelo teste: sem isso cada um deixa um gopls (centenas de MB) até o fim da suíte. */
async function closeProjectsUnder(base: string) {
  const call = async (method: string, args: unknown[]) => {
    const r = await fetch(`${API}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Prumo-Token': token() },
      body: JSON.stringify({ method, args }),
    })
    return (await r.json()).result
  }
  const recent: Array<{ id: string; rootPath: string }> = (await call('Projects.ListRecent', [])) ?? []
  for (const p of recent) if (p.rootPath.startsWith(base)) await call('Projects.Close', [p.id])
}

/** Abre um projeto pelo diálogo de caminho (modo dev) e responde a pergunta de confiança. */
export async function openProject(page: Page, dir: string, opts: { trust?: boolean } = {}) {
  const trust = opts.trust ?? true
  await page.goto('/')
  await page.getByRole('button', { name: 'Abrir', exact: true }).first().click()
  const field = page.getByLabel('Caminho da pasta')
  await field.fill(dir)
  await field.press('Enter')
  const dlg = page.getByRole('dialog', { name: 'Confiar neste projeto?' })
  await dlg.waitFor()
  await dlg.getByRole('button', { name: trust ? 'Confiar' : 'Modo restrito' }).click()
  await expect(dlg).toBeHidden()
  await expect(page.getByRole('tree', { name: 'Arquivos do projeto' })).toBeVisible()
  if (trust) await expect(page.getByText('gopls pronto')).toBeVisible({ timeout: 60_000 })
}

/** Abre um arquivo pela árvore, expandindo as pastas do caminho. */
export async function openFile(page: Page, rel: string) {
  const tree = page.getByRole('tree', { name: 'Arquivos do projeto' })
  const parts = rel.split('/')
  for (const dir of parts.slice(0, -1)) {
    const item = tree.getByRole('treeitem', { name: dir, exact: true })
    if ((await item.getAttribute('aria-expanded')) !== 'true') await item.click()
  }
  await tree.getByRole('treeitem', { name: parts.at(-1)!, exact: true }).dblclick()
  await expect(page.getByRole('tab', { name: new RegExp(`^${escape(parts.at(-1)!)}(, não salvo)?$`) })).toHaveAttribute('aria-selected', 'true')
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Texto do editor ativo (via gancho de teste do modo dev). */
export function editorValue(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__prumoEditor.getModel()?.getValue() ?? '')
}

/** Põe o cursor logo depois (ou antes) da primeira ocorrência de `text` e foca o editor. */
export async function cursorAt(page: Page, text: string, where: 'after' | 'before' = 'after') {
  await page.evaluate(
    ([t, w]) => {
      const ed = (window as any).__prumoEditor
      const m = ed.getModel()
      const off = m.getValue().indexOf(t)
      if (off < 0) throw new Error('texto não encontrado no editor: ' + t)
      ed.setPosition(m.getPositionAt(w === 'after' ? off + t.length : off))
      ed.focus()
    },
    [text, where],
  )
}

/** Varredura de acessibilidade (WCAG 2 A/AA). O Monaco é de terceiros e fica de fora, registrado à parte no plano. */
export async function a11y(page: Page) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('.monaco-editor').exclude('.monaco-diff-editor').analyze()
  return res.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length}x ${v.help} → ${v.nodes[0]?.target.join(' ')}`)
}

/** Lê o token do devserver dos testes. */
export const token = () => readFileSync(resolve(__dirname, '.run/token'), 'utf8').trim()
