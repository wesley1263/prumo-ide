// Traduções para o inglês da parte "editor" (veja src/i18n/en.ts). Chave: a frase em português, exatamente como no t().
export const editor: Record<string, string> = {
  // EditorArea
  'Arquivos abertos': 'Open files',
  ', não salvo': ', unsaved',
  'não salvo': 'unsaved',
  'Diff: {path}': 'Diff: {path}',
  'Diff: {path} entre a branch atual e {branch}': 'Diff: {path} between the current branch and {branch}',
  'Diff: {path} no commit {hash}': 'Diff: {path} in commit {hash}',
  'Fechar {name}': 'Close {name}',
  'Dividir à direita': 'Split Right',
  'Janela do projeto': 'Project window',
  Commit: 'Commit',
  'Rodar configuração': 'Run configuration',
  'Salvar tudo': 'Save All',
  'Anotar com git blame (liga/desliga)': 'Annotate with git blame (toggle)',
  'Histórico do arquivo (git)': 'File history (git)',
  'Rodar {name}': "Run '{name}'",
  'Rodar os testes do pacote': 'Run package tests',
  'Rodar este programa': 'Run this program',
  ' · botão direito para depurar': ' · right-click to debug',
  'O gopls não respondeu.': 'gopls did not respond.',
  'Confiar no projeto': 'Trust project',
  'Modo restrito: análise de código, execução e commit estão desligados para este projeto.':
    'Restricted mode: code analysis, running and committing are disabled for this project.',
  'Análise de código indisponível: {problem}': 'Code analysis unavailable: {problem}',
  'Arquivo binário: não dá para mostrar o conteúdo.': 'Binary file: the content cannot be shown.',
  'Arquivo grande demais para o editor (mais de 5 MB).': 'File too large for the editor (over 5 MB).',
  'Arquivo de fora do projeto, aberto só para leitura.': 'File outside the project, opened read-only.',
  'Rodar ou depurar': 'Run or debug',
  Rodar: 'Run',
  'Depurar {name}': "Debug '{name}'",
  'Depurar os testes do pacote': 'Debug package tests',
  Depurar: 'Debug',
  'Rodar {name} com cobertura': 'Run {name} with coverage',
  'Rodar os testes do pacote com cobertura': 'Run package tests with coverage',
  'Trecho alterado': 'Changed hunk',
  'Remover a linha adicionada': 'Remove the added line',
  'Remover as {n} linhas adicionadas': 'Remove the {n} added lines',
  'Restaurar as linhas apagadas': 'Restore the deleted lines',
  'Reverter este trecho': 'Revert this hunk',
  'Ver o diff do arquivo': 'Show file diff',
  'Carregando…': 'Loading…',
  'Visualizar markdown': 'Preview markdown',
  'Editar markdown': 'Edit markdown',

  // DiffView
  adicionado: 'added',
  apagado: 'deleted',
  modificado: 'modified',
  'Arquivos binários diferem.': 'Binary files differ.',
  'Próxima diferença': 'Next difference',
  'Diferença anterior': 'Previous difference',
  binário: 'binary',
  'Sem diferenças': 'No differences',
  '{i} de {n} · {kind}': '{i} of {n} · {kind}',
  'Reverter trecho': 'Revert hunk',
  'Abrir no editor': 'Open in Editor',
  'Modo do diff': 'Diff mode',
  'Lado a lado': 'Side by side',
  Unificado: 'Unified',
  'Não foi possível ler o diff: {error}': 'Could not read the diff: {error}',

  // Generate
  Gerar: 'Generate',
  'Implementar interface em {name}…': 'Implement interface in {name}…',
  'Implementar interface (cursor num struct)': 'Implement interface (cursor on a struct)',
  'Construtor New{name}': 'Constructor New{name}',
  'Construtor (cursor num struct)': 'Constructor (cursor on a struct)',
  'Teste para {name}': 'Test for {name}',
  'Teste (cursor numa função)': 'Test (cursor on a function)',
  'Não foi possível gerar': 'Could not generate',
  'Não foi possível implementar': 'Could not implement',
  'Implementar interface em {name}': 'Implement interface in {name}',
  'Implementar interface': 'Implement interface',
  Implementar: 'Implement',
  Interface: 'Interface',
  'ex.: fmt.Stringer': 'e.g. fmt.Stringer',
  'Sugestões de interface': 'Interface suggestions',
  'nome de interface inválido': 'invalid interface name',

  // Bookmarks
  'Enter vai · Delete apaga · F2 descreve': 'Enter to go · Delete to remove · F2 to describe',
  'Bookmarks do projeto': 'Project bookmarks',
  '{file} linha {line}': '{file} line {line}',
  'linha {line}': 'line {line}',
  'Descrição do bookmark': 'Bookmark description',
  'Nenhum bookmark. F11 marca a linha do cursor; Ctrl+F11 marca com um número ou letra.':
    'No bookmarks. F11 marks the cursor line; Ctrl+F11 marks it with a digit or letter.',
  'Bookmark com mnemônico': 'Bookmark with Mnemonic',
  'Tirar o mnemônico': 'Remove mnemonic',
  'Aperte um número ou uma letra. Ctrl+número volta aqui depois.': 'Press a digit or a letter. Ctrl+digit jumps back here later.',
  Mnemônicos: 'Mnemonics',
  ', em uso': ', in use',

  // Blame
  'não commitado': 'uncommitted',
  'Não foi possível anotar': 'Could not annotate',

  // Breakpoints
  'Breakpoint (silenciado)': 'Breakpoint (muted)',
  'Breakpoint (condição: `{cond}`)': 'Breakpoint (condition: `{cond}`)',
  'Breakpoint · botão direito: editar': 'Breakpoint · right-click to edit',

  // Cobertura
  'Sem cobertura': 'No coverage',
  'Coberto pelos testes': 'Covered by tests',
  'Não coberto': 'Not covered',
  'Coberto em parte': 'Partially covered',

  // Documentos
  'Não foi possível salvar {name}': 'Could not save {name}',
  'Não foi possível abrir o arquivo': 'Could not open the file',

  // Extrair e refatorações
  'Selecione o trecho': 'Select the code',
  'Selecione a expressão que vira variável.': 'Select the expression to turn into a variable.',
  'Selecione as linhas que viram função.': 'Select the lines to turn into a function.',
  'Nada para extrair aqui': 'Nothing to extract here',
  'O gopls não ofereceu essa extração para a seleção.': 'gopls did not offer this extraction for the selection.',
  'Nada para inline aqui': 'Nothing to inline here',
  'Ponha o cursor numa chamada de função do projeto.': 'Place the cursor on a call to a function in the project.',
  'Ponha o cursor no nome de uma função, tipo, método, campo, constante ou variável do pacote.':
    'Place the cursor on the name of a function, type, method, field, constant or package-level variable.',
  '{name} apagado': '{name} deleted',
  'Nenhum uso no projeto. Ctrl+Z desfaz.': 'No usages in the project. Ctrl+Z undoes it.',

  // Prévia do rename
  'Renomear {old} para {new}': 'Rename {old} to {new}',
  Renomear: 'Rename',
  '{n} mudança em {files} arquivos. Os arquivos fechados são abertos e ficam com a mudança para salvar (Ctrl+S).':
    '{n} change in {files} files. Closed files are opened and keep the change for you to save (Ctrl+S).',
  '{n} mudanças em {files} arquivos. Os arquivos fechados são abertos e ficam com a mudança para salvar (Ctrl+S).':
    '{n} changes in {files} files. Closed files are opened and keep the changes for you to save (Ctrl+S).',
  'Mudanças do rename': 'Rename changes',
  'antes: {text}': 'before: {text}',
  'depois: {text}': 'after: {text}',

  // Safe delete
  '{name} ainda é usado': '{name} is still used',
  'Ver os usos': 'Show usages',
  'Nada foi apagado: há {n} uso fora da declaração. Tire os usos e tente de novo.':
    'Nothing was deleted: there is {n} usage outside the declaration. Remove the usages and try again.',
  'Nada foi apagado: há {n} usos fora da declaração. Tire os usos e tente de novo.':
    'Nothing was deleted: there are {n} usages outside the declaration. Remove the usages and try again.',
  Usos: 'Usages',
  '… e mais {n}': '… and {n} more',

  // Editor dividido
  'Editor da direita': 'Right editor',
  'Editor dividido': 'Split editor',
  'Arquivos abertos à direita': 'Files open on the right',
  'Fechar {name} à direita': 'Close {name} on the right',
  'Fechar a divisão': 'Unsplit',

  // Locais recentes
  'Locais recentes': 'Recent Locations',
  Locais: 'Locations',
  'Nenhum local ainda.': 'No locations yet.',

  // Live templates
  função: 'function',
  método: 'method',
  'teste em tabela': 'table-driven test',

  // Recursão
  'Chamada recursiva': 'Recursive call',

  // LSP
  'conexão com o gopls perdida': 'connection to gopls lost',
  'gopls ainda não está pronto': 'gopls is not ready yet',
  'Operação de arquivo ainda não suportada': 'File operation not supported yet',
  'O gopls pediu "{kind}". Faça pela árvore do projeto.': 'gopls asked for "{kind}". Do it from the project tree.',
  'Não foi possível aplicar a mudança': 'Could not apply the change',
  'Não foi possível renomear': 'Could not rename',
  'Não há o que renomear aqui.': 'Nothing to rename here.',
  // Código gerado (Alt+Insert)
  '{fn} cria um {type}.': '{fn} creates a {type}.',
  'caso 1': 'case 1',
  'TODO: chamar {call} e conferir o resultado': 'TODO: call {call} and check the result',
}
