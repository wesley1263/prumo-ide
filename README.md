# goide (nome provisório)

IDE desktop para Go: editor com gopls, execução, testes, depuração e git. Wails v2 (backend Go) + React + Monaco.
O planejamento está em `replica/` (recon, arquitetura, design, build log).

## Rodar em modo dev (navegador)

```bash
scripts/seed-fixture.sh                 # projeto de exemplo em .fixtures/demo-shop (opcional)
go run ./cmd/devserver                  # backend em 127.0.0.1:7788, grava o token em frontend/.dev-token
cd frontend && npm install && npm run dev   # http://127.0.0.1:5173
```

Sem seletor de pasta nativo no navegador, "Abrir" pede o caminho por texto.

## App nativo

Linux precisa de `libgtk-3-dev` e `libwebkit2gtk-4.1-dev`.

```bash
cd frontend && npm run build && cd ..
go build -tags desktop,production,webkit2_41 -o build/bin/goide .
# ou, com a CLI do Wails: wails build -tags webkit2_41
```

## Testes

```bash
go test -race ./...                         # inclui integração com gopls, git e go build reais
cd frontend && npx tsc -b
npm run e2e                                 # 104 casos Playwright (100 + 4 de captura, pulados) no Chrome instalado; sobe backend e Vite sozinho
node scripts/screenshots.mjs                # screenshots das telas para o /replica-diff (devserver + vite rodando)
python3 replica/design/build_tokens.py      # regenera tokens.css e o preset do Tailwind
```

Ferramentas usadas em tempo de execução: `go`, `git`, `gopls` (a IDE instala se faltar) e, depois, `dlv`.
