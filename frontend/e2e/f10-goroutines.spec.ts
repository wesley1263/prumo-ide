// F10 goroutines: agrupar pela função, esconder as do runtime, filtrar e trocar a pilha.
import { test, expect, openProject, openFile, a11y } from './helpers'
import type { Page } from '@playwright/test'

const dbg = (page: Page) => page.getByRole('region', { name: 'Depurar' })
const tree = (page: Page) => dbg(page).getByRole('tree', { name: 'Goroutines' })

// Compilar para depurar (-gcflags=all=-N -l) com a suíte inteira rodando passa de 90 s às vezes.
test.describe.configure({ timeout: 180_000 })

test('F10-H5 goroutines agrupadas: 3 workers, runtime escondido, filtro e troca de pilha', async ({ page, fx }) => {
  const dir = fx.seed()
  fx.write(
    dir,
    'cmd/pool/main.go',
    // Os 3 workers avisam que começaram antes do breakpoint (senão algum ainda é só o "gowrap" do go).
    'package main\n\nimport (\n\t"fmt"\n\t"sync"\n)\n\nfunc worker(id int, started *sync.WaitGroup, jobs <-chan int) {\n\tstarted.Done()\n\tfor j := range jobs {\n\t\tfmt.Println(j * id)\n\t}\n}\n\nfunc main() {\n\tvar started sync.WaitGroup\n\tjobs := make(chan int)\n\tfor i := 1; i <= 3; i++ {\n\t\tstarted.Add(1)\n\t\tgo worker(i, &started, jobs)\n\t}\n\tstarted.Wait()\n\tfmt.Println("pronto") // breakpoint\n\tclose(jobs)\n}\n',
  )
  await openProject(page, dir)
  await openFile(page, 'cmd/pool/main.go')
  await page.locator('.monaco-editor .line-numbers').filter({ hasText: /^23$/ }).click()
  await page.locator('.goide-run-glyph').first().click({ button: 'right' })
  await page.getByRole('menu', { name: 'Rodar ou depurar' }).getByRole('menuitem', { name: /^Depurar( |$)/ }).click()
  await expect(dbg(page).getByText(/parado \(breakpoint\)/)).toBeVisible({ timeout: 90_000 })

  // A que parou vem primeiro e marcada; os 3 workers num grupo só; o runtime fica escondido.
  await expect(tree(page).getByRole('treeitem', { name: /^main\.main, 1 goroutine$/ })).toBeVisible()
  await expect(tree(page).getByRole('treeitem', { name: /parou aqui/ })).toHaveCount(1)
  await expect(tree(page).getByRole('treeitem', { name: /^main\.worker, 3 goroutines$/ })).toBeVisible()
  await expect(tree(page).getByRole('treeitem', { name: /^runtime\./ })).toHaveCount(0)
  await expect(dbg(page)).toContainText(/do runtime escondidas/)
  expect(await a11y(page)).toEqual([])

  await dbg(page).getByRole('checkbox', { name: 'Runtime' }).click({ force: true })
  await expect(tree(page).getByRole('treeitem', { name: /^runtime\./ }).first()).toBeVisible()

  // Escolher um worker troca a pilha.
  const worker = tree(page).getByRole('treeitem', { name: /^main\.worker/ }).getByRole('treeitem').first()
  await worker.click()
  await expect(worker).toHaveAttribute('aria-selected', 'true')
  await expect(dbg(page).getByRole('listbox', { name: 'Quadros da pilha' })).toContainText('main.worker')

  // Filtro pela função.
  await dbg(page).getByLabel('Filtrar goroutines').fill('worker')
  await expect(tree(page).getByRole('treeitem', { level: undefined }).filter({ hasText: /^main\.main/ })).toHaveCount(0)
  await expect(tree(page).getByRole('treeitem', { name: /^main\.worker, 3 goroutines$/ })).toBeVisible()
})
