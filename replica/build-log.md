# Build log

Marcos 0 (base + primitivas) e 1 (fatia vertical) de `architecture.md`. Branch `feat/scaffold-wails-shell`.
Nada commitado (regra do usuário: o commit é dele).

Parity (`replica-diff/parity.py`): **31.6 / 100**, must-haves **12 de 43**. Esperado para o fim do marco 1.
Marco 2 (depurador, testes, git sync, busca, terminal, configurações, histórico do git, conflitos, configurações de execução, clonar, navegação e editor dividido, diff, goroutines, troca de projeto, janelas móveis, cobertura, breakpoints, valores no editor, stash, commit parcial, notificações, os acabamentos de navegação e ferramentas, os desejáveis restantes: peek, locais recentes, extrair, testes e histórico no commit, implementar interface, novo módulo, emular terminal e commit por linha; e os opcionais: bookmarks, run to cursor, benchmarks e fuzz, cherry-pick/revert/reset pelo Log, inline, mudar assinatura, safe delete, exit points e recursão, live templates, tarefas antes de rodar, configs no projeto, rerun ao salvar, somar coberturas, branches favoritas e comparar, tags, worktrees, contexto por branch, rebase interativo, changelists, attach/debug remoto e baixar o Go), branch `feat/debugger-tests-git-sync-search`:
**98.9 / 100**, must-haves **43 de 43**.

Teste ponta a ponta: `frontend/scripts/screenshots.mjs` (Chrome do sistema via playwright-core), **16 de 16 passos**,
zero erros no console. Testes Go: 7 pacotes, todos verdes com `-race`, incluindo integração real com gopls, git e go build.

## Telas

| ID | data | estado | o que falta | mais difícil que o esperado |
| --- | --- | --- | --- | --- |
| S01 Tela inicial | 2026-10-17 | done | — (novo projeto e clonar abrem aviso de "em breve": S02, S29) | — |
| S02 Novo projeto | — | stub | tudo | — |
| S03 Janela principal | 2026-10-19 | partial | menu principal completo, janela solta fora do app (modo "window"), dividir lado em duas janelas | `visibility:hidden` não esconde o Monaco (ele força `visible` em filhos): trocar por `display:none` |
| S04 Editor | 2026-10-17 | partial | dividir para baixo, arrastar abas entre os lados, mais de duas divisões | o worker certo do Monaco 0.57 é `editor.worker.js` (o `.start.js` não inicia sozinho, e o diff ficava mudo sem erro); navegar para outro arquivo exige `registerEditorOpener` |
| S05 Projeto | 2026-10-17 | done | menu de contexto (novo/renomear/apagar), atualização automática por watcher | — |
| S06 Buscar em tudo | 2026-10-18 | done | aba Tipos, incluir itens fora do projeto, recent locations, "abrir na janela de busca" | Shift duas vezes precisa ignorar Shift+letra (digitar "AB" são dois Shifts); maiúscula na consulta pede início de palavra ("US" → UserService), como no GoLand |
| S07 Buscar nos arquivos | 2026-10-18 | done | escopo por módulo, histórico de buscas, abrir resultados na janela S09, multilinha | depois do "Substituir tudo" o botão fica desabilitado e o foco caía para fora do diálogo (Esc parava de fechar); a busca roda no disco, então o editor salva antes |
| S08 Popups de código | 2026-10-17 | partial | popups próprios; hoje são os do Monaco (hover, peek, outline) | — |
| S09 Usos | 2026-10-19 | done | agrupar por pacote, pré-visualização ao lado, abrir buscas de texto (S07) nesta janela | leitura/escrita vêm do `documentHighlight` do gopls (uma chamada por arquivo); `pl-14` não existe na escala de espaçamento e era ignorado em silêncio |
| S10 Problemas | 2026-10-17 | partial | filtros, quick-fix pela lista, análise do projeto inteiro | — |
| S11 Refatorações | 2026-10-17 | partial | preview de rename, diálogos de extract/change signature | — |
| S12 Configurações de execução | 2026-10-19 | done | templates, "antes de rodar" (build, go generate), guardar como arquivo do projeto (.ide/run), configs de outros tipos (Go Remote, Docker) | rodar uma Go Test pelo Shift+F10 mostrava a janela Executar, não Testes (a escolha agora segue o tipo da config); a validação é do backend, para o diálogo e o Save concordarem |
| S13 Execução | 2026-10-17 | done | emulate terminal, histórico entre sessões | — |
| S14 Testes | 2026-10-18 | done | histórico entre sessões, rodar subteste pela árvore, benchmarks, fuzz, rerun automático | no Go recente o `go test -json` manda erros de compilação como eventos `build-output` (o motivo do "build failed" sumia); contraste: cores de status do git como texto sobre seleção ficavam abaixo de AA nos dois temas (24 pares, corrigidos nos tokens) |
| S15 Depuração | 2026-10-18 | done | agrupar/filtrar goroutines, valores inline no editor, run to cursor, attach | `dlv dap --client-addr` (o backend escuta e o Delve liga) evitou ler a porta da saída; duas condições de corrida achadas pelo `-race`; breakpoint "voltava" uma linha se as decorações fossem redesenhadas antes de salvar |
| S16 Avaliar expressão | 2026-10-18 | partial | diálogo próprio e watches persistentes (hoje é um campo na janela Depurar) | — |
| S17 Breakpoints | 2026-10-19 | done | hit count, "desligado até outro parar", grupos | silenciar fica só na memória do backend (por projeto): os breakpoints continuam salvos; o panic é um breakpoint de função em `runtime.gopanic` |
| S18 Cobertura | 2026-10-19 | done | cobertura por teste, histórico de execuções, modo `count` com contagem por linha | o import path do perfil vira caminho do projeto pelo `go list` que a execução de teste já faz; o fim de um bloco na coluna 1–2 é só o `}` e não conta |
| S19 Terminal | 2026-10-19 | done | dividir em painéis, renomear aba pela UI, buscar no histórico, Windows (ConPTY) | o corpo da tool window não é flex: o terminal ficava com 1 linha; o que se digitava antes do WebSocket abrir era descartado; jobs em segundo plano (`sleep &`) ficam em grupo próprio e sobreviviam ao fechar a aba: agora a sessão inteira morre (via /proc no Linux); atalhos da IDE não pegam teclas do shell (Ctrl+K, Esc...), só Alt+F12/Alt+número e Ctrl+Alt+S |
| S20 Commit | 2026-10-17 | done | changelists, commit parcial por trecho, histórico de mensagens, checks configuráveis, push | o Checkbox do React Aria engole o duplo clique: checkbox e nome viraram elementos separados |
| S21 Diff | 2026-10-19 | done | comparar com o index, ignorar espaços, aplicar trecho da esquerda num diff entre commits | — |
| S22 Push | 2026-10-18 | done | push de tags pela UI, definir remoto quando não houver | o "forçar" usa `--force-with-lease`; ssh em modo não interativo para não travar pedindo senha |
| S23 Branches | 2026-10-18 | done | favoritas, comparar branches, contexto por branch | com o popup aberto o React Aria deixa o resto da tela inerte: o "Restaurar" do aviso só funciona fechando o popup |
| S24 Log do git | 2026-10-19 | done | ações no commit (cherry-pick, revert, reset, nova branch daqui), filtro por data, abas de log fixadas | o `MenuTrigger` do React Aria só abre com o botão dele (um `<button>` comum não abre) e não aceita item com id vazio |
| S25 Conflitos | 2026-10-19 | done | resolver vários arquivos de uma vez, mostrar quem mudou cada lado | com a lista aberta o resto da tela fica inerte (React Aria): o teste do update foi ajustado para fechar a lista antes de usar o aviso do Commit |
| S26 Merge em 3 painéis | 2026-10-19 | done | setas por trecho no gutter, mesclar automaticamente só os não conflitantes de um lado, ignorar espaços | o git junta mudanças em linhas vizinhas num conflito só (o teste precisou afastá-las); a decoração do trecho não pode incluir a última quebra de linha, senão o destaque vaza; a mesclagem é a do próprio `git merge-file --diff3` com marcadores de 32 caracteres |
| S27 Anotar (blame) | 2026-10-19 | done | anotar uma revisão antiga, "anotar a revisão anterior" | texto injetado no começo da linha só aparece com `showIfCollapsed`; a coluna precisa ter largura múltipla do tab, senão a indentação do código encolhe |
| S28 Configurações | 2026-10-19 | done | editar atalhos, code style, build tags/env por projeto, baixar SDK, caminho do git | as configurações são do app inteiro: os testes rodam num projeto do Playwright separado, depois do resto, e voltam ao padrão em cada teste; o diálogo devolve o foco ao fechar (o teste focava o editor cedo demais) |
| S29 Clonar | 2026-10-19 | done | lista de contas (GitHub/GitLab), submódulos, clone raso, clonar de dentro de um projeto aberto | o git reescreve a linha do progresso com `\r`: o leitor separa por `\r` e `\n`; transportes `ext::`/`fd::` executam comandos e são recusados antes de chamar o git |
| S30 Notificações | 2026-10-19 | done | histórico entre sessões, agrupar por tipo | um `useEffect` que devolvia um número (do `&&`) derrubava a janela: o guarda de erros dos testes pegou |

## Definition of done: o que foi adaptado

- **"390px e 1440px":** é uma IDE desktop com janela mínima de 800x500 (tokens `layout.window-min`). Testado em
  **800x500 e 1440x900** (`replica/clone-screens/S03-800x500.png`, `S03.png`).
- **Screenshots para o diff:** em `replica/clone-screens/`. Não há screenshots do original em `replica/screens/` (o
  recon foi feito só por documentação pública), então o `/replica-diff` só vai conseguir pontuar features, não layout.
- **Só teclado:** abrir arquivo pela árvore (setas, Enter), salvar, rodar (Shift+F10), alternar janelas (Alt+1/0/4/6),
  commit (Ctrl+Enter) funcionam sem mouse. O ▶ do gutter é só mouse (equivalente de teclado: Shift+F10).

## Desvios da arquitetura

- **Sem `sqlc`/`goose`:** migrações embutidas com `PRAGMA user_version` e queries escritas à mão. São 19 tabelas e
  poucas queries. Reavaliar quando passar de umas 40.
- **Sem TanStack Query:** só Zustand. A invalidação já vem por evento (`git:status`, `run:state`).
- **Monaco sem o `editor.main`:** `scripts/gen-monaco-entry.mjs` gera uma entrada com o núcleo, as contribuições e o
  realce de todas as linguagens, mas sem os serviços de TS/CSS/HTML/JSON (que pedem workers próprios) e sem o
  cliente LSP que o Monaco 0.57 passou a embutir.
- **`Files.ReadExternal`:** não estava na arquitetura. Necessário para "ir para definição" na stdlib e nas
  dependências. Só lê dentro do GOROOT e do GOMODCACHE do projeto, sempre em modo somente leitura.
- **`cmd/devserver`:** o mesmo backend servindo a API por HTTP local (com token e checagem de Origin) para a UI rodar
  no navegador. É o que permite o teste ponta a ponta sem janela nativa.

## Pendências conhecidas

- **Terminal:** só Linux e macOS (no Windows a UI mostra "ainda não suportado"). Fora do Linux, fechar a aba encerra o
  grupo do shell, mas um job em segundo plano com grupo próprio pode sobreviver. Exige projeto confiável.

- **Busca de texto:** linha a linha (regex não atravessa linhas), ignora binários e arquivos acima de 5 MB, para em
  10.000 ocorrências. Sem confiança no projeto a lista de arquivos não usa o git (o `.gitignore` não vale; só
  `.git` e `node_modules` ficam de fora).

- **Emular terminal no console:** só Linux e macOS (no Windows a execução falha com aviso; ConPTY é TODO). No PTY,
  stdout e stderr chegam juntos (tudo como saída normal), o tamanho é fixo em 120×40 e a entrada digitada aparece
  pelo eco do próprio terminal. O console entende cores SGR e `\r`; outros códigos de cursor são descartados.
- **Implementar interface:** depende do quick-fix do gopls ("declarar os métodos que faltam"); com o pacote cheio de
  erros de tipo o gopls pode não oferecê-lo e fica só a linha `var _ I = (*T)(nil)`.

- **Mudar assinatura:** só o que o gopls oferece (mover parâmetro, remover parâmetro não usado). Adicionar ou
  renomear parâmetro com valor padrão nos chamadores, como no diálogo do GoLand, não existe.
- **Fuzz:** 10 s por padrão (`-fuzztime` nos argumentos do go troca). A entrada que falhou aparece no console com o
  caminho em `testdata/fuzz/`, sem link clicável.

- **Attach local:** no Linux com `kernel.yama.ptrace_scope = 1` (o padrão do Ubuntu, e o desta máquina), o kernel
  recusa anexar a um processo que não é filho do Delve. A IDE explica e sugere o modo remoto (`dlv exec --headless`)
  ou liberar o ptrace. Só o modo remoto foi testado de verdade aqui.
- **Contexto por branch:** só as abas. Os breakpoints continuam os mesmos em todas as branches.
- **Configs no projeto:** `.goide/run/<nome>.json`. "Outra configuração antes de rodar" vai pelo nome; renomear a
  config referenciada deixa o arquivo de quem aponta para ela com o nome velho até ele ser salvo de novo.
- **Corrigido ao rodar a suíte completa (2026-10-20):** a sessão de attach podia ficar em "iniciando" (a resposta
  do Attach chegava depois do evento de parada e passava por cima); listas do Commit e do popup de branches eram
  componentes criados a cada render e remontavam (o foco do teclado sumia e o menu de uma branch fechava sozinho);
  timers de bookmarks e recursão mexiam em modelo já descartado (editor de merge); um "run:state" de fim perdido
  pelo barramento deixava a execução "rodando" (agora o app confere o estado a cada 2 s enquanto há execução viva);
  rejeições internas e benignas do Monaco ("Canceled", "no diff result available") são ignoradas, como no VS Code.

- **Idioma (pt-BR e inglês):** a frase em português é a chave (`t('…')`), com o inglês em `src/i18n/en/*.ts`; mensagens
  do Go são traduzidas na borda (`src/i18n/backend.ts`: erros da API, mensagens de resultado do git, validações,
  linhas de sistema do console, eventos). O Monaco usa a tabela gerada por `scripts/gen-monaco-nls.ts` (o pacote
  pt-BR do monaco-editor 0.57 vem vazio); depois de atualizar o Monaco, rodar o script (o teste avisa). Trocar o
  idioma recarrega a janela. Ficam em português: a linha "[processo encerrado com código N]" do terminal (vem no
  fluxo do PTY), mensagens do git/gopls/Delve já vêm em inglês. Frases com um elemento no meio (código, nome de
  branch) viraram dois pedaços traduzidos, então a ordem das palavras segue a do português.

- **Credenciais HTTPS:** push/fetch por HTTPS que dependem de digitar usuário e senha falham com a mensagem do git
  (funciona com ssh-agent ou credential helper). Pedir a senha numa janela da IDE fica para depois.
- **Marcadores de mudança:** arquivo novo (não versionado) não ganha marcadores, e diffs muito grandes (mais de 4.000 operações) também não.

- **Histórico de testes:** os resultados ficam na sessão do app (as tabelas `test_runs`/`test_nodes` existem, mas ainda
  não são gravadas). Fechar o app perde a árvore das execuções anteriores.

- **Linha do breakpoint depois de salvar:** a nova linha vai para o banco numa chamada logo após a gravação. Recarregar/fechar
  até ~100 ms depois do Ctrl+S pode perder esse ajuste (o breakpoint volta para a linha antiga).
- **Delve:** a IDE procura o `dlv` no PATH, em `~/go/bin` e na pasta de ferramentas dela. Nesta máquina foi instalado o
  v1.27.2 em `~/go/bin` para desenvolver e testar.

- **Watcher de arquivos (fsnotify):** não entrou. A árvore e o status do git atualizam ao salvar, ao rodar, ao
  commitar e pelo botão Atualizar. Mudanças feitas fora da IDE só aparecem depois disso, mas o conflito ao salvar é
  detectado (diálogo "O arquivo mudou no disco").
- **App nativo:** `go build -tags desktop,production,webkit2_41` gera `build/bin/goide` (linka WebKitGTK 4.1). Não
  foi aberto aqui para não abrir uma janela na sessão do usuário sem pedir.
- **Memória (corrigido em 2026-10-18):** o hub só encerrava o gopls de um projeto ao fechá-lo, e os testes e2e nunca
  fecham projetos: a suíte acumulava um gopls por teste (~100 MB cada, ~90 testes) até o kernel matar o Chrome por OOM.
  Agora o gopls sai 30 s depois que o último editor desconecta (`GOIDE_LSP_IDLE`, 3 s nos testes), todo filho (gopls,
  Delve, go build/test, programa do usuário) morre junto com o backend no Linux (`internal/proc`, `Pdeathsig`) e a
  fixture dos testes fecha os projetos que abriu. Medido no f03: pico de 4 gopls (antes 14), nenhum sobrando no fim.
  macOS/Windows ainda sem o equivalente do `Pdeathsig` (TODO em `internal/proc`).
- **StrictMode no dev:** o React monta o shell duas vezes e o primeiro WebSocket do LSP fecha antes de abrir (aviso no
  console, não erro). Não acontece no build de produção.
