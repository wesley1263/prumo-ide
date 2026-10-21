# Architecture: IDE Go desktop (uma reconstrução do core loop + Git do GoLand)

Lê: `replica/recon.md`, `replica/features.csv`, `replica/design/`. Uso interno, single-user, local, offline-first.
O template desta skill é para app web (Next.js, Postgres, auth, Stripe). Quase nada disso se aplica a uma IDE
desktop: não há servidor, usuários, pagamentos nem e-mail. As camadas abaixo são as equivalentes.

## Stack

| camada | escolha | por quê |
| --- | --- | --- |
| casca desktop | **Wails v2** (estável), build tag `webkit2_41` no Linux | backend em Go, a mesma linguagem do produto e do time. Usa o WebView do sistema, binário pequeno. A v3 ainda é beta (multi-janela). Migrar quando sair a 3.0, sem mudar o frontend |
| frontend | React 19 + TypeScript + Vite | o ecossistema de editor, terminal e virtualização é todo JS. O Wails já gera o template |
| estilo | Tailwind + `replica/design/tailwind.preset.js` + `tokens.css` | tokens do /replica-design. Paleta fechada, tema por `data-theme` |
| editor | **Monaco** (`monaco-editor`) | já traz completion, hover, signature help, inline rename, multi-cursor, find widget, inlay hints, semantic tokens e **diff editor** (S21). Tema gerado de `tokens.json` |
| inteligência Go | **gopls** via LSP, com um *LSP hub* em Go | é o padrão oficial do Go. O hub mantém um processo por projeto, multiplexa as requisições do frontend e as do próprio backend (workspace/symbol, localização de testes) e reescreve os ids |
| adaptador LSP → Monaco | adaptador TS próprio sobre `vscode-languageserver-protocol` (só tipos) + JSON-RPC por WebSocket | o `monaco-languageclient` puxa a camada de serviços inteira do VS Code e pesa demais. São cerca de 15 providers para mapear |
| debugger | **Delve** (`dlv dap`) + `github.com/google/go-dap` no backend | o DAP é o protocolo oficial do Delve. O backend é o cliente DAP e persiste breakpoints e watches |
| testes | `go test -json` (test2json) + `-coverprofile` | saída estruturada oficial. O parser monta a árvore com subtests |
| git | **git CLI** (`status --porcelain=v2 -z`, `log -z`, `diff`, `apply --cached`, `merge-file`) | paridade total com o git do usuário (hooks, config, credenciais, LFS). O go-git não faz rebase/merge completos e é lento em status |
| terminal | `@xterm/xterm` + `github.com/aymanbagabas/go-pty` | PTY multiplataforma (ConPTY no Windows) |
| arquivos | `github.com/fsnotify/fsnotify` + índice de arquivos em memória | watcher recursivo com ignores (`.git`, `vendor`, `node_modules`, `.gitignore`) |
| busca textual | `rg --json` quando instalado, fallback em Go (regexp + walk paralelo + gitignore) | o ripgrep é muito mais rápido. Para uso interno, não vale embutir o binário |
| busca fuzzy | matcher em Go sobre o índice (CamelCase/snake_case) | Search Everywhere precisa responder em menos de 50ms em repositórios grandes |
| banco local | **SQLite** via `modernc.org/sqlite` (Go puro) + `sqlc` + migrações embutidas com `pressly/goose` | um arquivo, zero servidor. O estado é pequeno (configs, breakpoints, histórico) |
| estado no frontend | Zustand (UI) + TanStack Query (dados vindos dos bindings) | stores simples. Cache e invalidação por evento |
| listas grandes | `@tanstack/react-virtual` | árvores, log do git, resultados de busca, goroutines |
| UI base acessível | React Aria Components | combobox, tree, menu, dialog e listbox com ARIA correto. Estilizados pelos tokens |
| ícones | `lucide-react` | MIT/ISC, nunca ícones da JetBrains |
| empacotamento | `wails build` → Linux (.deb/AppImage via nfpm), macOS (.app), Windows (NSIS) | uso interno: sem assinatura de código nem auto-update na v1 |
| dependências externas | `go`, `git` (do usuário); `gopls` e `dlv` instalados pela própria IDE com `go install` num diretório de ferramentas do app | evita versões quebradas no PATH e fixa versões testadas |

Um processo, um banco, nenhum serviço de rede. O clone não copia a arquitetura do GoLand (JVM, PSI, índices
próprios). Copia as funcionalidades, apoiadas no ferramental oficial do Go.

### Transporte backend ↔ frontend

| canal | uso | por quê |
| --- | --- | --- |
| bindings do Wails (`Service.Method`) | request/response: arquivos, git, configs, settings, debug | tipados, gerados para TS pelo Wails |
| eventos do Wails (`EventsEmit`) | notificações: fs mudou, status do git, fim de processo, debugger parou | push simples e de baixo volume |
| **WebSocket local** em `127.0.0.1:<porta aleatória>` com token por sessão | alto volume: LSP (`/lsp/<projectId>`), PTY (`/pty/<id>`), stdout/stderr de run (`/run/<id>`) | os eventos do Wails serializam por JSON na ponte do WebView e engasgam com MB/s de saída |

O token vai para o frontend por binding no boot. O servidor recusa conexões sem o token e qualquer `Origin` que não
seja o do app.

### Layout do repositório

```
main.go                     wails.Run, injeção dos serviços
internal/
  store/                    sqlite, migrations/ (0001_init.sql = replica/schema.sql), queries/ (sqlc), repos
  project/  sdk/  settings/ projeto, workspace trust, detecção/instalação de SDK, gopls e dlv
  fsx/  index/  search/     watcher, índice de arquivos, fuzzy, busca textual (rg | Go)
  lsp/                      hub: supervisor do gopls, multiplexador JSON-RPC, endpoint WS
  run/  testrun/  coverage/ execução de processos (process group), test2json, coverprofile
  debug/                    cliente DAP, sessões, breakpoints e watches
  git/                      wrapper da CLI, parsers porcelain v2, fila por repositório, grafo do log
  pty/                      terminais
  wsbridge/                 servidor WS local + auth por token
  events/                   nomes e payloads dos eventos (fonte única, exportada para TS)
frontend/
  src/design/               primitivas + rota /design (o pendente do /replica-design)
  src/shell/                AppShell, stripes, tool windows, status bar, header
  src/editor/               Monaco, tema a partir dos tokens, adaptador LSP, gutter
  src/panels/               project, find, problems, run, tests, debug, terminal, coverage
  src/git/                  commit, diff, merge, branches, log, blame
  src/lib/                  bindings gerados, cliente WS, keymap, registro de ações (Command Palette)
```

## Schema

Tabelas: **19**, em `replica/schema.sql`, que é a primeira migração. Acesso: **checagem na camada de dados**. Não há
usuários: o arquivo `state.db` vive em `os.UserConfigDir()/<app>/` com permissão 0600, e todo método de repositório
recebe `projectID` e filtra por ele. Nenhuma query lista dados de todos os projetos, exceto a de recentes.

Adaptações das regras do template:
- `id` é TEXT com UUID v7 gerado no Go (ordenável, sem `gen_random_uuid` no SQLite).
- Tempos são INTEGER em Unix ms UTC. A exibição converte para o fuso local.
- Paths ficam sempre relativos à raiz do projeto, com `/`, normalizados no Go. Só `projects.root_path` e
  `go_sdks.goroot` são absolutos.
- O schema não tem dinheiro, e-mail nem dado pessoal.

| grupo | tabelas |
| --- | --- |
| global | `app_settings`, `go_sdks`, `projects` |
| workspace | `workspaces` (blob JSON de UI), `branch_contexts` |
| run/test | `run_configurations`, `before_launch_tasks`, `test_runs`, `test_nodes`, `coverage_suites` |
| debug | `breakpoints`, `watches` |
| git (só o que o git não guarda) | `changelists`, `changelist_files`, `commit_messages`, `commit_options`, `favorite_branches` |
| navegação | `bookmarks`, `recent_locations` |

Regras garantidas pelo banco, não pela UI (validadas em SQLite 3.46):
- **Máximo de 5 configurações temporárias por projeto.** Um trigger apaga a menos usada ao entrar a sexta.
- **Uma changelist ativa por projeto.** Índice único parcial.
- **Um breakpoint de linha por (arquivo, linha)** e um de panic por projeto. Índices únicos parciais.
- **Um arquivo em uma changelist só.** PK (`project_id`, `repo_root`, `file_path`).
- **Um Go SDK padrão.** Índice único parcial.
- **Nome de run config único no projeto.** `before_launch` não referencia a própria config.
- `on delete` decidido em cada FK: tudo que é do projeto vai em cascata. Histórico (test runs, coverage) fica com
  `SET NULL` quando a config temporária some.

Fora do banco, de propósito:
- **Configs "store as project file"** também são escritas em `.ide/run/<nome>.json` no repositório para serem
  versionadas. Na abertura, o arquivo prevalece sobre o banco.
- **Estado do git**, que é sempre lido do repositório.
- **Diagnósticos e símbolos**, que vêm do gopls.

## API

Bindings do Wails como `Service.Method`, mais os canais WS. "Quem": `ui` é o frontend do próprio app (o único
chamador). Todo método que recebe `projectID` valida que o projeto está aberto, e os que executam código exigem
`trusted = 1`.

### F01, F02, F16: projeto, clone e SDK (S01, S02, S28, S29, S30)

| método | faz | quem | entrada | saída | fluxo |
| --- | --- | --- | --- | --- | --- |
| `App.Bootstrap` | estado inicial: settings, tema, recentes, SDKs, porta e token do WS | ui | — | `Bootstrap` | todos |
| `Projects.ListRecent` | projetos recentes, marcando caminhos inexistentes | ui | — | `[]RecentProject` | F01 |
| `Projects.Open` | abre a pasta, detecta go.mod/go.work, cria a linha, sobe watcher, índice e gopls (se trusted) | ui | `path` | `Project`, `needsTrust` | F01 |
| `Projects.SetTrusted` | marca o projeto como confiável e libera gopls/run/test/debug | ui | `projectID, bool` | — | F01 |
| `Projects.Create` | cria a pasta, roda `go mod init` e opcionalmente `git init` | ui | `path, module, sdkID, gitInit` | `Project` | F01 |
| `Projects.Close` / `Projects.RemoveRecent` | encerra os processos do projeto / tira dos recentes | ui | `projectID` | — | F01 |
| `Dialogs.PickDirectory` / `Dialogs.PickFile` | seletor nativo | ui | `title, default` | `path` | F01, F16 |
| `Git.Clone` | `git clone --progress`, com progresso pelo evento `clone:progress` | ui | `url, dir` | `cloneID` → `path` | F02 |
| `Sdks.List` / `Sdks.Detect` / `Sdks.Add` / `Sdks.SetDefault` | gerencia GOROOTs (detecção: PATH, `/usr/local/go`, `~/sdk`, `~/go/pkg/mod/golang.org/toolchain*`) | ui | `goroot` | `[]GoSdk` | F16 |
| `Sdks.Download` | `go install golang.org/dl/goX && goX download` | ui | `version` | progresso | F16 (could) |
| `Tools.Status` / `Tools.Install` | versões de gopls, dlv, git e rg; instala gopls e dlv fixados | ui | — | `ToolsStatus` | F01, F16 |
| `Settings.Get` / `Settings.Set` | lê/grava `app_settings` e o settings do projeto (env, build tags, SDK) | ui | `key(s), value` | JSON | F16 |
| `Workspace.Load` / `Workspace.Save` | abas e layout (save com debounce de 1s e no fechamento) | ui | `projectID, state` | `state` | F01 |

### F03, F06, F07: editor, quick-fixes e refatorações (S04, S10, S11)

| método | faz | quem | entrada | saída | fluxo |
| --- | --- | --- | --- | --- | --- |
| `WS /lsp/{projectID}` | JSON-RPC LSP bidirecional com o gopls, via hub (didOpen/didChange, completion, hover, signatureHelp, definition, implementation, references, documentHighlight, rename, prepareRename, codeAction, formatting, semanticTokens, inlayHint, documentSymbol, workspace/applyEdit) | ui | mensagens LSP | mensagens LSP | F03, F04, F06, F07 |
| `Files.Tree` | filhos de um diretório (lazy), com status VCS e flag ignorado | ui | `projectID, dir` | `[]Node` | F01 |
| `Files.Read` | conteúdo, encoding, line ending, mtime, read-only, limite de tamanho | ui | `projectID, path` | `FileContent` | F03 |
| `Files.Write` | grava com `expectedMtime`. Se o arquivo mudou no disco, devolve `conflict` | ui | `projectID, path, content, expectedMtime` | `mtime` ou `conflict` | F03, F07 |
| `Files.Create` / `Files.Rename` / `Files.Delete` / `Files.Move` | operações da árvore (rename e move de `.go` passam pelo LSP `willRenameFiles` quando suportado) | ui | paths | — | S05 |
| `Problems.List` | diagnósticos agregados do projeto (gopls com analyzers e staticcheck ligados) | ui | `projectID` | `[]Diagnostic` | F06 |

Refatorações (rename, extract, inline, change signature) e quick-fixes são LSP puro. O frontend mostra o preview do
`WorkspaceEdit`, aplica nos buffers abertos e grava os demais com `Files.Write`. O undo multi-arquivo fica num grupo
único no frontend.

### F04, F05: navegação e busca (S06–S09)

| método | faz | quem | entrada | saída | fluxo |
| --- | --- | --- | --- | --- | --- |
| `Search.Files` | fuzzy sobre o índice (CamelCase, snake_case, caminho) | ui | `projectID, query, includeNonProject, limit` | `[]FileHit` | F05 |
| `Search.Symbols` | `workspace/symbol` no gopls, via hub | ui | `projectID, query, limit` | `[]SymbolHit` | F05 |
| `Search.Text` | busca textual em streaming (rg ou Go), resultados no evento `search:results:{id}` | ui | `projectID, query, {regex, case, word, scope, mask}` | `searchID` | F05 |
| `Search.Cancel` | cancela a busca | ui | `searchID` | — | F05 |
| `Search.Replace` | substitui nos matches selecionados e devolve os arquivos alterados | ui | `projectID, searchID, matchIDs, replacement` | `[]path` | F05 |
| `Navigation.Recent` / `Navigation.Push` | arquivos e locais recentes | ui | `projectID, location` | `[]Location` | F05 |
| `Bookmarks.List` / `Bookmarks.Toggle` / `Bookmarks.Update` | bookmarks | ui | `projectID, path, line` | `[]Bookmark` | S04 |

Search Everywhere > Actions é só frontend, a partir do registro de ações, que também alimenta o keymap.

### F08: run (S12, S13)

| método | faz | quem | entrada | saída | fluxo |
| --- | --- | --- | --- | --- | --- |
| `RunConfigs.List` / `Get` / `Save` / `Delete` | CRUD (com sync de `.ide/run/*.json` quando `store_as_project_file`) | ui | `projectID, config` | `RunConfiguration` | F08 |
| `RunConfigs.FromContext` | cria uma config temporária a partir do gutter (main, teste, bench, fuzz, arquivo, pacote, diretório) | ui | `projectID, path, line, kind` | `RunConfiguration` | F08, F09 |
| `RunConfigs.MakePermanent` | `temporary = 0` | ui | `id` | — | F08 |
| `Runs.Start` | before-launch, depois `go build` e executa (process group próprio). Saída por `WS /run/{runID}` | ui | `configID, mode (run | debug | coverage)` | `runID` | F08, F10, F11 |
| `Runs.Stop` | SIGINT, depois de 3s SIGKILL no grupo (no Windows, job object) | ui | `runID` | — | F08 |
| `Runs.WriteStdin` | entrada do console | ui | `runID, data` | — | F08 |
| `GoTools.Run` | `go mod tidy`, `go generate`, `go get`, `go work sync` com saída num run tab | ui | `projectID, tool, args` | `runID` | S03 |

### F09, F11: testes e coverage (S14, S18)

| método | faz | quem | entrada | saída | fluxo |
| --- | --- | --- | --- | --- | --- |
| `Tests.Run` | `go test -json [-run|-bench|-fuzz] [-coverprofile]`. Nós chegam pelo evento `test:nodes:{testRunID}` em lotes de 50ms | ui | `configID, {filter, coverage}` | `testRunID` | F09, F11 |
| `Tests.RerunFailed` | monta um `-run` regex ancorado com os falhos, por pacote | ui | `testRunID` | `testRunID` | F09 |
| `Tests.Get` / `Tests.History` | árvore de uma execução / execuções anteriores | ui | `testRunID` / `projectID, configID` | `TestRun` | F09 |
| `Tests.Locate` | resolve teste/subteste → arquivo:linha (documentSymbol + busca do literal do subtest) | ui | `projectID, package, name` | `Location` | F09 |
| `Coverage.List` / `SetActive` / `Import` / `Delete` | suites | ui | `projectID, ids` | `[]CoverageSuite` | F11 |
| `Coverage.ForFile` | faixas de linhas full/partial/none, mesclando as suites ativas | ui | `projectID, path` | `[]LineRange` | F11 |
| `Coverage.Summary` | % por pacote e por arquivo | ui | `projectID` | `[]CoverageRow` | F11 |

### F10: debug (S15, S16, S17)

| método | faz | quem | entrada | saída | fluxo |
| --- | --- | --- | --- | --- | --- |
| `Breakpoints.List` / `Upsert` / `Delete` / `SetEnabled` | persiste e, com sessão ativa, envia `setBreakpoints` por arquivo | ui | `projectID, breakpoint` | `[]Breakpoint` | F10 |
| `Watches.List` / `Save` | watches ordenados | ui | `projectID, []expr` | — | F10 |
| `Debug.Start` | `dlv dap` + launch (`debug` / `test` / `exec`, `-gcflags=all=-N -l`), devolve sessão. Eventos `debug:stopped`, `debug:continued`, `debug:output`, `debug:terminated` | ui | `configID` | `sessionID` | F10 |
| `Debug.Continue` / `Pause` / `StepOver` / `StepIn` / `StepOut` / `Stop` | controle | ui | `sessionID, goroutineID` | — | F10 |
| `Debug.RunToCursor` | breakpoint temporário + continue | ui | `sessionID, path, line` | — | F10 |
| `Debug.SetMuted` | desliga todos os breakpoints na sessão sem apagar | ui | `sessionID, bool` | — | F10 |
| `Debug.Goroutines` | threads do DAP com filtro (esconder runtime) e agrupamento por estado | ui | `sessionID, filter` | `[]Goroutine` | F10 |
| `Debug.StackTrace` / `Scopes` / `Variables` | frames, escopos, variáveis paginadas (`start, count`) | ui | refs | árvores | F10 |
| `Debug.Evaluate` | expressão no frame (context `watch`, `repl` ou `hover`) | ui | `sessionID, frameID, expr, context` | `Value` | F10 |
| `Debug.Attach` / `Debug.ConnectRemote` | anexar a um PID / `dlv --headless` remoto | ui | `pid` / `host:port` | `sessionID` | F10 (could) |

### Terminal (S19)

| método | faz | quem | entrada | saída | fluxo |
| --- | --- | --- | --- | --- | --- |
| `Terminal.Open` | PTY com o shell do usuário, cwd na raiz e env do projeto | ui | `projectID, cwd, cols, rows` | `termID` | S19 |
| `WS /pty/{termID}` | bytes nos dois sentidos | ui | bytes | bytes | S19 |
| `Terminal.Resize` / `Terminal.Close` | resize e kill | ui | `termID, cols, rows` | — | S19 |

### F12–F15: git (S20–S27)

Toda operação passa por uma **fila por repositório** (uma escrita por vez, leituras concorrentes) e roda com
`LC_ALL=C`, `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0` (nas leituras) e um `GIT_ASKPASS` que abre um diálogo da
IDE quando o git pede credencial.

| método | faz | quem | entrada | saída | fluxo |
| --- | --- | --- | --- | --- | --- |
| `Git.Status` | por raiz: branch, upstream, ahead/behind, operação em andamento (merge/rebase/cherry-pick) e arquivos (staged, unstaged, untracked, conflito) já com a changelist | ui | `projectID` | `[]RepoStatus` | F12 |
| `Git.Diff` | conteúdos esquerdo/direito para o Monaco diff (HEAD, index, worktree ou rev) | ui | `projectID, repo, path, left, right` | `DiffContents` | F12, F15 |
| `Git.LineChanges` | faixas alteradas vs HEAD para o gutter | ui | `projectID, path` | `[]Range` | S04 |
| `Git.RollbackFiles` / `Git.RollbackHunk` | descarta mudanças (hunk via `git apply -R`) | ui | `paths` / `path, hunk` | — | F12 |
| `Git.Commit` | roda os checks (go fmt, imports, analyze, testes), depois commita. Parcial: monta um **index temporário** (`GIT_INDEX_FILE`) a partir de HEAD + patches selecionados, sem tocar o index do usuário | ui | `projectID, repo, {files, hunks, message, amend, author, signOff, runHooks}` | `hash` ou `checksFailed` | F12 |
| `Git.Push` | `push [--force-with-lease] [--tags]`. Rejeição devolve `rejected` para o diálogo Merge/Rebase | ui | `projectID, repo, remote, ref, opts` | `PushResult` | F12 |
| `Git.Outgoing` | commits a enviar para o diálogo de push | ui | `projectID, repo, remote, ref` | `[]Commit` | F12 |
| `Git.Branches` | locais, remotas, tags, recentes (reflog) e favoritas, com ahead/behind | ui | `projectID, repo` | `Branches` | F13 |
| `Git.Checkout` | `normal`, `smart` (stash → checkout → stash pop, com conflito tratado) ou `force`. Salva e restaura o `branch_context` | ui | `projectID, repo, ref, mode` | `CheckoutResult` | F13 |
| `Git.CreateBranch` / `RenameBranch` / `DeleteBranch` / `ToggleFavorite` | gerência de branches (delete devolve o hash para "restaurar") | ui | nomes | — | F13 |
| `Git.Fetch` / `Git.Update` / `Git.Merge` / `Git.Rebase` | sincronia (Update = fetch + merge ou rebase do upstream) | ui | `projectID, repo, ref, mode` | `OpResult` (pode trazer `conflicts`) | F14 |
| `Git.Conflicts` / `Git.ConflictVersions` | lista / base, ours e theirs (`git show :1: :2: :3:`) + resultado inicial com `git merge-file -p --diff3` | ui | `projectID, repo, path` | `MergeInput` | F14 |
| `Git.ResolveConflict` | grava o resultado (ou ours/theirs) e faz `git add` | ui | `projectID, repo, path, content|side` | — | F14 |
| `Git.ContinueOperation` / `Git.AbortOperation` | merge, rebase ou cherry-pick `--continue`/`--abort` | ui | `projectID, repo` | `OpResult` | F14 |
| `Git.Stash` / `Git.StashList` / `Git.Unstash` | stash | ui | `projectID, repo, msg | ref` | — | F13 |
| `Git.Log` | commits paginados (cursor) com lanes do grafo calculadas no Go e filtros (texto, branch, autor, data, path) | ui | `projectID, repo, filters, cursor, limit` | `LogPage` | F15 |
| `Git.CommitDetails` | mensagem, autor, arquivos alterados, branches que contêm | ui | `projectID, repo, hash` | `CommitDetails` | F15 |
| `Git.Blame` | `blame --porcelain` (com `-w -C`) | ui | `projectID, path, rev?` | `[]BlameLine` | F15 |
| `Git.FileHistory` | `log --follow` paginado | ui | `projectID, path, cursor` | `LogPage` | F15 |
| `Git.CherryPick` / `Revert` / `Reset` / `CreateTag` / `InteractiveRebase` | ações do log (rebase interativo via `GIT_SEQUENCE_EDITOR` apontando para um helper que lê o plano montado na UI) | ui | `hash(es), plan` | `OpResult` | F15 (could) |
| `Changelists.List` / `Create` / `Rename` / `Delete` / `SetActive` / `MoveFiles` | changelists | ui | `projectID, ...` | `[]Changelist` | F12 |
| `CommitMessages.Recent` | histórico de mensagens | ui | `projectID` | `[]string` | F12 |
| `CommitOptions.Get` / `Save` | opções da engrenagem | ui | `projectID, opts` | `CommitOptions` | F12 |

**Total:** cerca de 130 bindings (contando cada método das linhas agrupadas) e 3 canais WebSocket (`/lsp`, `/run`,
`/pty`). O número é alto porque cada ação de UI vira um método pequeno, não porque o backend seja grande.

### Eventos (no lugar de webhooks)

Entram do sistema (fontes externas): eventos do fsnotify, processos filhos (gopls, dlv, go, git, shell), credenciais via askpass.
Saem para a UI:

| evento | quando |
| --- | --- |
| `fs:changed {projectID, paths}` | o disco mudou: o editor recarrega ou pergunta se houver mudanças não salvas |
| `git:status {projectID}` | status do git recalculado |
| `lsp:state {projectID, state}` | gopls iniciando, carregando, pronto, caiu ou reiniciando |
| `index:progress {projectID, done, total}` | indexação de arquivos |
| `problems:changed {projectID}` | diagnósticos atualizados |
| `run:state {runID, state, exitCode}` | ciclo de vida do processo |
| `test:nodes {testRunID, nodes[]}` | lote de resultados de teste |
| `debug:* {sessionID, ...}` | stopped, continued, output, terminated, breakpoint verificado |
| `clone:progress`, `tools:progress` | progresso de operações longas |
| `notify {level, title, body, actions}` | balões (S30) |

### Jobs (goroutines do backend)

| job | quando | faz |
| --- | --- | --- |
| watcher do projeto | contínuo, debounce de 100ms | atualiza o índice, dispara `fs:changed` e agenda o status do git |
| status do git | 300ms após mudanças, no foco da janela e após operações git | `status --porcelain=v2 -z`. Sem polling contínuo |
| supervisor do gopls | contínuo | reinicia com backoff (máx. 3 em 5 min) e depois mostra um banner. Reinicia ao mudar SDK, env ou build tags |
| fetch em segundo plano | opt-in, a cada 15 min | `git fetch --prune` para mostrar ↓N nas branches (could) |
| instalador de ferramentas | no primeiro boot e quando falta algo | `go install` de gopls e dlv nas versões fixadas |
| limpeza | no boot | mantém 30 `test_runs` e 200 `recent_locations` por projeto, apaga coverprofiles órfãos e binários temporários de build/debug |
| autosave do workspace | debounce de 1s + ao fechar | `Workspace.Save` |

## The parts that bite

- **Fusos e horário de verão:** só na exibição de commits, blame e histórico. Grava em UTC ms, mostra no fuso local e
  respeita o fuso do autor no detalhe do commit (o git guarda o offset).
- **Idempotência:** eventos do fsnotify chegam em rajadas e duplicados (save atômico = create + rename). Debounce
  por caminho e trabalhar com o estado atual, não com o evento. Comandos da UI (commit, push) desabilitam o botão
  enquanto rodam, e o backend recusa uma segunda escrita no mesmo repositório (fila).
- **Corridas:**
  - `index.lock` do git: fila por repositório e nenhuma escrita git concorrente da própria IDE. Se o usuário rodar
    git no terminal ao mesmo tempo, tentar de novo com backoff e mostrar o erro.
  - Versões de documento no LSP: o adaptador mantém o número de versão por buffer e descarta respostas
    desatualizadas.
  - Salvar com format-on-save: formatar, aplicar e só então gravar, num único passo assíncrono.
- **Arquivo mudou no disco com buffer sujo:** `Files.Write` com `expectedMtime` e um diálogo "manter o meu, carregar o
  do disco ou comparar".
- **Paths e URIs:** Windows (letras de drive, `\`, case-insensitive) e URIs `file://` no LSP. Uma única função
  `uri↔path` testada nos três SOs. Paths no banco sempre relativos e com `/`.
- **Arquivos grandes e binários:** acima de 5 MB, abrir read-only sem LSP. Binários não abrem no editor. Diff de
  binário mostra só "diferem".
- **Processos órfãos:** gopls, dlv, programas do usuário e shells morrem com a IDE. Process group/`Setpgid` no
  Unix, job object no Windows, e kill do grupo inteiro no Stop e no shutdown.
- **Segurança (workspace trust):** abrir um repositório desconhecido não executa nada. O gopls roda `go list`, que pode
  baixar módulos e toolchains (`GOTOOLCHAIN`), e configs de run e hooks do git executam código. Até
  `Projects.SetTrusted`, o projeto fica em modo restrito: editor e git de leitura funcionam, gopls, run, test, debug e
  commit com hooks não.
- **WebSocket local:** escuta só em loopback, porta aleatória, token por sessão e checagem de `Origin`. Sem isso,
  qualquer página aberta no navegador poderia falar com o PTY.
- **Credenciais git:** nunca guardadas pela IDE. O askpass só repassa ao git, e o credential helper do sistema
  continua valendo.
- **Limites do inotify (Linux):** `max_user_watches` estoura em monorepos. Ignorar `.git`, `vendor`, `node_modules` e o
  `.gitignore`. Se mesmo assim faltar, mostrar um banner com o comando para aumentar o limite e cair para refresh
  por foco.
- **Desempenho do gopls em repositórios grandes:** memória alta e carga inicial lenta. Mostrar o estado (`lsp:state`)
  e não bloquear o editor. Search Everywhere > Arquivos usa o índice próprio e não depende do gopls.
- **Volume de saída:** console e testes podem jogar MB/s. Ring buffer no backend (limite configurável, padrão 10 MB),
  render virtualizado no frontend e saída pelo WS, não por evento.
- **Debug:** binário otimizado esconde variáveis, por isso sempre `-gcflags=all=-N -l`. Milhares de goroutines exigem
  paginação e filtro do runtime. Os breakpoints são reenviados por arquivo a cada mudança (o DAP substitui o
  conjunto).
- **Windows e PTY:** ConPTY só existe a partir do Windows 10 1809. Fora isso, o terminal é desabilitado com aviso.
- **WebKitGTK no Linux:** o Ubuntu atual só tem `webkit2gtk-4.1`. Compilar com `-tags webkit2_41`. Monaco no WebKit:
  testar IME, clipboard e atalhos (Ctrl+Shift+V e afins).
- **Busca em tempo real, offline, e-mail, multi-tenant, LGPD/GDPR:** não se aplicam. É single-user local, sem
  servidor e sem dados pessoais, exceto nome e e-mail de autores de commit, que já estão no repositório.

## Build order

0. **Base + primitivas** (o pendente do /replica-design)
   - scaffold Wails (React-TS) + Tailwind com o preset, tema dark/light, React Aria e Lucide
   - rota `/design` com todas as primitivas de `components.md`, itens 1–4 da ordem sugerida, mais screenshot
   - store SQLite + migração 0001 + sqlc; servidor WS com token
   - pré-requisitos no Linux: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, CLI do Wails

1. **Fatia vertical: abrir → editar → rodar → commitar**, feio mas inteiro
   - telas: S01 (lista de recentes + Open), S03 (shell com stripes e status bar), S05, S04 (Monaco + diagnósticos +
     completion + format on save), S13, S20 (lista de arquivos + mensagem + Commit, sem diff ainda)
   - tabelas: `app_settings`, `go_sdks`, `projects`, `workspaces`, `run_configurations`
   - rotas: `App.Bootstrap`, `Projects.Open`, `Projects.SetTrusted`, `Sdks.Detect`, `Tools.Status/Install`,
     `Files.Tree/Read/Write`, `WS /lsp`, `RunConfigs.FromContext`, `Runs.Start/Stop`, `WS /run`, `Git.Status`,
     `Git.Commit` (sem parcial)
   - pronto quando: abrir este repositório, introduzir um erro num `.go`, ver o sublinhado, corrigir com
     completion, rodar o `main` pelo gutter, ver a saída e commitar

2. **Must-haves**, por área (`features.csv`, 43 linhas)
   - projeto e shell: S01 completo, S28 (tema, fonte, keymap, Go), S29 clone, S30. Tabelas `app_settings`, `go_sdks`.
     Rotas `Projects.*`, `Git.Clone`, `Sdks.*`, `Settings.*`
   - editor e navegação: S06, S07, S08, S09, S10, rename (S11). Rotas `Search.*`, `Problems.List`,
     `Navigation.*`, providers LSP restantes
   - run e testes: S12, S14 (rerun failed, navegar para o código). Tabelas `test_runs`, `test_nodes`. Rotas
     `RunConfigs.*`, `Tests.Run/RerunFailed/Locate`
   - debug: S15 (breakpoints de linha, stepping, frames, variables, goroutines). Tabelas `breakpoints`. Rotas
     `Debug.*`, `Breakpoints.*`
   - terminal: S19. Rotas `Terminal.*`, `WS /pty`
   - git: S21 (diff), S22, S23, S25, S26, gutter de mudanças com rollback. Tabelas `changelists` (só a padrão),
     `commit_messages`. Rotas `Git.Diff/LineChanges/Rollback*/Push/Outgoing/Branches/Checkout/CreateBranch/
     RenameBranch/DeleteBranch/Update/Fetch/Merge/Rebase/Conflicts/ConflictVersions/ResolveConflict/
     Continue/AbortOperation`

3. **Should-haves** (36), depois **could-haves** (22)
   - should: S16, S17 (condicional, log, panic, mute), S18 + `coverage_suites`, S24 (log + grafo), S27 (blame e
     histórico), commit parcial (index temporário), amend, checks de pré-commit (`commit_options`), smart checkout,
     stash, inlay hints, parameter info, quick doc, extract, Replace in Files, restaurar abas, notificações, keymap
     editável, Go Tools menu
   - could: changelists múltiplas (`changelist_files`), rebase interativo, cherry-pick/revert/reset, favoritas e
     comparar branches (`favorite_branches`), contexto por branch (`branch_contexts`), bookmarks, benchmarks, fuzz,
     rerun automático, attach/remote debug, download de SDK, configs como arquivo do projeto, before-launch

4. **Fixes do /replica-entrepreneur:** ainda não rodou. Quando rodar, as correções entram aqui com as S-IDs afetadas.

Riscos que pedem um spike antes do marco 2: (a) Monaco + adaptador LSP próprio com o gopls num repositório grande,
(b) commit parcial com index temporário, (c) `dlv dap` com goroutines no frontend. Um dia cada, para medir antes de
construir em cima.
