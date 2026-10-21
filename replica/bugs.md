# Bugs

Rodada de testes de 2026-10-17 na branch `test/e2e-core-loop`. Todos reproduzidos por teste automatizado antes da
correção. O teste continua na suíte como regressão. As correções estão no working tree, **sem commit**: o commit é do
usuário. Quando houver commit, troque "corrigido (não commitado)" pelo hash.

Resumo: **7 bugs**: 1 S1, 1 S2, 5 S3, 0 S4. **7 corrigidos**, 0 abertos.

---

### BUG-001: texto digitado e não salvo se perde ao recarregar ou fechar

- Severity: S1 (perda de dados)
- Flow / case: F03 / F03-E10 (e F03-E11 no app nativo)
- Screen: S04
- Build: working tree de `test/e2e-core-loop`. Browser / device: Chrome, 1440px

Steps
1. Abrir o projeto e o arquivo NOTES.md.
2. Digitar " urgente" no fim da linha, sem Ctrl+S.
3. Recarregar a página (no app nativo: fechar a janela).

Expected: o texto vai para o disco, como no autosave das IDEs desktop, ou o app pergunta antes.
Actual: o arquivo continua "TODO: frete" e o texto digitado some sem aviso.
Evidence: teste `F03-E10 recarregar com alteração não salva não perde o texto` (falhava com `Expected "TODO: frete urgente" / Received "TODO: frete"`).
Suspected cause: só havia salvar explícito (Ctrl+S, fechar aba, commit). Nenhum gancho de unload nem de fechamento de janela.
Status: corrigido (não commitado). Autosave sem formatar em `src/editor/autosave.ts`: quando o editor perde o foco,
quando a janela perde o foco, após 2s sem digitar, antes de rodar e de commitar. No unload, grava com
`fetch(keepalive)`. No app nativo, `OnBeforeClose` segura a janela e a UI salva e chama `App.Quit`. Gravações do
mesmo arquivo entram numa fila, para não gerar conflito falso.

### BUG-002: saída grande congela o console da execução

- Severity: S2 (funcionalidade quebrada, sem contorno)
- Flow / case: F08 / F08-E6
- Screen: S13
- Build: idem. Browser / device: Chrome, 1440px

Steps
1. Rodar um programa que imprime 200 mil linhas.

Expected: o console mostra a saída até "Processo encerrado com código 0." e a interface continua respondendo.
Actual: o console para por volta da linha 1.400 e nunca mostra o fim, nem depois de 60s.
Evidence: teste `F08-E6 saída grande (200 mil linhas) não trava a interface`, screenshot da falha parado em "linha 1402".
Suspected cause: duas causas. A principal: `Output.Write` desligava (fechava o canal de) quem ficasse 1.024 pedaços
atrasado, e o WebSocket entendia isso como fim da execução. A secundária: cada `Println` virava um frame do
WebSocket e uma renderização inteira do console.
Status: corrigido (não commitado). `Output` passou a usar cursores (`internal/run/output.go`): o escritor nunca
espera e nenhum leitor é desligado, com o teste Go `TestOutputSlowReaderGetsEverything`. O WebSocket manda lotes de
até 64 KB já emendados. A UI aplica uma vez por quadro, em blocos memoizados de 64 KB, com teto de 2 MB visíveis e
aviso do que foi ocultado.

### BUG-003: rodar usa a versão do disco, não a do editor

- Severity: S3 (quebrado com contorno: salvar antes)
- Flow / case: F08 / F08-E8
- Screen: S13
- Build: idem

Steps
1. Abrir cmd/shop/main.go e trocar o texto do Printf, sem salvar.
2. Clicar no ▶ do gutter.

Expected: a saída reflete a alteração ("Total: R$ Novo 93,90").
Actual: a saída é a da versão antiga em disco.
Evidence: teste `F08-E8 rodar com alteração não salva usa o texto do editor`.
Status: corrigido (não commitado). `runConfig` grava tudo (autosave) antes de `Runs.Start`.

### BUG-004: arquivo editado e não salvo não aparece na janela de commit

- Severity: S3 (contorno: salvar antes)
- Flow / case: F12 / F12-E7
- Screen: S20
- Build: idem

Steps
1. Editar README.md sem salvar.
2. Abrir a janela de commit (Alt+0).

Expected: README.md aparece em "Mudanças" e o commit leva o texto do editor.
Actual: README.md não aparece (o git só vê o disco). Não dá para incluí-lo no commit.
Evidence: teste `F12-E7 commit com edição não salva salva antes e commita o texto do editor` (timeout procurando o checkbox de README.md).
Status: corrigido (não commitado) junto com o BUG-001. Ao trocar o foco para a janela de commit, o editor grava, e o
`git:status` que o backend emite atualiza a lista.

### BUG-005: caminho sugerido em "Abrir pasta" recebe o texto digitado em vez de ser substituído

- Severity: S3 (contorno: apagar antes de digitar)
- Flow / case: F01 / F01-E6, F01-E9
- Screen: S01 (diálogo Abrir pasta)
- Build: idem

Steps
1. Na tela inicial, clicar em Abrir (o campo vem com `~/` preenchido e focado).
2. Digitar um caminho absoluto, `/tmp/x`.

Expected: o campo fica `/tmp/x`.
Actual: o campo fica `/home/weslei//tmp/x` e a abertura falha com "pasta não encontrada".
Evidence: teste `F01-E9 caminho pré-preenchido vem selecionado: digitar substitui`; screenshot com o erro.
Status: corrigido (não commitado). `TextField` ganhou `selectOnFocus` e o diálogo usa.

### BUG-006: rename com nome inválido falha em silêncio

- Severity: S3 (o usuário não sabe por que nada aconteceu)
- Flow / case: F07 / F07-N1
- Screen: S04 / S11
- Build: idem

Steps
1. Em cart.go, cursor em `Total`, Shift+F6.
2. Digitar `1nope` e Enter.

Expected: um aviso com o motivo ("invalid identifier…") e nada alterado.
Actual: nada é alterado (correto), mas nenhum aviso aparece.
Evidence: teste `F07-N1 nome inválido é recusado sem mudar nada`. O log de depuração mostrou que o gopls devolve
`invalid identifier to rename: "1nope"` e o adaptador repassa como `rejectReason`.
Suspected cause: o Monaco mostra o `rejectReason` num balão que some quando o cursor se mexe, e ele se mexe ao
fechar a caixa de rename.
Status: corrigido (não commitado). Recusas de rename e de prepareRename também viram um aviso da IDE.

### BUG-007: abas com botão dentro (acessibilidade)

- Severity: S3
- Flow / case: transversal / F01-A11Y
- Screen: S04 (abas do editor) e S13 (abas de execução)
- Build: idem

Steps
1. Abrir um arquivo e rodar o axe na janela principal.

Expected: zero violações WCAG 2 A/AA.
Actual: `nested-interactive (serious)`: `<button>` de fechar dentro de `role="tab"`. O leitor de tela anuncia a aba
de forma confusa e o foco pode cair no botão.
Evidence: teste `F01-A11Y …`, saída `nested-interactive (serious): 1x Interactive controls must not be nested`.
Status: corrigido (não commitado). O X virou só mouse (`aria-hidden`). Pelo teclado, a aba fecha com Ctrl+F4, como já
era.

---

## A conferir (não reproduzido como bug)

- **Monaco fora do axe:** o editor e o diff são de terceiros e foram excluídos da varredura. Vale uma passada com leitor
  de tela de verdade (checklist manual, item 4).
- **Aviso no console em dev:** "WebSocket is closed before the connection is established" aparece porque o
  StrictMode do React monta o shell duas vezes. É aviso, não erro, e não acontece no build de produção.
- **Unload de arquivos grandes:** `fetch(keepalive)` tem limite de ~64 KB por página. Arquivos maiores, editados
  e não salvos nos últimos 2s antes de um recarregamento, dependem do autosave por ociosidade. No app nativo o
  fechamento usa o caminho `App.Quit`, que não tem esse limite.
- **Tempo do rename:** a caixa de rename só aparece depois do `prepareRename` do gopls (algumas centenas de ms).
  O que for digitado antes vai para o editor. É o comportamento padrão do Monaco, mas pode surpreender quem digita
  rápido.
