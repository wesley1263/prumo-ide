// Live templates (como os do GoLand): uma abreviação no começo da linha vira um snippet com Tab entre os campos.
// Postfix (x.print, x.var, x.for, err.nn…) já vem do gopls, nas sugestões depois do ponto.
import { monaco } from './monaco'
import { t } from '../i18n'

export interface LiveTemplate {
  abbr: string
  desc: string
  body: string // sintaxe de snippet do Monaco: $1, ${1:padrão}, $0 = onde o cursor termina
}

export const TEMPLATES: LiveTemplate[] = [
  { abbr: 'iferr', desc: 'if err != nil { return … }', body: 'if err != nil {\n\treturn ${1:err}\n}$0' },
  { abbr: 'ifnil', desc: 'if x == nil { … }', body: 'if ${1:x} == nil {\n\t$0\n}' },
  { abbr: 'fori', desc: 'for i := 0; i < n; i++', body: 'for ${1:i} := 0; $1 < ${2:n}; $1++ {\n\t$0\n}' },
  { abbr: 'forr', desc: 'for k, v := range x', body: 'for ${1:_}, ${2:v} := range ${3:x} {\n\t$0\n}' },
  { abbr: 'func', desc: t('função'), body: 'func ${1:nome}(${2}) ${3}{\n\t$0\n}' },
  { abbr: 'meth', desc: t('método'), body: 'func (${1:r} *${2:T}) ${3:Nome}(${4}) ${5}{\n\t$0\n}' },
  { abbr: 'main', desc: 'func main()', body: 'func main() {\n\t$0\n}' },
  { abbr: 'test', desc: 'func TestX(t *testing.T)', body: 'func Test${1:Nome}(t *testing.T) {\n\t$0\n}' },
  { abbr: 'tt', desc: t('teste em tabela'), body: 'tests := []struct {\n\tname string\n\t$1\n}{\n\t{name: "${2:caso}"},\n}\nfor _, tt := range tests {\n\tt.Run(tt.name, func(t *testing.T) {\n\t\t$0\n\t})\n}' },
  { abbr: 'bench', desc: 'func BenchmarkX(b *testing.B)', body: 'func Benchmark${1:Nome}(b *testing.B) {\n\tfor b.Loop() {\n\t\t$0\n\t}\n}' },
  { abbr: 'st', desc: 'type X struct', body: 'type ${1:Nome} struct {\n\t$0\n}' },
  { abbr: 'inf', desc: 'type X interface', body: 'type ${1:Nome} interface {\n\t$0\n}' },
  { abbr: 'sw', desc: 'switch', body: 'switch ${1:x} {\ncase ${2}:\n\t$0\n}' },
  { abbr: 'sel', desc: 'select', body: 'select {\ncase ${1:v} := <-${2:ch}:\n\t$0\n}' },
  { abbr: 'gof', desc: 'go func() { … }()', body: 'go func() {\n\t$0\n}()' },
  { abbr: 'df', desc: 'defer func() { … }()', body: 'defer func() {\n\t$0\n}()' },
  { abbr: 'ctx', desc: 'ctx context.Context', body: 'ctx context.Context' },
  { abbr: 'pl', desc: 'fmt.Println', body: 'fmt.Println($0)' },
  { abbr: 'pf', desc: 'fmt.Printf', body: 'fmt.Printf("${1:%v}\\\\n", $0)' },
]

export function installTemplates(): () => void {
  const d = monaco.languages.registerCompletionItemProvider('go', {
    provideCompletionItems(model, position) {
      const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1)
      // Só no começo da linha (depois da indentação): no meio de uma expressão a sugestão atrapalharia.
      const m = /^(\s*)([a-z]*)$/.exec(before)
      if (!m || !m[2]) return { suggestions: [] }
      const range = new monaco.Range(position.lineNumber, m[1].length + 1, position.lineNumber, position.column)
      return {
        suggestions: TEMPLATES.filter((t) => t.abbr.startsWith(m[2])).map((t) => ({
          label: { label: t.abbr, description: 'template' },
          detail: t.desc,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: t.body,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          sortText: '0' + t.abbr, // antes das sugestões do gopls com o mesmo começo
          documentation: { value: '```go\n' + t.body.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\d/g, '') + '\n```' },
        })),
      }
    },
  })
  return () => d.dispose()
}
