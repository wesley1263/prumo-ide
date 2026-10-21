// E2E da IDE: backend real (devserver) + Vite, em portas próprias e com dados descartáveis.
//   npx playwright test            (usa o Google Chrome instalado; não baixa navegador)
import { defineConfig } from '@playwright/test'
import { homedir } from 'node:os'

const RUN = 'e2e/.run'
const API = 'http://127.0.0.1:7799'
const UI = 'http://127.0.0.1:5174'
const PATH = `${process.env.PATH}:${homedir()}/go/bin` // gopls instalado com go install

export default defineConfig({
  testDir: 'e2e',
  outputDir: `${RUN}/results`,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 2, // cada teste sobe um gopls próprio
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: `${RUN}/report`, open: 'never' }]],
  use: {
    baseURL: UI,
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    locale: 'pt-BR', // o idioma "seguir o sistema" vira pt-BR (o padrão do Playwright, en-US, trocaria a suíte inteira)
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'ide', testIgnore: /f28-settings|f28-english|f12-checks|f12-agent/ },
    // As configurações são do app inteiro (não do projeto): rodam sozinhas, depois de tudo, para não
    // mudar o tema, a fonte ou o "formatar ao salvar" de um teste que esteja rodando ao lado.
    { name: 'configuracoes', testMatch: /f28-settings|f28-english|f12-checks|f12-agent/, dependencies: ['ide'], fullyParallel: false, workers: 1 },
  ],
  webServer: [
    {
      command:
        `rm -rf ${RUN}/data ${RUN}/token && mkdir -p ${RUN} && (cd .. && go build -o frontend/${RUN}/devserver ./cmd/devserver) && ` +
        `${RUN}/devserver -addr 127.0.0.1:7799 -data ${RUN}/data -token-file ${RUN}/token -origins ${UI},http://localhost:5174`,
      url: `${API}/events`, // 401 sem token = no ar
      env: { PATH, PRUMO_LSP_IDLE: '3s' }, // gopls sem UI conectada sai logo: a suíte abre ~90 projetos
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npx vite --host 127.0.0.1',
      url: UI,
      env: { PATH, PRUMO_VITE_PORT: '5174', PRUMO_DEVSERVER: API, PRUMO_TOKEN_FILE: `${RUN}/token` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
