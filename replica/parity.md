# Parity: goide × GoLand (core loop + Git)

Data: 2026-10-17. Build: working tree de `test/e2e-core-loop` (marcos 0 e 1 + correções da rodada de testes).
Ferramentas: `replica-diff/parity.py` e `imgdiff.py`.

## Veredito: **não shippable**

| critério | situação |
| --- | --- |
| must-haves | **13 de 43** (faltam 30) |
| feature score | **32,3 / 100** |
| bugs S1 abertos | 0 (o único S1, BUG-001 de perda de texto, foi corrigido e tem teste) |
| bugs S2 abertos | 0 |
| layout | sem medida válida (ver abaixo); a comparação estrutural manual bate nas regiões principais |

Um clone em 32% está em 32%. O que existe funciona de ponta a ponta e tem 59 testes e2e verdes: abrir, editar com
gopls, navegar, rodar, commitar. Mas faltam inteiros o debugger, o test runner, o terminal, a busca global e metade
do Git, e é isso que alguém que usa GoLand no dia a dia sente falta em 5 minutos.

## Feature parity

```
features 32.3  (101 counted, must-haves 13 of 43 done)
```

| área | score | features |
| --- | --- | --- |
| testes | 0,0 | 12 |
| debug | 0,0 | 13 |
| terminal | 0,0 | 1 |
| git | 14,3 | 23 |
| refatoração | 37,5 | 5 |
| navegação | 41,4 | 12 |
| shell | 50,0 | 6 |
| projeto | 55,9 | 7 |
| run | 55,9 | 8 |
| editor | 74,2 | 14 |

15 linhas `skip` ficaram fora da conta de propósito: inspeções proprietárias, IA da JetBrains, marketplace, conta e
licença, ferramentas fora do recorte e identidade visual. Ver `features.csv`.

Atualizações da matriz nesta rodada, com evidência dos testes:
- **Quick-fixes (Alt+Enter):** passou de `partial` para `yes`, com o caso F06-H1 passando.
- **Rename:** ganhou testes e2e, mas continua `partial` porque falta o preview.

### Must-haves que faltam, na ordem de build

**Não feitos (20):**
- **debug:** breakpoints de linha no gutter; debug de main e de teste; frames e variables; stepping (over, into,
  out, resume, pause, stop); goroutines
- **git:** diálogo de conflitos; marcadores de mudança no gutter com rollback; merge em 3 painéis; popup de branches;
  pull e update; diálogo de push
- **navegação:** Find in Files; Search Everywhere
- **projeto:** clonar repositório
- **shell:** Settings
- **terminal:** terminal integrado
- **testes:** rodar teste, arquivo ou pacote pelo gutter; árvore de resultados com subtests; rerun failed; navegar do
  resultado para o código

**Parciais (10):**
- **editor:** split (as abas e a preview tab já existem)
- **git:** push (o commit existe); diff (falta modo unificado, navegação entre diferenças e aplicar chunk)
- **navegação:** Find usages em tool window agrupada (hoje é o peek); "super" no go to implementation
- **projeto:** escolher o SDK em S28
- **refatoração:** preview do rename
- **run:** o diálogo S12 (o backend está pronto)
- **shell:** header (trocar de projeto, ações de branch); tool windows (arrastar entre lados, modo flutuante)

A lista completa, com should e could, está em `replica/diffs/parity-features.md`.

## Layout

| tela | referência do original | clone | score | vale? |
| --- | --- | --- | --- | --- |
| S03 janela principal | `screens/S03.png`, recorte da ilustração pública do tour da UI | `clone-screens/S03-estado-referencia.png` | **17,0 (different)** | **não** |

Por que o 17 não entra no veredito:
- **Não é um screenshot no mesmo estado.** A única imagem pública da janela inteira é uma ilustração de documentação.
  Ela tem 9 marcadores numerados e dois menus abertos (contexto e VCS Operations) cobrindo cerca de 30% do editor, e
  mostra um projeto Java com outro texto.
- **O que o clone imitou e o que não dá para imitar.** A captura do clone reproduz o que dava para reproduzir: mesmo
  tamanho de janela em 2x, tema claro, árvore recolhida e um `README.md` aberto, sem painel de baixo. O
  `imgdiff.py`, porém, compara arestas por célula de uma grade, e com conteúdo e sobreposições diferentes
  praticamente toda célula difere (`diffs/S03.png` está quase toda vermelha).
- **Como ter um número de verdade:** screenshots do GoLand no estado do clone, pela sua licença e só observando a UI.
  Salve em `replica/screens/` e rode `GOIDE_SHOTS=1 npx playwright test parity-shots` para refazer as capturas do clone.

Comparação estrutural manual, região por região, olhando as duas imagens lado a lado:

| região | original (ilustração) | clone | situação |
| --- | --- | --- | --- |
| Cabeçalho | projeto, branch, configuração de run, ▶, debug, ⋮, colaborar, busca, settings | menu, projeto, branch, configuração, ▶, ■, telas | mesma ordem e hierarquia. Faltam debug, busca e settings, que dependem de S06, S15 e S28 |
| Barra de ícones esquerda | em cima: projeto, commit, estrutura, bookmarks, ⋯; embaixo: terminal, problemas, git | em cima: projeto, commit; embaixo: run, debug, testes, problemas, terminal, busca, git | mesma posição e função. O clone põe mais janelas embaixo |
| Janela do projeto | ~30% da largura; raiz com caminho ao lado; External Libraries; Scratches | 32% da largura; raiz com caminho ao lado | igual. Faltam External Libraries e Scratches |
| Editor | aba ativa sublinhada, números de linha, gutter, barra à direita com o estado da análise | aba ativa sublinhada, números de linha, gutter com ▶ | igual. Falta o indicador de análise no canto |
| Barra à direita | notificações | cobertura, notificações | igual |
| Status bar | breadcrumbs, linha:coluna, LF, UTF-8, indentação, cadeado, erros | breadcrumbs, estado do gopls, erros e avisos, linha:coluna, LF, UTF-8, versão do Go, branch | mesma estrutura. Faltam o widget de indentação e o de somente leitura |

## Comportamento

Comparado pelo que a documentação pública do GoLand descreve (fontes em `recon.md`) e pelo que os testes e2e do
clone mostram.

| fluxo | original | clone | decisão |
| --- | --- | --- | --- |
| F08 rodar o main | ▶ no gutter abre um menu (Run / Debug / Coverage): 2 cliques | ▶ roda direto: 1 clique | **manter** (é melhor). Quando houver debug e coverage, o menu entra no clique direito |
| F03 salvar | autosave ao perder o foco e por ociosidade; Ctrl+S salva tudo | igual depois do BUG-001, mais gravação no unload e no fechamento da janela | manter |
| F03 formatar | ações ao salvar configuráveis (desligadas por padrão) | organize imports e gofmt sempre no Ctrl+S; o autosave não formata | manter. Ficar configurável quando existir o S28 |
| F01 projeto desconhecido | diálogo de projeto confiável da plataforma | diálogo "Confiar neste projeto?" e modo restrito | manter (paridade) |
| F03 arquivo mudou fora | recarrega sozinho se não houver edição local; se houver, pergunta | só detecta ao salvar (sem watcher) e pergunta | **corrigir**: falta o fsnotify (pendência do build log) |
| F07 rename | inline; preview e diálogo de conflitos | inline multi-arquivo; sem preview; motivo da recusa num aviso | **corrigir**: falta o preview (must parcial) |
| F04 usos (Alt+F7) | tool window Find, agrupada por leitura e escrita | peek do Monaco | **corrigir**: falta o S09 |
| F12 commit | tool window com changelists, partial commit e checks configuráveis | tool window; commit por arquivo; amend; hooks; salva antes | corrigir aos poucos (should) |
| F12 erro de hook | balão com o motivo e opção de commitar mesmo assim | aviso com o motivo; mensagem preservada | manter. "Commitar mesmo assim" é um could |
| Lembrar entre sessões | abas, layout, contexto por branch | abas e layout; configs de run (temporárias até 5) | manter. Contexto por branch é could |
| Saída enorme de um programa | console com ciclo de buffer | console com teto de 2 MB e aviso do que foi ocultado | manter |
| Push, branches, conflitos, testes, debug, terminal, busca | existem | não existem | **construir** (top 5 abaixo) |

Nenhuma correção do /replica-entrepreneur entrou ainda: ele não rodou.

## Top 5 para construir agora

Ordem por must-haves destravados e pelo uso diário de quem vem do GoLand:

1. **Debugger, com Delve via DAP (S15 e S17 básico):** 5 must-haves (breakpoints no gutter, debug de main e de teste,
   frames e variables, stepping, goroutines). Maior buraco e maior risco técnico: a arquitetura já pedia um spike.
2. **Test runner (S14 e o ▶ dos testes):** 4 must-haves (rodar pelo gutter, árvore com subtests, rerun failed,
   navegar para o código), sobre `go test -json`. Reaproveita o pipeline de run e o console.
3. **Git sync (S22, S23 e marcadores de mudança no gutter):** 4 must-haves (push, popup de branches, pull e update,
   gutter com rollback) e completa o "Commit e push" parcial.
4. **Busca (S06 Search Everywhere e S07 Find in Files):** 2 must-haves, e hoje o Shift duas vezes só mostra um aviso.
   O índice de arquivos e o `workspace/symbol` do hub já existem.
5. **Terminal (S19) e Settings (S28):** 2 must-haves pequenos. O S28 também destrava escolher o SDK, editar o keymap e
   ligar ou desligar as ações ao salvar.

Logo depois vêm conflitos e merge em 3 painéis (2 must-haves) e o preview do rename. Com os 5 itens acima, a conta
fica em torno de 30 de 43 must-haves.

## Próximo passo

`/replica-build` para o marco 2, nessa ordem. O `/replica-entrepreneur` só faz sentido depois que a paridade
existir: hoje o clone ainda não substitui o original nem para o próprio time.

## Arquivos

- `replica/parity.md`: este relatório
- `replica/diffs/parity-features.md`: saída completa do `parity.py --markdown`
- `replica/diffs/S03.png` e `replica/diffs/S03.json`: o diff de layout e o JSON dele, indicativo e fora do veredito
- `replica/screens/S03-original.png` e `S03.png`: a referência pública e o recorte da janela (só referência, nunca
  vão para o app)
- `replica/clone-screens/S03-estado-referencia.png`: o clone no estado da referência
- `frontend/e2e/parity-shots.spec.ts`: refaz as capturas (`GOIDE_SHOTS=1`)
