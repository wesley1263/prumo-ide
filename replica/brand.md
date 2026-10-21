# Marca: Prumo

Data: 2026-10-21. Posicionamento (não há `fixes.md`; tirado de `recon.md`): uma IDE para Go de uso pessoal e do
time, sem venda, montada só com peças abertas do ecossistema (gopls, Delve, `go test`, git CLI).

## Nome

**Prumo**: a linha de prumo do pedreiro, o instrumento que mostra se a parede está reta. Alinhamento e precisão,
que é o que uma IDE faz com o código. Palavra em português (o time fala português), curta, sem significado ruim em
inglês ou espanhol, fácil de dizer ("PRU-mo") e de soletrar depois de ouvir uma vez.

Fora de questão: qualquer coisa com "Go" no nome. As [diretrizes de marca do Go](https://go.dev/brand) tratam "Go"
como marca do Google e pedem para não sugerir ligação com o projeto; "Go-algo" também lembraria GoLand. O nome
provisório `goide` caiu pelo mesmo motivo.

### Candidatos

20 gerados: Codewright, Dovetail, Gantry (compostos/descritivos); Tessel, Kodel, Corvo (inventados); Burrow, Warren,
Keel, Lathe, Kiln, Quarry, Sextant, Trowel, Ferrule, Marten, Bramble, Tiller (metáforas); Plumb, Prumo (verbo/palavra).
Cortados para 5 pelos filtros (nada parecido com o original nem com "Go", curto, ligado ao posicionamento):
Prumo, Tessel, Burrow, Lathe, Dovetail.

### Checagens (triagem, não liberação jurídica)

| checagem | Prumo | Lathe | Tessel | Burrow | Dovetail |
| --- | --- | --- | --- | --- | --- |
| web: software do mesmo ramo | nenhum achado (2026-10-21) | nenhum achado (2026-10-21) | **placa de desenvolvimento Tessel 2** (descontinuada) | **Burrow, ferramenta Go do LinkedIn para Kafka** | **Dovetail, empresa de software (3.800+ clientes)** |
| domínio .com/.dev/.io/.app (DNS, 2026-10-21) | todos registrados | todos registrados | registrados | registrados | registrados |
| GitHub `<nome>` / `<nome>-ide` (API, 2026-10-21) | ocupado / **livre** | ocupado / livre | ocupado / livre | ocupado / livre | ocupado / livre |
| marca EUA (USPTO, classes 9 e 42) | a rodar | a rodar | — | — | — |
| marca UE (EUIPO / TMview) | a rodar | a rodar | — | — | — |
| marca Brasil (INPI) | a rodar | a rodar | — | — | — |
| global (WIPO Global Brand Database) | a rodar | a rodar | — | — | — |
| App Store / Play | não se aplica (app desktop) | não se aplica | — | — | — |
| redes (X, Instagram, TikTok) | a rodar | a rodar | — | — | — |

Tessel, Burrow e Dovetail saíram pela busca na web (mesma categoria). Escolhido: **Prumo** (pelo usuário).
As buscas de marca nos escritórios (USPTO, EUIPO, INPI, WIPO) não foram feitas aqui: precisam ser rodadas, e antes de
gastar dinheiro com o nome (registro, domínio comprado de terceiro) um advogado de marcas deve fazer a busca de verdade.
Domínios: os curtos estão ocupados; se for preciso um site, `prumo-ide.dev` ou `getprumo.dev` (a checar).

## Paleta

Cor primária: **verde-lima/oliva** (h≈80), a cor da bolha do nível, o instrumento que anda junto com o prumo.

- Fora da família do original e do ecossistema: o teal anterior (`#2a7881`, texto `#5ec5d0`) estava na família do
  "Gopher Blue" `#00ADD8` / "Light Blue" `#5DC9E2` da marca do Go, e a JetBrains usa azuis e violetas.
- Fora das cores de estado: âmbar é aviso (e funções no realce de sintaxe), vermelho é erro, verde é sucesso,
  violeta é palavra-chave. O primário não podia ser nenhuma delas.

| papel | escuro | claro |
| --- | --- | --- |
| accent (botão, item ativo) | `#9cbf3b` | `#4e6b0c` |
| accent-hover | `#b0d24f` | `#41590a` |
| accent-text (links, destaques) | `#b9d86a` | `#4a650b` |
| on-accent (texto sobre o accent) | `#151a06` | `#ffffff` |
| focus | `#b9d86a` | `#4e6b0c` |
| selection | `#33391f` | `#e3edc8` |

O resto (fundos, textos, estados, sintaxe, ANSI) ficou como estava: é funcional, não é marca.
`contrast.py`: 161 pares, **0 falhas AA**. As cores do Go e o accent da UI da JetBrains (`#3574F0`) estão em
`brand.json` para a varredura pegar se voltarem. As cores do logo do GoLand não foram confirmadas em fonte confiável e
não entraram (não adivinhar).

## Briefing do logo

- **Ideia:** um prumo (o peso pontudo pendurado num fio), reto, apontando para baixo: "o código no lugar".
- **Tipo:** símbolo + wordmark ("Prumo", em Inter Semibold ou parecida); o símbolo sozinho vira o ícone.
- **Forma:** o peso como um losango alongado ou gota invertida, o fio como uma linha fina saindo do topo. Pode
  sugerir uma chave `}` ou um cursor de texto, sem virar letra.
- **Cor:** o accent `#9cbf3b` sobre fundo escuro `#1d1e21`; versão de uma cor para fundo claro com `#4e6b0c`.
- **Precisa funcionar:** em 16 px (favicon: só o peso, sem fio) e como ícone de 1024 px.
- **Entregáveis:** SVG do símbolo e do wordmark; ícone 1024×1024 PNG sem transparência (`build/appicon.png` do
  Wails, de onde ele gera os ícones de Linux, macOS e Windows); favicon (SVG + 32 px); imagem social 1200×630.
- **Não pode lembrar o original:** nada do quadrado preto com sigla de duas letras e faixa de gradiente dos produtos
  JetBrains, nada do gopher nem do "GO" inclinado do Go. Colocar os rascunhos ao lado desses logos e conferir.
- **Versão provisória feita (2026-10-21):** `assets/brand/prumo-icon.svg` (ícone, 1024), `prumo-mark.svg` (símbolo sem
  fundo), `prumo-favicon.svg` (só o peso, para 16–32 px) e os PNGs 1024/256 gerados deles com o Chrome headless.
  Ligados em `build/appicon.png` (Wails), no ícone da janela (Linux) e do "Sobre" (macOS), no favicon, nos ícones e
  no atalho de menu que o `install.sh` instala, e no README. Conferidos em 256, 128, 48, 32 e 16 px. Sem wordmark
  em curvas (o "Prumo" ao lado do símbolo é texto); um designer pode refinar a partir deste briefing.

## Voz

Três palavras:
- **Direta**, não seca: diz o que aconteceu e o que fazer, sem rodeio e sem frieza.
- **Precisa**, não pedante: o termo certo (commit, breakpoint, gopls) sem explicar o óbvio.
- **Calma**, não fria: erro é informação, não alarme; nada de ponto de exclamação nem de "Ops!".

| faça | não faça |
| --- | --- |
| "Não foi possível abrir" + o motivo que veio do backend | "Algo deu errado" |
| "Nada para commitar. Tudo igual ao último commit em main." | "Parabéns, está tudo em dia! 🎉" |
| "O kernel não deixa anexar… Libere com: …" (o próximo passo) | só "Permissão negada" |
| verbos no infinitivo nos botões: "Abrir", "Clonar", "Commitar" | "Clique aqui para abrir" |
| "Confiar neste projeto?" e explicar o que muda | "Tem certeza???" |

Os 10 textos mais vistos, revisados na voz:

| onde | texto | decisão |
| --- | --- | --- |
| tela inicial, subtítulo | "IDE para Go feita de peças abertas · em desenvolvimento" | **reescrito** (era "IDE para Go · versão de desenvolvimento", genérico) |
| tela inicial, vazio | "Nenhum projeto ainda" / "Abra uma pasta com um módulo Go para começar." | mantido |
| botões principais | "Novo projeto", "Abrir", "Clonar" | mantido |
| confiança | "Confiar neste projeto?" | mantido |
| Commit, vazio | "Nada para commitar" / "Tudo igual ao último commit em {branch}." | mantido |
| Commit, confirmação | "Commit {hash} criado" | mantido |
| erro genérico | "Não foi possível abrir" + motivo | mantido |
| barra de status | "gopls pronto" | mantido |
| Testes, vazio | "Nenhum teste rodou ainda" + como rodar | mantido |
| Configurações | "Configurações salvas" | mantido |

Nenhum deles ecoa frases do GoLand (foram escritos para o clone desde o começo, em português).

## Varredura

`python3 .claude/skills/replica-brand/sweep.py . --config replica/brand.json`: **limpa** (2026-10-21).
- Trocado `goide` → `prumo` em 116 arquivos (módulo Go, classes CSS, eventos, variáveis de ambiente, pastas de
  dados). Título da janela, tela inicial, `<title>` e `wails.json` dizem "Prumo".
- 12 comentários "como no GoLand" reescritos sem citar o original.
- Migração: na primeira execução, `~/.config/goide` e `~/.cache/goide` viram `~/.config/prumo` e `~/.cache/prumo`
  (configurações, recentes e breakpoints ficam); `.goide/run/` dos projetos continua sendo lida (está no git do
  usuário, não é renomeada sozinha); as gravações vão para `.prumo/run/`.
- `replica/` (planejamento) fica fora da varredura e mantém o nome antigo como histórico.

## Pendências

1. **Repositório:** o GitHub e a pasta local se chamam `replica-goland`. Renomear para `prumo` (Settings →
   Repository name no GitHub; ele redireciona o endereço antigo) é decisão do dono do repositório.
2. **Logo:** a versão provisória está em `assets/brand/`; refinar com um designer se for divulgar mais.
3. **Marcas:** rodar as buscas marcadas "a rodar" e, antes de gastar com o nome, falar com um advogado de marcas.
