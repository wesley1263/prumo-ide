// O texto que o Alt+Insert gera (sem dependências: testado com node --test).

const KEYWORDS = new Set(['break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type', 'var'])

/** Os comentários que vão no código gerado (o Generate.tsx passa os traduzidos; aqui, o português). */
export interface GenWords {
  creates: (fn: string, type: string) => string // "NewT cria um T."
  case1: string
  todo: (call: string) => string
}
export const PT_WORDS: GenWords = {
  creates: (fn, type) => `${fn} cria um ${type}.`,
  case1: 'caso 1',
  todo: (call) => `TODO: chamar ${call} e conferir o resultado`,
}

/** Nome de parâmetro a partir do campo: Price → price; type → typ. */
export function paramName(field: string): string {
  const p = field.replace(/^[A-Z]+/, (m) => (m.length > 1 && m.length < field.length ? m.slice(0, -1).toLowerCase() + m.slice(-1) : m.toLowerCase()))
  return KEYWORDS.has(p) ? p.slice(0, 3) : p
}

/** func NewT(campos) *T: um parâmetro por campo, na ordem do struct. */
export function constructorFor(typeName: string, fields: Array<{ name: string; type: string }>, w: GenWords = PT_WORDS): string {
  const params = fields.map((f) => `${paramName(f.name)} ${f.type}`).join(', ')
  const assigns = fields.map((f) => `${f.name}: ${paramName(f.name)}`).join(', ')
  return `\n// ${w.creates('New' + typeName, typeName)}\nfunc New${typeName}(${params}) *${typeName} {\n\treturn &${typeName}{${assigns}}\n}\n`
}

/** Esqueleto de teste em tabela para a função (ou método: TestTipo_Metodo). */
export function testFor(fn: string, receiver?: string, w: GenWords = PT_WORDS): string {
  const name = receiver ? `Test${receiver}_${fn}` : `Test${fn}`
  return `\nfunc ${name}(t *testing.T) {\n\ttests := []struct {\n\t\tname string\n\t}{\n\t\t{name: "${w.case1}"},\n\t}\n\tfor _, tt := range tests {\n\t\tt.Run(tt.name, func(t *testing.T) {\n\t\t\t// ${w.todo((receiver ? receiver + '.' : '') + fn)}\n\t\t})\n\t}\n}\n`
}
