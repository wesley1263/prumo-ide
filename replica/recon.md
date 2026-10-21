# Recon map: GoLand (desktop: Linux, macOS, Windows)

Escopo: o core loop de uma IDE Go mais a integração Git. Editor com inteligência de linguagem, navegação, busca,
refatorações, quick-fixes, run configurations, test runner com coverage, debugger, terminal e o fluxo Git completo
(changes, commit, partial commit, diff, push, branches, log, merge de conflitos e blame).
Para: uso pessoal e interno do time, sem venda.
Data: 2026-10-16

> Clean-room: este mapa vem só da documentação pública e do site da JetBrains. Não foi lido, salvo ou descompilado
> nenhum binário, bundle ou plugin do GoLand. A IntelliJ Platform é open source (Apache 2.0), mas o plugin Go do
> GoLand é proprietário. O clone não reaproveita código de nenhum dos dois: a inteligência vem de ferramentas
> abertas do ecossistema Go (gopls, Delve, `go test -json`, git CLI).
> Termos: o EULA da JetBrains proíbe engenharia reversa do software. Por isso nada aqui saiu do binário. Se alguém
> do time for complementar a pesquisa com a própria licença, que seja só observando a UI, sem inspecionar internals.

## Sources

| # | fonte | URL | notas |
| --- | --- | --- | --- |
| 1 | marketing site (pt-br) | https://www.jetbrains.com/pt-br/go/ | posicionamento: "Go ready out of the box", navegação e refatoração em codebases grandes, AI/Junie |
| 2 | página de features | https://www.jetbrains.com/go/features/ | lista mais completa das features por área |
| 3 | help: tour da UI | https://www.jetbrains.com/help/go/guided-tour-around-the-user-interface.html | anatomia da janela principal (S03) |
| 4 | help: Search Everywhere | https://www.jetbrains.com/help/go/searching-everywhere.html | S06, S07 |
| 5 | help: refatorações | https://www.jetbrains.com/help/go/refactoring-source-code.html | lista e atalhos (S11) |
| 6 | help: run/debug configurations | https://www.jetbrains.com/help/go/run-debug-configuration.html | campos de Go Build e Go Test (S12) |
| 7 | help: testes | https://www.jetbrains.com/help/go/performing-tests.html | gutter, rerun failed, table tests, fuzz (S14) |
| 8 | help: coverage | https://www.jetbrains.com/help/go/code-coverage.html | suites e cores no gutter (S18) |
| 9 | help: debugging | https://www.jetbrains.com/help/go/debugging-code.html | fluxo geral (F08) |
| 10 | help: Debug tool window | https://www.jetbrains.com/help/go/debug-tool-window.html | painéis e toolbar de stepping (S15) |
| 11 | help: breakpoints | https://www.jetbrains.com/help/go/using-breakpoints.html | tipos e propriedades (S17) |
| 12 | help: commit e push | https://www.jetbrains.com/help/go/commit-and-push-changes.html | S20, S22, partial commits |
| 13 | help: branches | https://www.jetbrains.com/help/go/manage-branches.html | S23, smart checkout |
| 14 | help: Git Log | https://www.jetbrains.com/help/go/log-tab.html | S24 e ações de commit |
| 15 | help: conflitos | https://www.jetbrains.com/help/go/resolve-conflicts.html | S25, S26 |
| 16 | help: diff | https://www.jetbrains.com/help/go/comparing-files-and-folders.html | S21 |
| 17 | página de preços | https://www.jetbrains.com/go/buy/ | o conteúdo não carregou na leitura. Revendas citam cerca de US$ 249/ano para organizações (não confirmado) |
| 18 | conta do usuário | n/a | não usada nesta rodada. Pode complementar S01–S30 com screenshots próprios em `replica/screens/` |

O que a precificação diz: o GoLand não bloqueia nenhuma feature por plano. Tudo vem incluído, e o que se paga é a
licença. Então a priorização abaixo segue o uso diário do core loop, não os gates de preço.

## Core loop

Abrir um projeto Go, escrever código com completion e quick-fixes confiáveis, navegar e refatorar com segurança,
rodar e debugar programas e testes num clique pelo gutter, e commitar e fazer push sem sair da IDE.

## Screens

| ID | tela | rota / como chegar | propósito | componentes principais | estados vistos |
| --- | --- | --- | --- | --- | --- |
| S01 | Welcome screen | abrir o app sem projeto | abrir, criar ou clonar projeto | lista de projetos recentes, botões New/Open/Get from VCS, busca | vazio (sem recentes), com recentes, projeto recente com caminho inexistente |
| S02 | New Project | S01 → New Project | criar um módulo Go | campos de local e nome do módulo, seletor de Go SDK, checkbox `git init` | SDK não encontrado, pasta já existe, válido |
| S03 | Janela principal (shell) | após abrir o projeto | moldura da IDE | header (menu, Project widget, VCS widget, Run widget), barras de tool windows à esquerda e à direita, status bar (posição do caret, encoding, line ending, indent, branch, progresso), notificações | indexando (barra de progresso), pronto, erro de SDK |
| S04 | Editor | duplo clique num arquivo | ler e escrever código | abas, gutter (números de linha, ícones de run, breakpoints, marcadores de mudança, folding, coverage), breadcrumbs, inlay hints, popup de completion, lightbulb, highlight semântico, minimapa de erros (scrollbar) | arquivo vazio, com erros, read-only, arquivo grande, preview tab, split vertical/horizontal |
| S05 | Project tool window | Alt+1 | árvore de arquivos | árvore com ícones e cores de status VCS, External Libraries/Go SDK, toolbar (collapse, select opened file), menu de contexto (New, Rename, Delete, Run) | vazio, filtrando, arquivo ignorado, porcentagem de coverage |
| S06 | Search Everywhere | Shift duas vezes, Ctrl+N, Ctrl+Shift+N, Ctrl+Alt+Shift+N, Ctrl+Shift+A | achar arquivo, tipo, símbolo, ação ou texto | popup com abas All/Types/Files/Symbols/Actions/Text, filtro, "include non-project items", lista de recentes | vazio (mostra recentes), sem resultados (link para Find in Files), carregando |
| S07 | Find in Files / Replace in Files | Ctrl+Shift+F, Ctrl+Shift+R | busca e substituição textual no projeto | campo com regex, case e whole words, escopo (projeto, diretório, módulo), preview de resultados, botão "Open in Find Window" | sem resultados, muitos resultados (limite), regex inválido |
| S08 | Popups de código | Ctrl+Q, Ctrl+Shift+I, Ctrl+Alt+F7, Ctrl+F12, Ctrl+P | doc, definição, usos, estrutura e parameter info sem trocar de arquivo | popups flutuantes com mini-editor, lista de usos agrupada, árvore de estrutura | sem doc, um uso (vai direto), muitos usos |
| S09 | Find tool window | Alt+F7 ou "Open in Find Window" | resultados persistentes de usos e buscas | árvore agrupada (leitura/escrita, pacote, arquivo), preview, abas pinadas | vazio, agrupado, filtrado |
| S10 | Problems tool window + quick-fix | Alt+6, Alt+Enter | ver e corrigir diagnósticos | lista por arquivo com severidade, popup de intentions/quick-fixes, F2 para o próximo erro | sem problemas, erros, warnings |
| S11 | Refatorações | Shift+F6, Ctrl+Alt+V/C/M/N, Ctrl+F6, F6, Alt+Delete, Ctrl+Alt+Shift+T | mudar código com segurança | rename inline no editor, diálogos de Extract/Change Signature/Move, preview de usos, menu "Refactor This" | conflito de nomes, preview, sucesso, recusado (nada a refatorar) |
| S12 | Run/Debug Configurations | Run widget → Edit Configurations, Alt+Shift+F10 | criar e editar configs | lista em árvore por tipo (Go Build, Go Test, templates), formulário (run kind, package path, arquivos, working dir, env, program args, go tool args, build tags, before launch, "store as project file") | temporária (ícone translúcido), permanente, inválida (X vermelho) |
| S13 | Run tool window | Shift+F10 ou ícone no gutter | ver a saída do programa | uma aba por config, console com links clicáveis para arquivo:linha, toolbar (rerun, stop, pin, soft wraps, clear) | rodando, terminado com código 0, terminado com erro, aguardando stdin |
| S14 | Test runner | gutter de teste, Ctrl+Shift+F10 | ver resultados de testes | árvore pacote/teste/subteste com status, tempo, filtro (passed/ignored), rerun failed, rerun automático, histórico, console do teste selecionado, link para entradas de fuzz | rodando, todos passaram, falhas, panic, sem testes, timeout |
| S15 | Debug tool window | Shift+F9 ou gutter → Debug | inspecionar o programa pausado | abas Console e Debugger, painel de frames com seletor de goroutine, Variables (árvore expansível), Watches, toolbar (resume, pause, stop, step over/into/out, run to cursor, evaluate, mute breakpoints, view breakpoints) | rodando, pausado num breakpoint, pausado em panic, terminado, conexão perdida |
| S16 | Evaluate Expression | Alt+F8 | avaliar expressão no frame atual | campo com completion, árvore de resultado, histórico, "Add to Watches" | resultado, erro de avaliação |
| S17 | Breakpoints | Ctrl+Shift+F8 ou clique direito num breakpoint | gerenciar breakpoints | lista agrupada por arquivo, Enabled, Suspend, Condition, Log (mensagem, stack trace, expressão), Remove once hit, Disable until hit | nenhum, condicional (ícone com ?), desabilitado, mutado (cinza), inválido |
| S18 | Coverage | gutter → Run with Coverage, Ctrl+Alt+F6 | ver o que os testes executam | tool window com % por pacote e arquivo, gutter verde/amarelo/vermelho, gerenciador de suites | sem dados, suite única, suites mescladas |
| S19 | Terminal | Alt+F12 | shell integrado | abas de sessão, split, links para arquivos, cwd na raiz do projeto | nova sessão, processo encerrado |
| S20 | Commit tool window | Alt+0, Ctrl+K | revisar e commitar mudanças | árvore de changelists (Changes, Unversioned Files, Merge Conflicts), checkboxes, campo de mensagem com histórico, Amend, engrenagem (author, sign-off, checks: go fmt, optimize imports, analyze code, rodar config de teste), botões Commit e Commit and Push | sem mudanças, mudanças, conflito, check falhou (mensagem e opção "commit anyway") |
| S21 | Diff viewer | Ctrl+D numa mudança | comparar versões | lado a lado ou unificado, highlight por linha e palavra, setas para aplicar ou reverter chunks, checkboxes de inclusão por chunk e linha (partial commit), navegação entre diferenças, ignore whitespace, lado direito editável | sem diferenças, binário, arquivo novo ou removido |
| S22 | Push Commits | Ctrl+Shift+K, VCS widget | revisar e enviar commits | seletor de repo e remote, branch de destino editável, lista de commits com detalhes, push tags, Push e Force push (`--force-with-lease`) | sem remote ("Define remote"), rejeitado (diálogo Merge/Rebase), branch protegida |
| S23 | Popup de branches | clique na branch no header | trocar e gerenciar branches | busca, Favorites/Recent/Local/Remote/Tags, agrupamento por `/`, ações (checkout, new branch from, rename, delete, merge into current, rebase onto, compare, pull, push, update), botão Update Project | trocando com mudanças locais (Smart/Force checkout), branch excluída (notificação com restore) |
| S24 | Git tool window: Log | Alt+9 | histórico | painel de branches, grafo de commits com labels coloridos, filtros (texto e regex, branch, user, date, path), arquivos alterados, detalhes do commit, ações de commit (cherry-pick, revert, reset, checkout revision, new branch, new tag, interactive rebase, squash, fixup, edit message, drop) | repo vazio, filtrado, rebase interativo em andamento |
| S25 | Conflicts dialog | automático em pull, merge, rebase, cherry-pick ou unstash | escolher como resolver cada arquivo | lista de arquivos com Accept Yours, Accept Theirs, Merge…, "Resolve all simple conflicts" | conflitos pendentes, todos resolvidos |
| S26 | Merge tool de 3 painéis | Merge… em S25 | resolver conflitos linha a linha | esquerda (local, read-only), centro (resultado editável), direita (incoming, read-only), setas aceitar/ignorar, "Apply all non-conflicting", magic resolve, Accept and Finish | conflitos restantes, resolvido |
| S27 | Annotate (blame) e histórico de arquivo | clique direito no gutter → Annotate with Git Blame, Git → Show History | quem mudou o quê | coluna de autor e data no gutter colorida por idade, popup do commit, aba de histórico do arquivo | arquivo não versionado |
| S28 | Settings | Ctrl+Alt+S | configurar a IDE | árvore de categorias com busca: Appearance (tema, fonte), Keymap, Editor (fontes, code style Go, inlay hints), Go (GOROOT, GOPATH, build tags, módulos, env vars), Version Control/Git (path do git, staging area), Tools (file watchers) | busca sem resultados, valor inválido, alterado (botão Apply ativo) |
| S29 | Get from VCS | S01 → Get from VCS, Git → Clone | clonar repositório | URL, diretório, progresso, lista de contas (GitHub/GitLab) | clonando, falha de autenticação, pasta não vazia |
| S30 | Notificações | balão e tool window de notificações | eventos assíncronos (push concluído, SDK ausente, indexação, erros) | balões com ações, histórico | nenhuma, várias |

Total: 30 telas.

## Flows

```
F01 Abrir um projeto Go existente e começar a editar
    S01 → seletor de pasta → S03 (indexando) → S05 → S04
    happy path clicks: 3 (Open, escolher pasta, duplo clique no arquivo)
    edge: Go SDK não detectado (notificação S30 → S28), pasta sem go.mod, go.work multi-módulo, projeto enorme (indexação lenta)

F02 Clonar um repositório e abrir
    S01 → S29 → S03 → S04
    happy path clicks: 3 (Get from VCS, colar URL, Clone)
    edge: auth SSH/HTTPS falha, repo privado, pasta de destino já existe, submódulos

F03 Escrever código com completion e imports automáticos
    S04 (digitar → popup de completion → Enter)
    happy path clicks: 0 (teclado). Import adicionado sozinho, go fmt ao salvar
    edge: pacote não baixado (quick-fix "go get"), símbolo ambíguo entre pacotes, gopls ainda carregando

F04 Navegar: definição, implementações e usos
    S04 Ctrl+Click → S04 (outro arquivo) | Ctrl+Alt+B → S08 (implementações) | Alt+F7 → S09
    happy path clicks: 1
    edge: um só resultado (pula o popup), símbolo em dependência ou SDK (abre read-only), interface sem implementações

F05 Achar qualquer coisa
    Shift Shift → S06 → Enter → S04  |  Ctrl+Shift+F → S07 → S04
    happy path clicks: 0–1 (teclado)
    edge: sem resultados (link para Find in Files), item fora do projeto, regex inválido

F06 Corrigir um problema
    S04 (sublinhado) → Alt+Enter → quick-fix → S04  |  Alt+6 → S10 → S04
    happy path clicks: 1
    edge: vários fixes possíveis, fix que mexe em outros arquivos

F07 Renomear ou extrair com segurança
    S04 Shift+F6 → rename inline → Enter  |  Ctrl+Alt+M → S11 (diálogo) → preview → Refactor
    happy path clicks: 1–2
    edge: conflito de nome no escopo, símbolo exportado usado fora do módulo, undo de refatoração multi-arquivo

F08 Rodar o programa
    S04 ícone ▶ no gutter do main → Run → S13
    happy path clicks: 2 (cria config temporária)
    edge: erro de compilação (links no console), programa lê stdin, porta já em uso, salvar config temporária → S12

F09 Rodar testes e reexecutar os que falharam
    S04 ícone ▶ no gutter do teste (ou do arquivo/pacote) → S14 → Rerun Failed
    happy path clicks: 2
    edge: subtest de table test, panic no teste, -race, fuzz com entrada falha em testdata, teste sem saída (timeout)

F10 Debugar um bug
    S04 clique no gutter (breakpoint) → ▶ do gutter → Debug → S15 (pausado) → F8/F7 → S16 → F9
    happy path clicks: 3 (+ teclado para stepping)
    edge: breakpoint condicional (S17), muitas goroutines, panic sem breakpoint, variável otimizada (build sem -gcflags), debug de teste

F11 Ver coverage
    gutter → Run with Coverage → S18 + gutter colorido
    happy path clicks: 2
    edge: mesclar suites, coverage de vários pacotes, esconder coverage

F12 Commitar e fazer push
    S20 (Alt+0) → marcar arquivos → S21 (revisar, desmarcar chunks) → mensagem → Commit and Push → S22 → Push
    happy path clicks: 4
    edge: commit parcial por linha, amend, check de pré-commit falhou, hooks do git, push rejeitado (S22 → merge/rebase → F14)

F13 Criar e trocar de branch
    S03 header → S23 → New Branch → nome → Create
    happy path clicks: 3
    edge: mudanças locais conflitam (Smart Checkout com stash), branch remota sem local (checkout cria tracking), nome inválido

F14 Atualizar e resolver conflitos
    S23 Update Project (Ctrl+T) → S25 → Merge… → S26 → Accept and Finish → S20 → Commit
    happy path clicks: 5
    edge: rebase com vários commits conflitando, Abort merge, conflito em arquivo binário, "resolve simple conflicts"

F15 Investigar o histórico
    Alt+9 → S24 (filtrar) → commit → S21  |  gutter → Annotate → S27 → popup do commit → S24
    happy path clicks: 2–3
    edge: repo grande (log paginado), arquivo renomeado (seguir renames), merge commits

F16 Configurar o Go SDK e o ambiente
    S30 (aviso) → S28 Go → GOROOT → selecionar ou baixar SDK → Apply
    happy path clicks: 3
    edge: SDK numa versão que o gopls não suporta, GOPATH legado, GOFLAGS e build tags
```

Clicks a bater: rodar main (2), rodar teste (2), commit e push (4), trocar de branch (3).

## Components

| componente | variantes | estados | usado em |
| --- | --- | --- | --- |
| Tool window | dock esquerda, direita ou baixo, float, window | aberto, minimizado, focado, redimensionando | S05, S09, S10, S13–S15, S18–S20, S24 |
| Tool window bar (ícones laterais) | superior (vertical), inferior (horizontal) | ativo, inativo, com badge | S03 |
| Header widgets | Project, VCS (branch), Run (config, run, debug, stop, more) | idle, rodando, desabilitado | S03 |
| Status bar e widgets | mensagem, progresso, posição do caret, encoding, line ending, indent, branch | idle, progresso indeterminado ou determinado | S03 |
| Editor tab | normal, preview (itálico), pinada, modificada | ativa, inativa, com erro | S04 |
| Gutter | linhas, ícones de run/teste com status, breakpoints, mudanças VCS, folding, coverage, blame | hover, clicável, menu de contexto | S04, S21, S27 |
| Code completion popup | básico, smart, postfix templates | carregando, lista, vazio, com doc lateral | S04, S16 |
| Lightbulb / intention popup | quick-fix (vermelho), intention (amarelo) | lista, submenu, preview | S04, S10 |
| Search popup | Search Everywhere, Go to file/symbol/action, Recent files | vazio (recentes), resultados, sem resultados, carregando | S06 |
| Tree view | projeto, usos, testes, Variables, changelists, breakpoints, settings | expandido, colapsado, selecionado, carregando filhos, speed search | S05, S09, S12, S14, S15, S17, S20, S28 |
| Console | run, debug, teste | rodando, parado, links clicáveis, ANSI colors, input | S13–S15 |
| Terminal | sessão local | ativa, encerrada | S19 |
| Diff panel | 2 lados, unificado, 3 lados (merge) | sem diffs, chunks, checkboxes de inclusão | S21, S26 |
| Commit graph | linear, merges | selecionado, filtrado | S24 |
| Dialog | modal (refactor, push, conflicts), não modal (settings) | válido, inválido, carregando | S02, S11, S12, S22, S25, S28, S29 |
| Form field | texto, combo, path chooser, env vars editor, checkbox, lista editável | default, foco, erro, desabilitado | S02, S12, S17, S28 |
| Toolbar de ações | ícones com tooltip e atalho | enabled, disabled, toggled | S13–S15, S20, S21, S24 |
| Notification balloon | info, warning, error, com ações | visível, expirado (vai pro histórico) | S30 |
| Inline rename | caixa no editor com destaque das ocorrências | editando, conflito | S04 |
| Context menu | editor, projeto, gutter, árvores | com submenus, desabilitados | todas |

## Inferred data model

IDE desktop: não há banco. O estado vive em arquivos de configuração (global e por projeto) e em caches em disco.
O Git é a fonte da verdade do VCS. O clone lê o estado do git em vez de duplicá-lo.

```
AppSettings  theme, editorFont, fontSize, keymapId, recentProjects[], defaultGoSdkId, gitExecutablePath, advanced{}
             evidence: S28, S01 (recentes)
             confidence: high

GoSdk        id, goroot, version, source (detectado | baixado | manual)
             evidence: S02, S16 flow F16, help "GOROOT"
             confidence: high

Project      rootPath, name, modules[] (go.mod / go.work), goSdkId, gopath, buildTags[], envVars{}, vcsRoots[]
             evidence: S02, S28 seção Go, branches "multi-root projects"
             confidence: high

Workspace    (por projeto, não versionado) openTabs[] {path, caret, scroll, pinned}, layout das tool windows,
             activeRunConfigId, expandedTreeNodes, perBranchContext{branch → tabs, runConfig, breakpoints}
             evidence: S03, help branches "Restore workspace on branch switching"
             confidence: medium

RunConfiguration  id, name, type (goBuild | goTest), temporary (bool, máx. 5 temporárias),
                  storeAsProjectFile (bool), runKind (package | file | directory), packagePath, files[],
                  outputDir, runAfterBuild, workingDir, env{}, programArgs, goToolArgs, useBuildTags,
                  runWithSudo, redirectInputFrom, emulateTerminal, beforeLaunch[] (BeforeLaunchTask),
                  test{ framework (gotest | gocheck | gobench | fuzz), pattern, kind (directory | package | file) }
             evidence: S12, help "Run/debug configurations"
             confidence: high

BeforeLaunchTask  type (runConfig | goGenerate | externalTool), ref
             evidence: S12 "Before launch"
             confidence: medium

Breakpoint   id, kind (line | goPanic), filePath, line, enabled, suspend (bool), condition (expr),
             log{ message: bool, stackTrace: bool, expression }, removeOnceHit, disabledUntilBreakpointId,
             description, group
             evidence: S17, help "Breakpoints"
             confidence: high

Watch        id, expression, order
             evidence: S15, S16 "Add to Watches"
             confidence: high

TestRun      id, runConfigId, startedAt, durationMs, status, tree (TestNode[])
TestNode     name, package, parent, status (passed | failed | skipped | running | notStarted), durationMs, output, location
             evidence: S14, formato de `go test -json`
             confidence: medium (inferido da UI; o histórico do GoLand é suposição)

CoverageSuite  id, runConfigId, filePath (coverprofile), createdAt, active (bool)
               evidence: S18, help "Manage Coverage Reports"
               confidence: high

Changelist   id, name, isActive, comment, files[] (path), chunks atribuídos
             evidence: S20, help commit "Move to Another Changelist"
             confidence: high (é um conceito da IDE em cima do git, sem equivalente no git)

CommitDraft  message, amend, author, signOff, checks{ goFmt, optimizeImports, analyzeCode, runConfigId }, runHooks
             evidence: S20 engrenagem
             confidence: high

CommitMessageHistory  messages[] (recentes)
             evidence: S20 botão de histórico
             confidence: high

FavoriteBranch  repoRoot, branchName
             evidence: S23
             confidence: high

Bookmark     filePath, line, mnemonic (opcional), description
             evidence: gutter (help do tour da UI)
             confidence: medium
```

Relationships: AppSettings 1-n Project (recentes), GoSdk 1-n Project, Project 1-1 Workspace, Project 1-n
RunConfiguration, RunConfiguration 1-n BeforeLaunchTask, Project 1-n Breakpoint, Project 1-n Watch, RunConfiguration
1-n TestRun, TestRun 1-n TestNode (árvore), RunConfiguration 1-n CoverageSuite, Project 1-n Changelist (1 ativa),
Project 1-n FavoriteBranch.

Vêm de fontes externas, não persistidas pelo clone: diagnósticos, símbolos, usos e completion (gopls via LSP),
estado de debug, goroutines e variáveis (Delve via DAP), status, log, branches e diffs (git CLI).

## Feature matrix

Ver `features.csv`. Must: 43, should: 36, could: 22, skip: 15 (116 linhas). O CSV foi validado com `replica-diff/parity.py`
(paridade inicial 0/100, como esperado).

## Out of scope (cannot or should not be cloned)

- **Motor de inspeções proprietário do GoLand** (as dezenas de inspections próprias). Substituição: `gopls` analyzers
  mais `staticcheck`/`go vet`. Paridade parcial é esperada.
- **JetBrains AI Assistant e Junie, e a integração ACP com agentes de terceiros.** É serviço da JetBrains. Se o time
  quiser IA, isso é uma feature nova sobre APIs próprias, não parte do clone.
- **Marketplace de plugins e ecossistema de 50+ plugins.** É a rede da JetBrains.
- **Conta JetBrains, licenciamento, Toolbox App, Settings Sync, Code With Me.**
- **Database tools, Docker/Kubernetes, Terraform, HTTP Client, profiler, suporte a JS/TS/HTML/CSS.** Ficam fora do
  recorte escolhido, não por impossibilidade.
- **Identidade visual:** ícones da New UI, logo, nomes, splash e textos de ajuda da JetBrains. A fonte JetBrains Mono
  tem licença OFL e poderia ser usada, mas carrega a marca. Melhor escolher outra mono.
- **Código da IntelliJ Platform (Apache 2.0).** Seria legalmente reutilizável, mas fica fora da regra clean-room deste
  pacote e da stack (o clone não é JVM).
- **Mercurial, SVN e Perforce.** Só Git, como pedido.

## Size

Telas 30, fluxos 16, entidades 14 (persistidas pelo clone).

Partes difíceis:
1. **Editor e inteligência de linguagem com sensação de IDE.** O gopls cobre completion, navegação, rename, extract e
   diagnósticos via LSP. O trabalho está na UX: popups, inlay hints, highlight semântico, rename inline e preview
   multi-arquivo, com performance em repositórios grandes.
2. **Debugger.** Delve via DAP (`dlv dap`) dá stepping, frames, variables, evaluate e breakpoints condicionais e de log.
   A UI de goroutines (agrupar, filtrar, trocar de goroutine) e a estabilidade das sessões dão mais trabalho.
3. **Git com o nível de UX do GoLand.** Diff com inclusão por chunk e por linha (partial commit), changelists por cima do
   git, merge tool de 3 painéis com "magic resolve", grafo do log com filtros e rebase interativo.
4. **Test runner.** Parse de `go test -json` em árvore com subtests, rerun failed, mapear subtests de table tests de
   volta ao código, coverage no gutter a partir de `coverprofile`.
5. **Search Everywhere e Find in Files rápidos.** Índice de arquivos e símbolos próprio (workspace/symbol do gopls
   ajuda) mais `ripgrep` para texto.
6. **Terminal integrado.** PTY multiplataforma, que é resolvido com bibliotecas maduras.

Tamanho: **L (um trimestre)** para uma pessoa experiente, com stack pronta (editor embarcável, gopls, Delve DAP, git
CLI, PTY). Vira **XL** se a meta for paridade fina de UX em tudo. Nesse caso, entregar o core loop e o Git em fatias,
com Git avançado (rebase interativo, changelists múltiplas) como `should`/`could`.

Nota honesta para uso interno: VS Code com a extensão Go, ou o Zed, já cobrem boa parte desse recorte de graça. Vale
o clone se o objetivo for uma ferramenta sob medida para o time, ou o aprendizado.
