# Componentes: especificação

Fonte: lista de componentes de `replica/recon.md`. Medidas tiradas do tema Int UI (open source) e da documentação
pública. Os valores vêm de `tokens.json`. Nenhum componente usa hex solto: só classes do preset
(`bg-surface`, `text-muted`, `h-control`, `rounded-md`...).

## Regras gerais

- **Densidade de IDE.** Texto de UI 13px, linhas de 24px, controles de 28px. Nada de tamanhos de app web (40px).
- **Ícones:** [Lucide](https://lucide.dev) (ISC) em 16px, stroke 1.5, cor `currentColor`. Ícones de arquivo e de
  linguagem: conjunto próprio ou [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme)
  (MIT). Nunca os ícones da New UI da JetBrains, nem traçados a partir deles.
- **Fontes:** Inter na UI e IBM Plex Mono no editor (ambas OFL). JetBrains Mono fica de fora porque carrega a marca.
- **Textos:** todo rótulo, tooltip e empty state escrito do zero, em pt-BR com termos técnicos em inglês quando forem
  o vocabulário do Go/Git (commit, branch, breakpoint).
- **Foco:** `:focus-visible` com anel de 2px `focus`. Toda ação tem atalho e aparece no Command Palette (S06). O
  mouse é opcional.
- **Atalhos:** keymap próprio inspirado em convenções comuns de IDEs. Combinações de tecla não são protegidas, mas o
  keymap padrão é um arquivo do clone, editável em S28.
- **Movimento:** `fast` (90ms) para hover, press e popups, `base` (160ms) para painéis. `prefers-reduced-motion`
  zera tudo.
- **Temas:** escuro (padrão) e claro via `data-theme`. Todo componente é conferido nos dois.

---

## Shell

```
AppShell
  layout     grid: header (h-header) / [stripe-left | tool windows esquerda | centro | tool windows direita | stripe-right] / status bar (h-status-bar)
             centro = editor area em cima + tool windows de baixo, separados por Splitter
  tokens     bg chrome (header, stripes, status bar), bg surface (tool windows), bg bg (editor)
  states     sem projeto (vai para S01), indexando (progresso na status bar), pronto, tela cheia
  a11y       landmarks: header=banner, editor=main, tool windows=complementary com aria-label, status bar=contentinfo
             F6 alterna o foco entre regiões
  used on    S03
```

```
HeaderBar
  parts      [menu (Linux/Windows)] [ProjectWidget] [VcsWidget] ····· [RunWidget] [busca] [settings] [controles da janela]
  size       h-header (40), widgets h-control (28), padding x 2
  tokens     bg chrome, text text, hover bg hover, pressed bg pressed, radius md
  states     idle, hover, aberto (popup), rodando (RunWidget mostra stop e o nome da config em accent-text)
  a11y       role=toolbar, setas movem o foco entre widgets, cada widget é um <button aria-haspopup>
  used on    S03
```

```
ProjectWidget / VcsWidget / RunWidget  (dropdown do header)
  variants   project (nome), vcs (ícone git-branch + nome da branch + setas de incoming/outgoing), run (config + run, debug, stop, more)
  size       h-control, max-width 350px com ellipsis no meio para branches longas
  states     default, hover, pressed, aberto, desabilitado (sem git / sem configs), rodando
  tokens     text text, ícone text-muted, rodando: ícone success; erro de config: ícone danger
  a11y       aria-label com o valor atual ("Branch: main"), Enter/Espaço abre, Esc fecha
  used on    S03, S23 (VcsWidget abre), S12 (RunWidget → Edit Configurations)
```

```
ToolWindowStripe
  layout     coluna de w-stripe (40), botões de ícone 28x28 com gap 1; grupo de cima = tool windows laterais, grupo de baixo = tool windows inferiores; separador border
  states     inativo (text-muted), hover (bg hover), ativo (bg accent + on-accent), com badge (ponto danger/warning), arrastando (alvo com bg selection e borda focus)
  a11y       role=toolbar aria-orientation=vertical, cada botão é toggle (aria-pressed) com tooltip "Nome (Alt+N)"
  used on    S03
```

```
ToolWindow
  variants   dock-left, dock-right, dock-bottom, float, window; com abas (Run, Debug, Find) ou sem
  parts      header (h-toolwindow-header 36: título md/600 ou abas, ações à direita: ⋮ opções, — minimizar), conteúdo, Splitter de redimensionamento
  size       lateral default 280 (min 160), inferior default 260 (min 100)
  tokens     bg surface, header text text, ações text-muted → hover bg hover, borda border do lado do editor
  states     aberto, focado (título em text, faixa superior de 2px accent), sem foco (título text-muted), minimizado, redimensionando, vazio (EmptyState)
  a11y       role=region aria-label; Esc devolve o foco ao editor; Shift+Esc fecha; atalho Alt+N abre e foca
  used on    S05, S09, S10, S13, S14, S15, S18, S19, S20, S24
```

```
Splitter
  size       1px visível (border), 6px de área de arraste
  states     default, hover (border-strong), arrastando (focus), foco por teclado (setas redimensionam 16px)
  a11y       role=separator aria-orientation aria-valuenow (px), duplo clique restaura o tamanho padrão
  used on    S03, S21, S26
```

```
StatusBar
  parts      esquerda: breadcrumbs do arquivo ou mensagem; centro: ProgressIndicator; direita: widgets (linha:coluna, line ending, encoding, indent, branch, aviso do gopls)
  size       h-status-bar (28), texto xs, widgets com padding x 1.5
  tokens     bg chrome, text text-muted, hover text text + bg hover, borda superior border
  states     idle, progresso (indeterminado ou %), mensagem temporária, erro (ícone danger)
  a11y       role=status (aria-live=polite só para progresso e mensagens), widgets são <button> com aria-label
  used on    S03
```

## Editor

```
EditorTabs
  variants   normal, preview (título em itálico, substituída ao abrir outra), pinada (ícone de pin), modificada (ponto), com erro (título sublinhado danger), status VCS (cor do título vcs-*)
  size       h-editor-tab (36), padding x 3, ícone 16 + título sm + botão fechar 16 (visível no hover e na ativa)
  tokens     bg bg; ativa: text text e sublinhado de 3px accent; inativa: text text-muted; hover bg hover
  states     ativa, inativa, hover, arrastando, overflow (menu de abas ocultas à direita)
  a11y       role=tablist/tab, aria-selected, Ctrl+Tab = switcher, Ctrl+F4 fecha, botão do meio fecha, menu de contexto (fechar outras/à direita/pinar/split)
  used on    S04
```

```
CodeEditor
  base       um motor de editor embarcável (decisão do /replica-architect: Monaco ou CodeMirror 6); estilização só por tokens
  parts      Gutter, área de texto, inlay hints, sublinhados de diagnóstico, highlight da linha atual, scrollbar com marcas (erros, warnings, busca, mudanças VCS), Breadcrumbs embaixo
  type       code (13/20) mono; configurável em S28 (fonte, tamanho, ligaduras)
  tokens     bg bg; seleção selection (sem foco: selection-inactive); linha atual bg hover a 50%; match de busca search-match-bg; linha de execução no debug execution-line-bg
             sintaxe: syntax-keyword, -type, -function, -string, -number, -comment (itálico), -param, -field, -constant
             diagnóstico: onda danger (erro), warning (aviso), sublinhado pontilhado text-subtle (código não usado em text-subtle)
  states     vazio, read-only (cadeado na aba + banner), carregando arquivo grande, gopls indisponível (banner warning), modo diff, modo debug
  a11y       modo leitor de tela do motor ligado por padrão em S28; Alt+F1 anuncia diagnósticos da linha
  used on    S04, S08 (mini-editor), S16, S21, S26
```

```
Gutter
  columns    [breakpoints e ícones de run/teste] [números de linha] [marcadores VCS] [folding]; coverage pinta o marcador VCS na mesma coluna
  size       min 48px, ícones 14px, número em xs mono text-subtle (linha atual text-muted)
  marks      breakpoint: círculo cheio breakpoint; condicional: com "?" ; desabilitado: anel vazio; mutado: text-subtle; inválido: com "x"
             run/teste: triângulo success; teste falhou: ícone danger; teste passou: check success
             VCS: barra 3px vcs-added / vcs-modified / triângulo vcs-deleted
             coverage: barra 3px coverage-full / -partial / -none
  states     hover numa linha (sombra do breakpoint em text-subtle), clique alterna breakpoint, clique direito abre menu (breakpoint properties, annotate, run)
  a11y       ações do gutter também por teclado: Ctrl+F8 breakpoint, Ctrl+Shift+F10 run; ícones com aria-label no menu
  used on    S04, S18, S21, S27
```

```
CompletionPopup
  layout     lista com ícone de tipo de símbolo + nome (match em negrito accent-text) + assinatura text-muted + tipo à direita; painel de doc opcional à direita
  size       linhas h-row, largura 360–560, máx. 12 itens visíveis
  tokens     bg surface-raised, borda border, shadow pop, item ativo bg selection, radius md
  states     carregando (spinner no rodapé após 300ms), lista, vazio ("Nenhuma sugestão"), com doc, desatualizado (aplica filtro local enquanto o gopls responde)
  a11y       role=listbox aria-activedescendant ligado ao editor (combobox); setas, Enter/Tab aceitam, Esc fecha
  used on    S04, S16
```

```
IntentionPopup  (Alt+Enter / lâmpada)
  variants   quick-fix (ícone de lâmpada danger), intention (lâmpada warning), refactor
  parts      lista de ações, submenu (→) com opções, preview da mudança à direita
  tokens     igual CompletionPopup
  states     lista, aplicando (spinner), falhou (toast danger), sem ações (não abre; dica na status bar)
  a11y       listbox; digitar filtra; Enter aplica
  used on    S04, S10
```

```
InlayHint
  tokens     text xs mono, text text-subtle, bg hover, radius xs, padding x 1
  a11y       ignorado pelo leitor de tela (aria-hidden), mas disponível em Quick Documentation
  used on    S04
```

```
Breadcrumbs
  layout     pacote › arquivo › tipo › função, separados por chevron 12px
  tokens     text xs text-muted, hover text text + bg hover
  a11y       nav aria-label="Localização no código", cada item é link
  used on    S04, S03 (status bar)
```

```
InlineRename
  layout     caixa no lugar do identificador, borda 1px focus, todas as ocorrências no arquivo com bg selection
  states     editando, nome inválido (borda danger + tooltip), conflito (abre diálogo S11), aplicando
  a11y       anuncia "Renomeando X, N ocorrências"; Enter confirma, Esc cancela
  used on    S04, S11
```

## Busca e popups

```
SearchPopup  (Search Everywhere / Go to)
  layout     topo com campo de busca + abas (Tudo, Arquivos, Símbolos, Ações, Texto) + filtro; lista agrupada por categoria; rodapé com dica e "Abrir na janela de busca"
  size       largura 670, altura máx. 480, centralizado a 15% do topo; itens h-row; campo h-control-lg
  tokens     bg surface-raised, shadow pop, radius lg, aba ativa bg selection, item ativo bg selection, caminho do item text-muted, match em text + negrito
  states     vazio (lista de recentes), digitando (resultados progressivos), carregando por categoria, sem resultados (texto + link para Find in Files), fora do projeto incluído (chip)
  a11y       role=dialog aria-modal=false com combobox + listbox; Tab troca de aba; Ctrl+↑/↓ pula grupos; Esc fecha e devolve o foco
  used on    S06
```

```
FindPanel  (Find/Replace in Files)
  layout     campo de busca (opções Aa, W, .* como toggles) + campo replace opcional + escopo (segmented: Projeto, Módulo, Diretório, Escopo) + máscara de arquivo; lista de resultados; preview em editor read-only embaixo
  size       dialog-lg, redimensionável
  states     vazio, buscando (contador ao vivo), resultados, limite atingido (aviso), regex inválido (borda danger + mensagem), substituindo (confirmação com contagem)
  a11y       toggles com aria-pressed e atalho (Alt+C, Alt+W, Alt+X); resultados em tree; Enter abre no editor
  used on    S07
```

```
QuickPopup  (Quick Documentation, Quick Definition, Show Usages, File Structure, Parameter Info)
  variants   doc (markdown renderizado), definição (mini-editor read-only), usos (lista com filtro), estrutura (tree com speed search), parameter info (tooltip com parâmetro atual em negrito)
  size       largura 400–640, altura máx. 400
  tokens     bg surface-raised, borda border, shadow pop, radius md; código em mono
  states     carregando, conteúdo, vazio ("Sem documentação"), um resultado (pula o popup e navega)
  a11y       role=dialog não modal; Esc fecha; foco volta ao editor; doc pode ser fixada como tool window
  used on    S08
```

```
Tooltip
  tokens     bg surface-raised, text text xs, borda border, radius sm, padding 1.5 2, shadow pop; atalho em text-muted mono
  behavior   aparece após 600ms, some ao sair, nunca contém a única forma de acessar uma ação
  variants   neutro, erro (bg danger-bg, borda danger), aviso (warning-bg)
  a11y       aria-describedby; também aparece no foco por teclado
  used on    todas
```

## Listas, árvores e tabelas

```
TreeView
  size       linhas h-row (24), indentação 16 por nível, inset 4 12, chevron 12, ícone 16, gap 1.5
  tokens     texto text sm; secundário (caminho, contagem) text-muted; selecionado com foco bg selection; sem foco bg selection-inactive; hover bg hover
             cor do nome pelo status VCS: vcs-added, vcs-modified, vcs-unversioned, vcs-ignored
  states     expandido, colapsado, carregando filhos (spinner no lugar do chevron), vazio (EmptyState), speed search (digitar filtra e destaca o match com search-match-bg), arrastando, renomeando inline
  a11y       role=tree/treeitem com aria-level/aria-expanded/aria-selected; setas navegam, → expande, ← colapsa, Home/End, * expande tudo; multi-seleção com Shift/Ctrl
  used on    S05, S09, S12, S14, S15, S17, S20, S24, S28
```

```
ListView
  size       h-row; variante "rica" de duas linhas (h 40) para commits e projetos recentes
  states     igual TreeView, sem hierarquia
  a11y       role=listbox ou grid quando há colunas
  used on    S01, S06, S22, S25, S30
```

```
CommitGraph
  layout     coluna do grafo (linhas de 2px, nós de 8px) + mensagem + labels de refs + autor (text-muted) + data (text-muted, alinhada à direita)
  tokens     8 cores de lanes derivadas dos tokens (accent-text, success, warning, danger, vcs-modified, syntax-keyword, syntax-type, syntax-param)
             labels: HEAD bg warning-bg/text warning, local bg success-bg/text success, remota bg selection/text accent-text
  states     carregando mais (paginação), filtrado (lanes ocultas em text-subtle), selecionado
  a11y       role=grid; o grafo é decorativo (aria-hidden); a linha anuncia "mensagem, autor, data, refs"
  used on    S24
```

```
Badge / Tag
  variants   neutral (bg hover, text text-muted), info (selection/accent-text), success, warning, danger (bg *-bg, texto *)
  size       h 18, padding x 1.5, text 2xs/600, radius xs
  used on    S14 (contagens), S20, S24 (refs), S03 (stripe)
```

## Run, testes e debug

```
Console
  type       code (13/20) mono; links arquivo:linha sublinhados em accent-text; stderr em danger; mensagens do sistema em text-muted itálico
  parts      toolbar vertical à esquerda (rerun, stop, pin, soft-wrap, scroll to end, limpar), área de saída, campo de stdin quando o processo lê a entrada
  tokens     bg bg, cores ANSI mapeadas para tokens (vermelho=danger, verde=success, amarelo=warning, azul=vcs-modified, magenta=syntax-keyword, ciano=accent-text)
  states     rodando, terminado (linha final "Processo terminou com código N", em success ou danger), aguardando stdin, buffer cortado (aviso no topo)
  a11y       role=log aria-live=off (anúncio só ao terminar); busca com Ctrl+F
  used on    S13, S14, S15
```

```
TestTree
  layout     TreeView com ícone de status + nome + duração (text-muted, à direita); barra de progresso fina (2px) no topo; filtros (passou, ignorado) e contagem "N de M"
  status     passou: check success; falhou: x danger; panic: ícone danger com raio; ignorado: text-subtle; rodando: spinner accent-text; não iniciou: círculo vazio
  states     rodando, tudo verde (barra success), falhas (barra danger, seleciona a primeira falha), sem testes (EmptyState), cancelado
  a11y       anuncia o resumo ao terminar (aria-live=polite): "12 passaram, 2 falharam"
  used on    S14
```

```
DebugPanel
  layout     toolbar de stepping no topo (resume, pause, stop, step over/into/out, run to cursor, evaluate, mute, breakpoints) + 3 colunas redimensionáveis: Frames (com seletor de goroutine em cima) | Variables | Watches; aba Console
  tokens     frame atual bg selection; frames de libs em text-muted; variável alterada no último step em vcs-modified; valores: strings syntax-string, números syntax-number, nil syntax-keyword
  states     rodando (botões de stepping desabilitados), pausado, pausado em panic (banner danger), terminado, desconectado (banner warning + reconectar)
  a11y       todas as ações com atalho (F7, F8, Shift+F8, F9, Alt+F9, Alt+F8); Variables é tree acessível; anúncio "Pausado em arquivo.go:42"
  used on    S15, S16
```

```
GoroutineSelector
  layout     combobox com busca: "#ID função (estado)", agrupado por estado (rodando, aguardando, bloqueado); toggle "esconder goroutines do runtime"
  states     muitas goroutines (virtualização), filtrando, goroutine atual marcada
  used on    S15
```

```
CoverageBar
  layout     barra 48x6 com preenchimento coverage-full + % em text xs
  used on    S18, S05
```

## Git

```
ChangesTree
  layout     TreeView com checkbox por arquivo e por grupo (lista de mudanças), ícone de status, nome na cor vcs-*, caminho em text-muted; grupos: Mudanças, Não versionados, Conflitos (bg diff-conflict-bg no grupo)
  states     sem mudanças (EmptyState), mudanças, conflito, staged (checkbox marcado), parcial (checkbox indeterminado)
  a11y       checkbox com aria-checked mixed para parcial; Espaço marca; Ctrl+D abre diff
  used on    S20
```

```
CommitBox
  parts      TextArea da mensagem (com contador do assunto: aviso em warning acima de 72), histórico de mensagens, checkbox Amend, engrenagem (opções), botões Commit (primary) e Commit and Push (secondary)
  states     vazio (Commit desabilitado, dica), válido, rodando checks (progresso inline e lista de checks), check falhou (painel danger-bg com "Revisar" e "Commitar mesmo assim"), commitando
  a11y       Ctrl+Enter commita; erros com aria-live=assertive
  used on    S20
```

```
DiffView
  variants   lado a lado (2 painéis), unificado, 3 painéis (merge)
  tokens     linha adicionada diff-added-bg, modificada diff-modified-bg, removida diff-deleted-bg, conflito diff-conflict-bg; highlight por palavra = mesma cor com fundo mais forte (borda 1px vcs-*); separador central com conectores curvos
  parts      toolbar (anterior/próxima diferença F7/Shift+F7, modo, ignorar espaços, highlight palavra/linha/nenhum), setas >> / << para aplicar chunk, checkbox por chunk (commit parcial)
  states     sem diferenças (EmptyState), binário ("Arquivos binários diferem"), arquivo novo ou removido, muito grande (aviso + "carregar mesmo assim")
  a11y       navegação por diferença anuncia "Mudança 3 de 7, 4 linhas adicionadas"; setas de aplicar são botões com rótulo
  used on    S21, S26
```

```
MergeView
  layout     3 painéis: local (read-only) | resultado (editável) | incoming (read-only); cabeçalhos com nome da branch; barra com contagem "N conflitos restantes" e "Aplicar mudanças sem conflito"
  states     conflitos restantes, resolvido (botão Concluir vira primary), resolução simples disponível (ícone de varinha em accent-text)
  used on    S26
```

```
BranchPopup
  layout     campo de busca, ações rápidas no topo (Atualizar, Commit, Push, Nova branch), grupos colapsáveis (Favoritas, Recentes, Locais, Remotas, Tags), cada branch com estrela e indicadores ↑N ↓N
  states     busca vazia, filtrando, branch atual (ícone de tag em accent-text), submenu de ações da branch (→)
  a11y       tree com busca; → abre submenu
  used on    S23
```

```
BlameColumn
  layout     coluna no gutter com autor abreviado + data relativa, cor de fundo por idade (de selection a transparente)
  states     hover mostra popup do commit, clique abre o commit em S24
  used on    S27
```

## Formulários e diálogos

```
Button
  variants   primary (bg accent, text on-accent), secondary (bg transparente, borda border-input, text text), ghost (sem borda, hover bg hover), danger (bg danger-bg, text danger, borda danger)
  sizes      sm h-control-sm, md h-control (padrão), lg h-control-lg; min-width 72; padding x 3.5
  states     default, hover (primary: accent-hover; outros: bg hover), active (bg pressed), focus-visible (anel 2px focus com offset 1), disabled (text text-subtle, sem fundo, cursor default), loading (spinner no lugar do ícone, label mantido)
  tokens     radius md, text sm/500
  a11y       <button> real; o botão default do diálogo responde a Enter; loading com aria-busy
  used on    todos os diálogos
```

```
IconButton
  size       icon-button 28 (sm 24), ícone 16
  states     default (text-muted), hover (bg hover, text text), pressed (bg pressed), toggled (bg selection, text accent-text), disabled (text-subtle), focus-visible
  a11y       aria-label obrigatório + tooltip com atalho; toggles com aria-pressed
  used on    toolbars de todas as tool windows
```

```
TextField / TextArea / SearchField
  size       h-control, padding x 2, radius md, text sm
  tokens     bg bg (dentro de surface), borda border-input, placeholder text-muted, foco: borda focus + anel 2px focus
  states     default, hover (borda text-muted), foco, erro (borda danger + mensagem xs danger embaixo ou ValidationTooltip), aviso (borda warning), desabilitado (bg surface, text text-subtle), read-only
  variants   search (ícone de lupa, botão limpar, histórico ↓), path (botão de pasta que abre o seletor nativo), env vars (botão que abre editor em tabela)
  a11y       <label> sempre visível, erro com aria-invalid + aria-describedby
  used on    S02, S06, S07, S12, S17, S22, S28, S29
```

```
Select / Combobox
  size       h-control, área da seta 28
  states     igual TextField + aberto
  a11y       nativo quando possível; custom segue o padrão combobox ARIA
  used on    S02, S12, S17, S28
```

```
Checkbox / Radio / Switch
  size       caixa 16, radius xs (checkbox), label sm com gap 2
  tokens     desmarcado: borda border-input; marcado: bg accent + check on-accent; indeterminado: traço on-accent
  states     default, hover, foco, marcado, indeterminado, desabilitado
  used on    S12, S17, S20, S22, S28
```

```
SegmentedControl
  size       h-control-sm, opção ativa bg surface-raised + shadow pop (leve)
  used on    S07 (escopo), S21 (modo de diff)
```

```
Dialog
  sizes      sm 440, md 640, lg 900; redimensionável quando há listas
  parts      título (md/600) + conteúdo com padding 4 + rodapé com botões alinhados à direita (secundário, primário); ajuda (?) à esquerda do rodapé
  tokens     bg surface, radius lg, shadow dialog, overlay rgba(0,0,0,.35) só nos modais
  states     aberto, validando, inválido (primário desabilitado + mensagem), carregando, erro (Banner danger no topo)
  a11y       role=dialog aria-modal; foco preso; Esc cancela; foco inicial no primeiro campo; devolve o foco ao fechar
  used on    S02, S11, S12, S16, S17, S22, S25, S29
```

```
SettingsLayout
  layout     busca no topo da navegação (w settings-nav-width 240) + tree de categorias; painel à direita com título, seções e campos em grid label|controle; rodapé Cancelar / Aplicar / OK
  states     sem mudanças (Aplicar desabilitado), modificado (item da tree em accent-text com ponto), busca destacando campos, sem resultados
  used on    S28
```

```
Banner  (faixa no topo de um editor ou painel)
  variants   info (bg selection), warning (warning-bg + ícone warning), danger (danger-bg + ícone danger), success
  parts      ícone + texto sm + até 2 links de ação + fechar
  a11y       role=status (info) ou alert (danger)
  used on    S04 (gopls indisponível, read-only), S15, S20
```

```
Toast / NotificationBalloon
  layout     canto inferior direito acima da status bar, largura 360, empilha até 3
  parts      ícone de tipo + título sm/600 + corpo sm + ações (links) + fechar
  tokens     bg surface-raised, borda border, shadow toast, radius lg
  states     entrando, visível, expirando (info 8s; erro fica até fechar), movido para o histórico
  a11y       role=status (info) ou alert (erro); não rouba o foco; Alt+N... atalho para focar o último
  used on    S30
```

```
ProgressIndicator
  variants   barra determinada (h 4, bg hover, preenchimento accent), indeterminada (faixa animada), spinner 16 (anel accent-text)
  a11y       role=progressbar com aria-valuenow quando determinado; spinner só aparece após 300ms
  used on    S03, S13, S14, S29
```

```
EmptyState
  layout     centralizado no painel: título sm/600 text, texto xs text-muted, até 2 links de ação com atalho
  rule       todo painel tem um; textos escritos do zero
  used on    S05, S09, S10, S14, S18, S20, S21, S24
```

```
ContextMenu / Menu
  size       itens h-row, padding x 3, largura min 200; atalho à direita em text-muted mono xs; separador border
  tokens     bg surface-raised, shadow pop, radius md, item ativo bg selection
  states     item desabilitado (text-subtle), submenu (chevron), checkable (check à esquerda)
  a11y       role=menu/menuitem; setas, Enter, Esc; letra digitada pula para o item
  used on    todas
```

```
WelcomeLayout
  layout     coluna esquerda 240 (projetos, personalizar, plugins não) + painel com busca e ListView de projetos recentes (nome sm/600 + caminho xs text-muted + branch); botões Novo, Abrir, Clonar no topo
  states     sem recentes (EmptyState com os 3 botões grandes), com recentes, caminho inexistente (nome em text-subtle + "Remover da lista")
  used on    S01
```

## Ordem sugerida para construir as primitivas (/design)

1. Tokens + tema (dark/light switch), tipografia, ícones
2. Button, IconButton, TextField, Select, Checkbox, Tooltip, Menu
3. TreeView, ListView, Splitter, ToolWindow, ToolWindowStripe, StatusBar, HeaderBar
4. Dialog, Banner, Toast, ProgressIndicator, EmptyState
5. EditorTabs, CodeEditor tematizado (sintaxe + gutter), CompletionPopup, SearchPopup
6. Console, TestTree, DebugPanel, DiffView, ChangesTree, CommitBox, BranchPopup, CommitGraph, MergeView
