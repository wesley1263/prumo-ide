# Test plan: goide (reconstrução do core loop + Git do GoLand)

Build: branch `test/e2e-core-loop`, working tree não commitado (sobre `feat/scaffold-wails-shell`). Data: 2026-10-17.
Env: local. Backend real (`cmd/devserver`: SQLite, gopls v0.22, git 2.53, go 1.25.3) + Vite. Chrome 1440x900.
Dados: `scripts/seed-fixture.sh`, uma cópia nova por teste (módulo Go, git com 1 commit, 1 arquivo modificado e
1 não versionado).

Como rodar: `cd frontend && npx playwright test`. O Playwright sobe o devserver na porta 7799 (dados descartáveis em
`e2e/.run/`) e o Vite na 5174. Todo teste falha se houver erro no console, erro de página ou resposta 5xx (fixture
`guard` em `e2e/helpers.ts`). As telas passam pelo axe (WCAG 2 A/AA).

Resultado final: **59 casos automatizados, 59 passando**, estável em duas rodadas seguidas (259s). Testes Go:
7 pacotes verdes com `-race`.

Legenda: **auto** = Playwright (`frontend/e2e/`) · **go** = teste Go · **manual** = checklist no fim ·
**bloqueado** = a funcionalidade ainda não foi construída (ver `build-log.md`), não é bug.

## F01 Abrir um projeto Go existente (S01, S03, S05)

| case | tipo | passos | esperado | auto | resultado |
| --- | --- | --- | --- | --- | --- |
| F01-H1 | happy | Abrir → caminho → Confiar | árvore, nome no cabeçalho, versão do Go, "gopls pronto" | auto | passou |
| F01-E1 | edge: projeto não confiável | Modo restrito → ▶ no gutter | aviso de modo restrito; rodar pede confiança | auto | passou |
| F01-E2 | edge: entrada vazia | caminho só com espaços | botão Abrir desligado | auto | passou |
| F01-E3 | edge: acentos e emoji | pasta "Café ☕ loja" | abre, mostra o nome, roda | auto | passou |
| F01-E4 | edge: reabrir | fechar projeto → clicar no recente | abre sem perguntar confiança de novo | auto | passou |
| F01-E5 | edge: registro apagado | pasta do recente some → recarregar | recente desligado, "Pasta não encontrada", dá para remover | auto | passou |
| F01-E6 | edge: só teclado | Tab até Abrir → digitar caminho → Enter → Enter | projeto aberto, gopls pronto | auto | passou depois do BUG-005 |
| F01-E7 | edge: sem go.mod e sem git | pasta solta | abre; Commit diz que não é repositório | auto | passou |
| F01-E8 | edge: refresh no meio | recarregar com projeto aberto | volta à tela inicial, projeto nos recentes, sem erro | auto | passou |
| F01-E9 | edge: valor sugerido | abrir o diálogo e digitar | o texto pré-preenchido é substituído | auto | passou depois do BUG-005 |
| F01-N1 | negative: registro inexistente | caminho que não existe | "pasta não encontrada" no diálogo | auto | passou |
| F01-N2 | negative: tipo errado | caminho de um arquivo | "não é uma pasta" | auto | passou |
| F01-A11Y | leitor de tela | axe em S01, diálogo Abrir, diálogo Confiar, S03 | zero violações | auto | passou depois do BUG-007 |
| F01-E10 | edge: duas abas | o mesmo projeto em duas janelas | — | bloqueado | app desktop de uma janela (Wails v2) |
| F01-E11 | edge: SDK ausente | sem go no PATH | aviso na tela inicial | manual | não rodado: exige máquina sem Go |

## F02 Clonar um repositório (S29): bloqueado

F02-H1 clonar por HTTPS, F02-E1 pasta de destino ocupada, F02-N1 credencial errada, F02-N2 URL inválida:
**bloqueados** (S29 não construída).

## F03 Escrever código e salvar (S04)

| case | tipo | passos | esperado | auto | resultado |
| --- | --- | --- | --- | --- | --- |
| F03-H1 | happy | digitar `strings.ToUp` → Enter | completion e `import "strings"` adicionado | auto | passou |
| F03-H2 | happy | Ctrl+S num arquivo mal formatado | gofmt aplicado, import sem uso removido | auto | passou |
| F03-E1 | edge: mudou fora (manter) | editar, alterar o disco, Ctrl+S, "Manter a minha" | disco com a versão do editor | auto | passou |
| F03-E2 | edge: mudou fora (recarregar) | idem, "Usar a versão do disco" | editor com o disco, sem marca de não salvo | auto | passou |
| F03-E3 | edge: duplo envio | Ctrl+S duas vezes seguidas | sem conflito falso, disco certo | auto | passou |
| F03-E4 | edge: binário | abrir arquivo com bytes nulos | aviso, nada de lixo no editor | auto | passou |
| F03-E5 | edge: entrada muito grande | arquivo de 5 MB+ | só leitura com aviso | auto | passou |
| F03-E6 | edge: acentos e emoji | digitar "ação ☕ 🚀" e salvar | UTF-8 idêntico no disco | auto | passou |
| F03-E7 | edge: CRLF | editar e salvar arquivo CRLF | continua CRLF | auto | passou |
| F03-E8 | edge: fechar sujo | Ctrl+F4 com alteração | grava antes de fechar | auto | passou |
| F03-E9 | edge: modo restrito | Ctrl+S sem gopls | grava sem formatar | auto | passou |
| F03-E10 | edge: refresh no meio | digitar e recarregar sem salvar | texto gravado em disco | auto | passou depois do BUG-001 |
| F03-E11 | edge: fechar a janela nativa suja | fechar o app com alteração | salva e fecha | manual | não rodado (ver checklist) |
| F03-E12 | edge: offline | dependência não baixada sem rede | aviso do gopls, editor segue | manual | não rodado |

## F04 Navegar (S04, S08, S09)

| case | tipo | passos | esperado | auto | resultado |
| --- | --- | --- | --- | --- | --- |
| F04-H1 | happy | Ctrl+B em `cart.Cart` | abre cart.go na definição | auto | passou |
| F04-E1 | edge: fora do projeto | Ctrl+B em `fmt.Printf` | stdlib só leitura, com aviso; digitar não altera | auto | passou |
| F04-E2 | edge: usos | Alt+F7 em `Total` | peek com o uso em main.go | auto | passou |
| F04-E3 | Find usages em tool window (S09) | Alt+F7 | janela Busca com os usos | auto (F04-E2) | passou |
| F04-H2 | happy | Alt+F7 numa variável | declaração, escrita e leitura agrupadas; Enter abre a leitura | auto | passou |
| F04-H3 | happy + edge | Ctrl+U num método que implementa interface; Ctrl+U em main | abre a interface na linha do método; aviso "Nenhuma interface acima" | auto | passou |
| F04-H4 | happy | Dividir à direita; digitar à direita; outro arquivo à esquerda; Alt+F7 à direita; fechar | mesmo modelo nos dois lados; abas independentes; usos do arquivo da direita | auto | passou |
| F07-H2 | edge: prévia | Shift+F6 → Soma → Cancelar na prévia | lista dos arquivos e linhas antes/depois; nada muda | auto | passou |

## F05 Achar qualquer coisa (S06, S07)

| case | tipo | passos | esperado | auto | resultado |
| --- | --- | --- | --- | --- | --- |
| F05-H1 | happy | Shift Shift, "cart.go:22", Enter | abre cart.go na linha 22; vazio mostra recentes | auto | passou |
| F05-H2 | happy | Ctrl+Alt+Shift+N "Total"; Tab troca de aba | abre o método Total; consulta mantida | auto | passou |
| F05-H3 | happy | Ctrl+Shift+A "commit", Enter | abre a janela Commit | auto | passou |
| F05-N1 | edge: sem resultado / Shift+letra | "AB" no editor; "zzqqxx" | popup não abre; link para Buscar nos arquivos | auto | passou |
| F05-H4 | happy | Ctrl+Shift+F com texto não salvo, Alt+C, ↓, Enter | acha o texto não salvo; abre na linha | auto | passou |
| F05-H5 | edge: máscara, pasta, regex inválido | `*.go, !*_test.go`, pasta, `func (` | contagens certas; erro de regex no campo | auto | passou |
| F05-H6 | happy: substituir | Ctrl+Shift+R, Substituir uma, Substituir tudo | disco e editor aberto atualizados | auto | passou |

## F06 Corrigir um problema (S04, S10)

| case | tipo | passos | esperado | auto | resultado |
| --- | --- | --- | --- | --- | --- |
| F06-H1 | happy | Alt+Enter em `Product{}` → Fill | campos preenchidos | auto | passou |
| F06-H2 | happy | diagnóstico aparece no Problems | lista com arquivo e linha, clique navega | auto | passou (F01/F03 + S10) |

## F07 Renomear e extrair (S11)

| case | tipo | passos | esperado | auto | resultado |
| --- | --- | --- | --- | --- | --- |
| F07-H1 | happy | Shift+F6 `Total` → `Sum` → Ctrl+S | renomeado e salvo em cart.go, main.go e cart_test.go | auto | passou |
| F07-N1 | negative: nome inválido | Shift+F6 → `1nope` | aviso com o motivo, nada muda | auto | passou depois do BUG-006 |
| F07-E1 | preview de rename | — | — | bloqueado | sem diálogo de preview |

## F08 Rodar o programa (S12, S13)

| case | tipo | passos | esperado | auto | resultado |
| --- | --- | --- | --- | --- | --- |
| F08-H1 | happy | ▶ no gutter | "Total: R$ 93,90", código 0, config no cabeçalho | auto | passou |
| F08-E1 | edge: erro de compilação | ▶ com arquivo quebrado | link `arquivo:linha` abre o arquivo na linha 4 | auto | passou |
| F08-E2 | edge: stdin | programa que lê o nome | "Olá, Ana Júlia!" | auto | passou |
| F08-E3 | edge: não termina | Ctrl+F2 | "Parado.", Stop desliga | auto | passou |
| F08-E4 | edge: código ≠ 0 | `os.Exit(3)` | "código 3" | auto | passou |
| F08-E5 | edge: acentos e emoji na saída | — | texto igual | auto | passou |
| F08-E6 | edge: saída enorme | 200 mil linhas | termina, editor responde em menos de 2s | auto | passou depois do BUG-002 |
| F08-E7 | edge: rodar de novo | Shift+F10 | segunda execução em outra aba | auto | passou |
| F08-E8 | edge: alteração não salva | editar e ▶ | roda o texto do editor | auto | passou depois do BUG-003 |
| F08-E9 | editar configuração (S12) | — | — | bloqueado | diálogo S12 não construído |

## F09 Testes · F10 Debug · F11 Coverage: bloqueados

F09 (rodar teste pelo gutter, rerun failed, subtests, panic, -race, fuzz), F10 (breakpoint, stepping, goroutines,
evaluate, condicional) e F11 (coverage no gutter, suites): **bloqueados**. S14, S15, S16, S17 e S18 não foram
construídas.

## F12 Commitar (S20, S21, S22)

| case | tipo | passos | esperado | auto | resultado |
| --- | --- | --- | --- | --- | --- |
| F12-H1 | happy | Commit com o padrão | só o versionado entra; não versionado fica | auto | passou |
| F12-H2 | happy: diff | duplo clique no arquivo | diff com linhas adicionadas | auto | passou |
| F12-E1 | edge: entrada vazia | mensagem só com espaços | Commit desligado | auto | passou |
| F12-E2 | edge: duplo clique | duplo clique em Commit | um commit só | auto | passou |
| F12-E3 | edge: incluir novo | marcar o não versionado | entra; "Nada para commitar" | auto | passou |
| F12-E4 | edge: amend | Emendar | mensagem trocada, sem commit novo | auto | passou |
| F12-E5 | edge: acentos, emoji, várias linhas | Ctrl+Enter | mensagem idêntica no git | auto | passou |
| F12-E6 | edge: registro apagado | apagar README.md | aparece como apagado e entra | auto | passou |
| F12-E7 | edge: alteração não salva | editar, abrir Commit | o arquivo aparece e o texto do editor entra | auto | passou depois do BUG-004 |
| F12-N1 | negative: hook recusa | pre-commit com exit 1 | motivo do hook no aviso, nada commitado, mensagem preservada | auto | passou |
| F12-N2 | negative: permissão | modo restrito → Commit | pede confiança, nada commitado | auto | passou |
| F12-A11Y | leitor de tela | axe na janela de commit | zero violações | auto | passou |
| F12-E8 | push / push recusado | — | — | bloqueado | S22 não construída |
| F12-E9 | commit parcial por trecho | — | — | bloqueado | não construído |

## F13 Branches · F14 Atualizar

Cobertos por `e2e/f12-f14-sync.spec.ts` (popup de branches, push, atualizar, aviso de merge). A resolução de conflitos
(S25, S26) está em `e2e/f14-conflicts.spec.ts`:

| case | tipo | passos | esperado | auto | resultado |
| --- | --- | --- | --- | --- | --- |
| F14-H3 | happy | Resolver conflitos…; README: aceitar o deles; catalog.go: mesclar, aceitar o deles, aplicar; concluir | o não conflitante já mesclado; arquivo sem marcadores; commit de merge com 2 pais | auto | passou |
| F14-H4 | edge: pendente | aceitar os dois; aplicar com conflito sem resolver; abortar | as duas linhas; confirmação; fica a base; abortar volta ao estado anterior | auto | passou |

## F15 Histórico (S24, S27)

| case | tipo | passos | esperado | auto | resultado |
| --- | --- | --- | --- | --- | --- |
| F15-H1 | happy | Alt+9; selecionar; duplo clique no arquivo; ↓; filtros | grafo e rótulos; detalhes e "Em: feat/frete"; aba de diff do commit; filtros de texto e branch; sem resultado | auto | passou |
| F15-H2 | happy | commit pela IDE com o Log aberto | o commit novo aparece no topo sem recarregar | auto | passou |
| F15-H3 | happy | anotar, clicar na anotação, desligar, histórico do arquivo | hash e autor por linha; "não commitado"; abre o commit no Log; filtro de arquivo com 2 commits | auto | passou |

## F16 Configurar o Go SDK (S28)

| case | tipo | passos | esperado | auto | resultado |
| --- | --- | --- | --- | --- | --- |
| F16-H1 | happy | primeira abertura | SDK padrão = go do PATH (não o toolchain do go.mod da pasta) | go + auto | passou (versão na status bar em F01-H1) |
| F16-E1 | SDK em S28 | Configurações → Go | um SDK marcado como padrão; "Procurar SDKs" | auto (F28-H2) | passou |

## F02 Clonar (S29)

| case | tipo | passos | esperado | auto | resultado |
| --- | --- | --- | --- | --- | --- |
| F02-H1 | happy | Clonar, URL local, pasta, nome trocado, Clonar, Confiar | projeto aberto com o nome escolhido; origin aponta para a URL | auto | passou |
| F02-N1 | edge | URL sem esquema; repositório inexistente; pasta ocupada | erro no campo; "Repositório não encontrado" sem deixar pasta; "já existe e não está vazia" | auto | passou |

## S12 Configurações de execução

| case | tipo | passos | esperado | auto | resultado |
| --- | --- | --- | --- | --- | --- |
| S12-H1 | happy + edge | nova Go Build com pasta inexistente, depois certa; args, variável, stdin; Shift+F10 | erro no campo e OK não fecha; o programa recebe args, PORTA e a entrada do arquivo | auto | passou |
| S12-H2 | happy + edge | nova Go Test com pacote, padrão inválido e depois ^TestTotal$, -v -count=1 | erro de regex no campo; Shift+F10 abre Testes com TestTotal passou | auto | passou |
| S12-H3 | happy | temporária do gutter → permanente, duplicar, apagar com Cancelar e com OK | Cancelar desfaz; OK apaga de verdade e o menu do cabeçalho acompanha | auto | passou |

## Acabamentos do marco 2

| case | tipo | passos | esperado | auto | resultado |
| --- | --- | --- | --- | --- | --- |
| S21-H1 | happy | diff do disco: F7, Shift+F7, Unificado, Lado a lado, Reverter trecho | contador "i de n · tipo"; o trecho volta no disco (salvamento automático) | auto | passou |
| S21-H2 | edge | diff de um commit | navegação sim, reverter não | auto | passou |
| F10-H5 | happy | 3 workers parados num canal; Runtime; escolher um worker; filtro | grupo main.worker (3); runtime escondido até pedir; a pilha troca | auto | passou |
| F01-H4 | happy | trocar de projeto pelo cabeçalho com edição pendente | o pendente vai para o disco; abre o outro; "Abrir ou clonar outro…" volta à tela inicial | auto | passou |
| S03-H1 | happy | Mover para → Direita; Alt+6; reabrir o projeto | janela à direita; atalho continua; lugar salvo | auto | passou |
| S03-H2 | happy | arrastar o ícone para a outra barra e de volta | a janela muda de lado | auto | passou |
| S03-H3 | happy | Flutuante; arrastar; redimensionar; Shift+Esc; Alt+6 | move 100x60; cresce 50; reabre no mesmo lugar | auto | passou |

## Desejáveis (marco 2, fim)

| case | tipo | passos | esperado | auto | resultado |
| --- | --- | --- | --- | --- | --- |
| S18-H1 | happy | ▶ → Rodar os testes do pacote com cobertura; abrir cart.go; esconder/mostrar | % entre 50 e 100; faixas verde e vermelha; somem e voltam | auto | passou |
| S17-H1 | happy | botão direito no breakpoint → condição; depurar | para só no CAN-02 | auto | passou |
| S17-H2 | happy | Ctrl+Shift+F8 → mensagem de log; depurar | escreve no console e não para | auto | passou |
| S17-H3 | happy | silenciar todos; depurar; tirar o silêncio; depurar | roda até o fim; depois para | auto | passou |
| F10-H1 (ext.) | happy | parar no breakpoint | `total = 0` no fim da linha; some ao terminar | auto | passou |
| F13-H4 | happy | Guardar (stash) com os novos; Recuperar → Aplicar e remover | árvore limpa; tudo de volta; pilha vazia | auto | passou |
| F12-H5 | happy | trechos de catalog.go; desmarcar o Count; commitar | só o preço no commit; Count continua pendente | auto | passou |
| S30-H1 | happy | gerar um aviso; ícone "(N novas)"; abrir; limpar | aviso no histórico; contador zera; vazio | auto | passou |

## Acabamentos (marco 2, fim)

| case | tipo | passos | esperado | auto | resultado |
| --- | --- | --- | --- | --- | --- |
| F09-H5 | happy | selecionar TestTable/negativo na árvore → Rodar | só ele roda; config "go test TestTable/negativo" | auto | passou |
| F08-H5 | happy | menu → go mod tidy; ações → go vet | go.mod limpo; saída do vet e código de saída | auto | passou |
| F10-H6 | happy | Ctrl+Enter "total"; F9; reabrir o projeto | watch reavaliado (0 → 3490); continua depois de reabrir | auto | passou |
| F06-H3 | happy | filtros de erros/avisos e só o arquivo atual; Corrigir… | listas certas; abre as correções e aplica o import | auto | passou |
| F04-H5 | happy | Alt+7; clicar em Total; mover o cursor | vai ao símbolo; breadcrumbs e seleção seguem o cursor | auto | passou |
| F12-H6 | edge | formatar + go vet ligados; commit com problema | formatado; diálogo do vet; "Commitar mesmo assim" commita | auto | passou |
| F28-H6 | happy | trocar o atalho do Commit; conflito; restaurar | Ctrl+Alt+J abre o Commit e Ctrl+K não; aviso de conflito | auto | passou |
| F04-H6 | happy | Ctrl+Q duas vezes; mover o cursor | janela Documentação com a assinatura e a doc; troca sozinha | auto | passou |
| F07-H3 | happy | Alt+Insert num struct e numa função | NewProduct gerado; catalog_test.go criado com TestFind | auto | passou |

## Desejáveis restantes (marco 2, fim)

| case | tipo | passos | esperado | auto | resultado |
| --- | --- | --- | --- | --- | --- |
| F07-H6 | happy | Alt+Insert num struct → Implementar interface → fmt.Stringer | `var _ fmt.Stringer = (*Product)(nil)`, import do fmt e `func (… *Product) String() string` | auto | passou |
| S02-H1 | happy | tela inicial → Novo projeto; pasta, nome, caminho do módulo | go.mod com o caminho, main.go, abre sem pedir confiança | auto | passou |
| S02-N1 | negative | nome com espaço; pasta ocupada; sem main.go | erro no campo; "já existe e não está vazia"; só o go.mod | auto | passou |
| S12-H4 | happy | config com "Emular terminal no console"; programa com \r e cores | tty=true; só "progresso 100%"; "verde" com a cor ANSI | auto | passou |
| F12-H9 | happy | trechos do README → por linha → desmarcar duas linhas novas | commit só com "linha dois"; o resto continua no disco | auto | passou |
| unit | — | `ansi.test.ts`, `partial.test.ts`, `TestEmulateTerminalRunsInPTY` | SGR/\r; conteúdo parcial por linha; PTY com entrada e eco | auto | passou |

## Opcionais (marco 2, fim)

| case | tipo | passos | esperado | auto | resultado |
| --- | --- | --- | --- | --- | --- |
| F04-H9 | happy | F11; Ctrl+F11 → 3; editar acima; Ctrl+3; Shift+F11, F2, Enter; reabrir | marcas acompanham a edição; pulo certo; descrição; continua depois de reabrir | auto | passou |
| F10-H7 | happy | parado em main; cursor no "return total" do cart.go; Alt+F9; F9 | para no cursor com total = 9390; sem breakpoint sobrando; termina | auto | passou |
| F09-H6 | happy | ▶ no BenchmarkTotal e no FuzzAdd | "N× · ns/op · B/op" e "elapsed…, execs…" na árvore | auto | passou |
| F15-H5 | happy | Log → botão direito: cherry-pick, revert; tecla de menu: reset hard | commits certos na main; reset pede confirmação | auto | passou |
| F07-H7 | happy | Ctrl+Alt+N numa chamada; Ctrl+F6 → mover parâmetro; Alt+Delete usado e não usado | inline; assinatura e chamada trocadas; recusa com usos; apaga com o comentário | auto | passou |
| unit | — | `TestBenchAndFuzzArgs`, `TestBenchmarkNodeClosesWithPackage`, `TestCherryPickRevertReset` | argumentos; benchmark fecha com o pacote; cherry-pick/revert/reset, conflito e operação em andamento | auto | passou |

## Opcionais (marco 2, segunda leva)

Todos rodaram e passaram (suíte completa depois de fechar o GoLand e o PyCharm).

| case | tipo | passos | esperado | auto | resultado |
| --- | --- | --- | --- | --- | --- |
| F03-H10 | happy | abrir fat.go; cursor no func Fat | ↻ só na linha 8 (closure sombreada fica de fora); 3 destaques | auto | passou |
| F03-H11 | happy | "fori" + Enter + Tab + 3; "total.print" | for i := 0; i < 3; i++; fmt.Printf de total | auto | passou |
| S12-H5 | happy | tarefa go generate; depois comando que falha antes | saída do gerado; "A tarefa 1 antes de rodar falhou", sem go build | auto | passou |
| S12-H6 | happy | .goide/run de um colega; nova config compartilhada | aparece na lista; Minha.json sem id | auto | passou |
| F09-H7 | happy | Rodar de novo ao salvar; quebrar o Total e Ctrl+S | os testes rodam sozinhos e falham | auto | passou |
| S18-H2 | happy | cobertura do TestTotal; somar; cobertura do TestAddMissing | "2 execuções somadas"; % do cart.go sobe | auto | passou |
| F13-H5 | happy | favorita; comparar com feat/frete; duplo clique no arquivo | ★ e ordem; commits de cada lado; diff ↔ | auto | passou |
| F13-H6 | happy | abas diferentes em main e outra; trocar | cada branch volta com as suas abas | auto | passou |
| F15-H6 | happy | nova tag pelo Log; apagar; worktree da feat/frete | tag anotada; worktree na lista | auto | passou |
| F15-H7 | happy | rebase: reword, fixup, drop | 2 commits; mensagem nova; arquivo do drop some | auto | passou |
| F12-H10 | happy | F6 → nova changelist; desmarcar Mudanças; commit | commit só com cart.go; README pendente | auto | passou |
| F10-H8 | happy | dlv --headless; Ctrl+Alt+F5 remoto; breakpoint | para no breakpoint; Ctrl+F2 desconecta e o headless segue | auto | passou |
| Go | — | TestBeforeLaunchTasks, TestRunConfigsAsProjectFiles, TestCompareBranches, TestTagsAndWorktrees, TestInteractiveRebase, TestAttachRemoteHeadless, TestDownloadSdk | tarefas, arquivos, comparar, tags/worktrees, rebase, attach remoto, SDK (sha e caminho para fora recusados) | auto | passou |
| unit | — | coverageMerge.test.ts | soma das coberturas | auto | passou |

## Idioma (pt-BR e inglês)

| case | tipo | passos | esperado | auto | resultado |
| --- | --- | --- | --- | --- | --- |
| F28-H7 | happy | sistema em pt-BR; menu do Monaco; Configurações → English → OK | "Ir para definição"; recarrega com lang=en, "Go to Definition", "Language" | auto | passou |
| F28-H8 | happy | idioma "en" no backend; abrir pasta inexistente; confiar; rodar main; Commit | "folder not found: …" (Go traduzido); "Process finished with exit code 0."; "Commit message" | auto | passou |
| unit | — | i18n.test.ts, backend.test.ts | toda frase com t() tem inglês; toda mensagem do Go que vai para a tela tem inglês; tabela do Monaco atualizada | auto | passou |

## F19 Terminal (S19)

| case | tipo | passos | esperado | auto | resultado |
| --- | --- | --- | --- | --- | --- |
| F19-H1 | happy | Alt+F12, comandos, Ctrl+K, esconder e mostrar | shell na pasta do projeto; Ctrl+K vai para o shell; mesmo pid e histórico depois de esconder | auto | passou |
| F19-H2 | happy | nova aba, Ctrl+clique em arquivo.go:12, `exit 7` | abre o editor na linha 12; aba marcada como encerrada com o código | auto | passou |
| F19-N1 | edge: modo restrito | Alt+F12 sem confiança | terminal desligado; confiar liga | auto | passou |

## F28 Configurações (S28)

| case | tipo | passos | esperado | auto | resultado |
| --- | --- | --- | --- | --- | --- |
| F28-H1 | happy | tema Claro, Cancelar, Aplicar, recarregar | Cancelar descarta; Aplicar vale na hora e depois de recarregar | auto | passou |
| F28-H2 | busca | "inlay", "zzqq", "commit"; Ferramentas; Go | filtra páginas e destaca; sem resultado; atalho do Commit; gopls encontrado; SDK padrão | auto | passou |
| F28-H3 | edge: valor inválido | fonte 40, depois 17 | erro no campo e OK não fecha; 17 aplica no editor aberto | auto | passou |
| F28-H4 | happy | desligar "formatar ao salvar", Ctrl+S | arquivo gravado sem gofmt | auto | passou |
| F28-H5 | edge: shell inexistente | /nao/existe/zsh, depois /bin/sh | erro do backend no diálogo; terminal novo usa /bin/sh | auto | passou |

## Segurança e isolamento (transversal)

| case | tipo | passos | esperado | auto | resultado |
| --- | --- | --- | --- | --- | --- |
| SEC-1 | sem token | POST /rpc | 401 | auto | passou |
| SEC-2 | outra origem | Origin de outro site | 403 | auto | passou |
| SEC-3 | form de outro site | corpo não JSON | 415 | auto | passou |
| SEC-4 | path traversal | Files.Read/Write com `../` | recusado | auto + go | passou |
| SEC-5 | leitura externa | ReadExternal fora do GOROOT/GOMODCACHE | recusado | auto + go | passou |
| SEC-6 | sem confiança | Runs.Start, Git.Commit, WS /lsp | recusados (4001 no WS) | auto + go | passou |
| SEC-7 | método inexistente | /rpc com método que não existe | 404 sem stack trace | auto | passou |
| SEC-8 | dados de outro projeto | run config de A pedida pelo projeto B | não encontrada | go | passou (`TestRunConfigScopedToProject`) |

Não se aplicam (app local, usuário único, sem servidor): sessão expirada, rede lenta, segundo usuário, fuso e horário
de verão (ainda não há datas na UI; voltam com o log do git em F15), largura de celular (a janela mínima 800x500
foi verificada na fase de build), pagamento.

## Checklist manual (o que a automação não alcança)

Estes itens precisam do app nativo (`build/bin/goide`), que não foi aberto aqui para não abrir uma janela na sua
sessão:

1. **F03-E11:** abrir o demo, editar um arquivo sem salvar e fechar a janela pelo X. O app deve gravar e fechar, sem
   perder o texto (BUG-001, caminho nativo: `OnBeforeClose` → `app:before-close` → salvar → `App.Quit`).
2. **Seletor de pasta nativo:** "Abrir" deve abrir o diálogo do sistema, e cancelar não deve fazer nada.
3. **WebKitGTK:** acentos com teclado de dead keys (á, ç, ã) e colar com Ctrl+V/Ctrl+Shift+V no editor e no campo de
   mensagem do commit.
4. **Leitor de tela (Orca):** navegar pela árvore do projeto e pelas abas. O axe não substitui um leitor de verdade.
