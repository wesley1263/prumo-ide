// Liga o gopls (via LspClient) aos providers do Monaco.
// Posições: LSP é 0-based (linha, caractere UTF-16); Monaco é 1-based (linha, coluna UTF-16).
import { create } from 'zustand'
import { monaco } from '../monaco'
import { LspClient, type LspState } from './client'
import { toast } from '../../design/feedback'
import { t } from '../../i18n'

type M = typeof monaco
type LPos = { line: number; character: number }
type LRange = { start: LPos; end: LPos }
type LTextEdit = { range: LRange; newText: string }
type LDiagnostic = { range: LRange; severity?: number; code?: string | number; source?: string; message: string; tags?: number[] }
type LLocation = { uri: string; range: LRange }
type LLocationLink = { targetUri: string; targetSelectionRange: LRange; targetRange: LRange }
type LWorkspaceEdit = {
  changes?: Record<string, LTextEdit[]>
  documentChanges?: Array<{ textDocument?: { uri: string; version?: number | null }; edits?: LTextEdit[]; kind?: string }>
}
type LCommand = { title: string; command: string; arguments?: unknown[] }
type LCodeAction = { title: string; kind?: string; edit?: LWorkspaceEdit; command?: LCommand; isPreferred?: boolean; data?: unknown; diagnostics?: LDiagnostic[]; disabled?: { reason: string } }

const toRange = (r: LRange) => new monaco.Range(r.start.line + 1, r.start.character + 1, r.end.line + 1, r.end.character + 1)
const toLsp = (p: { lineNumber: number; column: number }): LPos => ({ line: p.lineNumber - 1, character: p.column - 1 })
const toLspRange = (r: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }): LRange => ({
  start: { line: r.startLineNumber - 1, character: r.startColumn - 1 },
  end: { line: r.endLineNumber - 1, character: r.endColumn - 1 },
})
const docId = (model: { uri: { toString(): string } }) => ({ uri: model.uri.toString() })

const kindNames = [
  '', 'Text', 'Method', 'Function', 'Constructor', 'Field', 'Variable', 'Class', 'Interface', 'Module', 'Property', 'Unit',
  'Value', 'Enum', 'Keyword', 'Snippet', 'Color', 'File', 'Reference', 'Folder', 'EnumMember', 'Constant', 'Struct',
  'Event', 'Operator', 'TypeParameter',
] as const
const completionKind = (k?: number) =>
  (monaco.languages.CompletionItemKind as unknown as Record<string, number>)[kindNames[k ?? 1] || 'Text'] ?? monaco.languages.CompletionItemKind.Text

const severity = (s?: number) =>
  s === 2 ? monaco.MarkerSeverity.Warning : s === 3 ? monaco.MarkerSeverity.Info : s === 4 ? monaco.MarkerSeverity.Hint : monaco.MarkerSeverity.Error

function markdown(contents: unknown): { value: string }[] {
  // MarkupContent {kind, value} | MarkedString (string | {language, value}) | MarkedString[]
  const one = (c: unknown): string => {
    if (typeof c === 'string') return c
    if (!c || typeof c !== 'object') return ''
    const o = c as { language?: string; value?: string }
    return o.language ? '```' + o.language + '\n' + (o.value ?? '') + '\n```' : (o.value ?? '')
  }
  const list = Array.isArray(contents) ? contents : [contents]
  return list.map(one).filter(Boolean).map((value) => ({ value }))
}

// ---------------------------------------------------------------- diagnósticos (para a status bar e o Problems)

export interface DiagCounts {
  errors: number
  warnings: number
}
export const useDiagnostics = create<{ byUri: Record<string, LDiagnostic[]>; counts: DiagCounts }>(() => ({ byUri: {}, counts: { errors: 0, warnings: 0 } }))

function storeDiagnostics(uri: string, diags: LDiagnostic[]) {
  const byUri = { ...useDiagnostics.getState().byUri, [uri]: diags }
  if (diags.length === 0) delete byUri[uri]
  let errors = 0
  let warnings = 0
  for (const list of Object.values(byUri)) for (const d of list) d.severity === 2 ? warnings++ : (d.severity ?? 1) === 1 && errors++
  useDiagnostics.setState({ byUri, counts: { errors, warnings } })
}

function applyMarkers(model: ReturnType<M['editor']['getModel']>, diags: LDiagnostic[]) {
  if (!model) return
  monaco.editor.setModelMarkers(
    model,
    'gopls',
    diags.map((d) => ({
      ...toRange(d.range),
      severity: severity(d.severity),
      message: d.message,
      source: d.source,
      code: d.code !== undefined ? String(d.code) : undefined,
      tags: d.tags?.filter((t) => t === 1 || t === 2) as number[] | undefined,
    })),
  )
}

// ---------------------------------------------------------------- conexão ativa

export const useLsp = create<{ state: LspState; message: string }>(() => ({ state: 'closed', message: '' }))

let client: LspClient | null = null
let ensureModel: (uri: string) => Promise<ReturnType<M['editor']['getModel']>> = async () => null

/** Aplica um WorkspaceEdit do LSP nos modelos (carregando os arquivos que ainda não estão abertos). */
async function applyWorkspaceEdit(edit: LWorkspaceEdit): Promise<boolean> {
  const perUri = new Map<string, LTextEdit[]>()
  for (const [uri, edits] of Object.entries(edit.changes ?? {})) perUri.set(uri, edits)
  for (const dc of edit.documentChanges ?? []) {
    if (dc.kind) {
      toast('warning', t('Operação de arquivo ainda não suportada'), t('O gopls pediu "{kind}". Faça pela árvore do projeto.', { kind: dc.kind }))
      continue
    }
    if (dc.textDocument && dc.edits) perUri.set(dc.textDocument.uri, [...(perUri.get(dc.textDocument.uri) ?? []), ...dc.edits])
  }
  for (const [uri, edits] of perUri) {
    const model = await ensureModel(uri)
    if (!model) {
      toast('danger', t('Não foi possível aplicar a mudança'), uri)
      return false
    }
    model.pushEditOperations([], edits.map((e) => ({ range: toRange(e.range), text: e.newText })), () => null)
  }
  return true
}

async function toMonacoWorkspaceEdit(edit: LWorkspaceEdit) {
  const edits: Array<{ resource: InstanceType<M['Uri']>; textEdit: { range: InstanceType<M['Range']>; text: string }; versionId: undefined }> = []
  const add = async (uri: string, list: LTextEdit[]) => {
    await ensureModel(uri)
    for (const e of list) edits.push({ resource: monaco.Uri.parse(uri), textEdit: { range: toRange(e.range), text: e.newText }, versionId: undefined })
  }
  for (const [uri, list] of Object.entries(edit.changes ?? {})) await add(uri, list)
  for (const dc of edit.documentChanges ?? []) if (dc.textDocument && dc.edits) await add(dc.textDocument.uri, dc.edits)
  return { edits }
}

async function locations(res: LLocation | LLocation[] | LLocationLink[] | null) {
  if (!res) return []
  const list = (Array.isArray(res) ? res : [res]) as Array<LLocation | LLocationLink>
  const out = list.map((l) => ('targetUri' in l ? { uri: l.targetUri, range: l.targetSelectionRange } : l))
  await Promise.all(out.map((l) => ensureModel(l.uri))) // o Monaco só navega para modelos existentes
  return out.map((l) => ({ uri: monaco.Uri.parse(l.uri), range: toRange(l.range) }))
}

const isGo = (m: { getLanguageId(): string }) => m.getLanguageId() === 'go'

/**
 * Rename recusado (nome inválido, nada para renomear). O Monaco mostra o motivo num balão que some assim
 * que o cursor se mexe, e ele se mexe ao fechar a caixa de rename: o motivo vai também num aviso da IDE.
 */
function rejected(reason: string) {
  toast('warning', t('Não foi possível renomear'), reason)
  return { rejectReason: reason }
}

/**
 * Conecta o gopls do projeto e registra os providers. Devolve a função que desliga tudo.
 * opener: abre um arquivo pelo URI (usado por "ir para definição" entre arquivos).
 */
export function attachLsp(
  projectId: string,
  opts: {
    ensureModel: (uri: string) => Promise<ReturnType<M['editor']['getModel']>>
    openUri: (uri: string, line?: number, col?: number) => Promise<boolean>
    isProjectUri: (uri: string) => boolean
  },
): () => void {
  ensureModel = opts.ensureModel
  const c = new LspClient(projectId)
  client = c
  const disposables: Array<{ dispose(): void }> = []
  const offs: Array<() => void> = []
  useDiagnostics.setState({ byUri: {}, counts: { errors: 0, warnings: 0 } })

  // ---------------- estado
  offs.push(c.onState((state, message) => useLsp.setState({ state, message })))

  // ---------------- sincronização de documentos
  const opened = new Set<string>()
  const openDoc = (m: ReturnType<M['editor']['getModel']>) => {
    if (!m || !isGo(m) || !opts.isProjectUri(m.uri.toString()) || c.state !== 'ready') return
    opened.add(m.uri.toString())
    c.notify('textDocument/didOpen', { textDocument: { ...docId(m), languageId: 'go', version: m.getVersionId(), text: m.getValue() } })
  }
  const watchModel = (m: ReturnType<M['editor']['getModel']>) => {
    if (!m || !isGo(m)) return
    openDoc(m)
    const sub = m.onDidChangeContent((e) => {
      if (!opened.has(m.uri.toString())) return
      c.notify('textDocument/didChange', {
        textDocument: { ...docId(m), version: m.getVersionId() },
        // O Monaco entrega as mudanças do fim para o começo: aplicar em ordem é seguro.
        contentChanges: e.changes.map((ch) => ({ range: toLspRange(ch.range), text: ch.text })),
      })
    })
    disposables.push(sub)
    const diags = useDiagnostics.getState().byUri[m.uri.toString()]
    if (diags) applyMarkers(m, diags)
  }
  monaco.editor.getModels().forEach(watchModel)
  disposables.push(monaco.editor.onDidCreateModel(watchModel))
  disposables.push(
    monaco.editor.onWillDisposeModel((m) => {
      if (opened.delete(m.uri.toString())) c.notify('textDocument/didClose', { textDocument: docId(m) })
    }),
  )
  offs.push(
    c.onReady(() => {
      opened.clear()
      monaco.editor.getModels().forEach(openDoc)
      registerSemanticTokens()
    }),
  )
  offs.push(
    c.onNotification('textDocument/publishDiagnostics', (p: { uri: string; diagnostics: LDiagnostic[] }) => {
      storeDiagnostics(p.uri, p.diagnostics)
      applyMarkers(monaco.editor.getModel(monaco.Uri.parse(p.uri)), p.diagnostics)
    }),
  )
  offs.push(
    c.onNotification('window/showMessage', (p: { type: number; message: string }) => {
      if (p.type <= 2) toast(p.type === 1 ? 'danger' : 'warning', 'gopls', p.message)
    }),
  )
  c.onRequest('workspace/applyEdit', async (p: { edit: LWorkspaceEdit }) => ({ applied: await applyWorkspaceEdit(p.edit) }))
  c.onRequest('window/showDocument', async (p: { uri: string; selection?: LRange }) => ({
    success: await opts.openUri(p.uri, p.selection ? p.selection.start.line + 1 : undefined, p.selection ? p.selection.start.character + 1 : undefined),
  }))
  c.onRequest('window/showMessageRequest', (p: { message: string }) => {
    toast('info', 'gopls', p.message)
    return null
  })

  const req = <T,>(method: string, params: unknown, token?: Parameters<LspClient['request']>[2]) =>
    c.request<T>(method, params, token).catch(() => null as T | null)

  // ---------------- providers
  const L = monaco.languages
  disposables.push(
    L.registerCompletionItemProvider('go', {
      triggerCharacters: ['.'],
      async provideCompletionItems(model, position, ctx, token) {
        const res = await req<{ items: any[]; isIncomplete?: boolean } | any[]>(
          'textDocument/completion',
          { textDocument: docId(model), position: toLsp(position), context: { triggerKind: ctx.triggerKind + 1, triggerCharacter: ctx.triggerCharacter } },
          token,
        )
        if (!res) return { suggestions: [] }
        const items = Array.isArray(res) ? res : res.items
        const word = model.getWordUntilPosition(position)
        const fallback = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
        return {
          incomplete: !Array.isArray(res) && !!res.isIncomplete,
          suggestions: items.map((it, i) => {
            const te = it.textEdit
            const range = te ? ('range' in te ? toRange(te.range) : { insert: toRange(te.insert), replace: toRange(te.replace) }) : fallback
            return {
              label: it.labelDetails ? { label: it.label, detail: it.labelDetails.detail, description: it.labelDetails.description } : it.label,
              kind: completionKind(it.kind),
              detail: it.detail,
              documentation: it.documentation ? markdown(it.documentation)[0] : undefined,
              insertText: te?.newText ?? it.insertText ?? it.label,
              insertTextRules: it.insertTextFormat === 2 ? L.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
              range,
              sortText: it.sortText ?? String(i).padStart(5, '0'),
              filterText: it.filterText,
              preselect: it.preselect,
              tags: it.deprecated || it.tags?.includes(1) ? [L.CompletionItemTag.Deprecated] : undefined,
              additionalTextEdits: it.additionalTextEdits?.map((e: LTextEdit) => ({ range: toRange(e.range), text: e.newText })),
              __lsp: it,
            } as any
          }),
        }
      },
      async resolveCompletionItem(item: any, token) {
        if (!item.__lsp || item.documentation) return item
        const r = await req<any>('completionItem/resolve', item.__lsp, token)
        if (!r) return item
        return {
          ...item,
          detail: r.detail ?? item.detail,
          documentation: r.documentation ? markdown(r.documentation)[0] : item.documentation,
          additionalTextEdits: r.additionalTextEdits?.map((e: LTextEdit) => ({ range: toRange(e.range), text: e.newText })) ?? item.additionalTextEdits,
        }
      },
    }),
    L.registerHoverProvider('go', {
      async provideHover(model, position, token) {
        const r = await req<{ contents: unknown; range?: LRange }>('textDocument/hover', { textDocument: docId(model), position: toLsp(position) }, token)
        if (!r) return null
        return { contents: markdown(r.contents), range: r.range ? toRange(r.range) : undefined }
      },
    }),
    L.registerSignatureHelpProvider('go', {
      signatureHelpTriggerCharacters: ['(', ','],
      signatureHelpRetriggerCharacters: [','],
      async provideSignatureHelp(model, position, token) {
        const r = await req<any>('textDocument/signatureHelp', { textDocument: docId(model), position: toLsp(position) }, token)
        if (!r || !r.signatures?.length) return null
        return {
          value: {
            activeSignature: r.activeSignature ?? 0,
            activeParameter: r.activeParameter ?? r.signatures[r.activeSignature ?? 0]?.activeParameter ?? 0,
            signatures: r.signatures.map((s: any) => ({
              label: s.label,
              documentation: s.documentation ? markdown(s.documentation)[0] : undefined,
              parameters: (s.parameters ?? []).map((p: any) => ({ label: p.label, documentation: p.documentation ? markdown(p.documentation)[0] : undefined })),
              activeParameter: s.activeParameter,
            })),
          },
          dispose() {},
        }
      },
    }),
    L.registerDefinitionProvider('go', {
      async provideDefinition(model, position, token) {
        return locations(await req('textDocument/definition', { textDocument: docId(model), position: toLsp(position) }, token))
      },
    }),
    L.registerTypeDefinitionProvider('go', {
      async provideTypeDefinition(model, position, token) {
        return locations(await req('textDocument/typeDefinition', { textDocument: docId(model), position: toLsp(position) }, token))
      },
    }),
    L.registerImplementationProvider('go', {
      async provideImplementation(model, position, token) {
        return locations(await req('textDocument/implementation', { textDocument: docId(model), position: toLsp(position) }, token))
      },
    }),
    L.registerReferenceProvider('go', {
      async provideReferences(model, position, ctx, token) {
        return locations(
          await req('textDocument/references', { textDocument: docId(model), position: toLsp(position), context: { includeDeclaration: ctx.includeDeclaration } }, token),
        )
      },
    }),
    L.registerDocumentHighlightProvider('go', {
      async provideDocumentHighlights(model, position, token) {
        const r = await req<Array<{ range: LRange; kind?: number }>>('textDocument/documentHighlight', { textDocument: docId(model), position: toLsp(position) }, token)
        return (r ?? []).map((h) => ({ range: toRange(h.range), kind: (h.kind ?? 1) - 1 }))
      },
    }),
    L.registerRenameProvider('go', {
      async resolveRenameLocation(model, position, token) {
        const r = await c.request<{ range: LRange; placeholder: string } | LRange | null>('textDocument/prepareRename', { textDocument: docId(model), position: toLsp(position) }, token).catch((e) => {
          return { rejectReason: String(e.message) } as never
        })
        if (r && 'rejectReason' in (r as object)) return rejected((r as unknown as { rejectReason: string }).rejectReason) as never
        if (!r) return rejected(t('Não há o que renomear aqui.')) as never
        const range = 'range' in r ? r.range : r
        return { range: toRange(range), text: 'placeholder' in r ? r.placeholder : model.getValueInRange(toRange(range)) }
      },
      async provideRenameEdits(model, position, newName, token) {
        const r = await c.request<LWorkspaceEdit>('textDocument/rename', { textDocument: docId(model), position: toLsp(position), newName }, token).catch((e) => ({ rejectReason: String(e.message) }) as never)
        if (!r) return { edits: [] }
        if ('rejectReason' in (r as object)) return rejected((r as unknown as { rejectReason: string }).rejectReason) as never
        // Mexe em mais de um arquivo: mostra a prévia e só aplica se o usuário confirmar.
        const changes = flattenEdit(r)
        if (renamePreview && new Set(changes.map((x) => x.uri)).size > 1) {
          const ok = await renamePreview({ oldName: model.getWordAtPosition(position)?.word ?? '', newName, changes })
          if (!ok) return { edits: [] }
        }
        return toMonacoWorkspaceEdit(r)
      },
    }),
    L.registerCodeActionProvider('go', {
      async provideCodeActions(model, range, ctx, token) {
        const diags = (useDiagnostics.getState().byUri[model.uri.toString()] ?? []).filter((d) => toRange(d.range).intersectRanges(range))
        const r = await req<Array<LCodeAction | LCommand>>(
          'textDocument/codeAction',
          { textDocument: docId(model), range: toLspRange(range), context: { diagnostics: diags, only: ctx.only ? [ctx.only] : undefined, triggerKind: ctx.trigger } },
          token,
        )
        const actions = await Promise.all(
          (r ?? []).map(async (a) => {
            if ('command' in a && typeof a.command === 'string') {
              return { title: a.title, command: { id: 'prumo.lsp.executeCommand', title: a.title, arguments: [a] } }
            }
            const ca = a as LCodeAction
            return {
              title: ca.title,
              kind: ca.kind,
              isPreferred: ca.isPreferred,
              disabled: ca.disabled?.reason,
              diagnostics: ca.diagnostics?.map((d) => ({ ...toRange(d.range), message: d.message, severity: severity(d.severity) })),
              edit: ca.edit ? await toMonacoWorkspaceEdit(ca.edit) : undefined,
              command: ca.command ? { id: 'prumo.lsp.executeCommand', title: ca.command.title, arguments: [ca.command] } : undefined,
              __lsp: ca,
            }
          }),
        )
        return { actions: actions as any, dispose() {} }
      },
      async resolveCodeAction(action: any, token) {
        const ca = action.__lsp as LCodeAction | undefined
        if (!ca || ca.edit || ca.data === undefined) return action
        const r = await req<LCodeAction>('codeAction/resolve', ca, token)
        if (r?.edit) action.edit = await toMonacoWorkspaceEdit(r.edit)
        return action
      },
    }),
    L.registerDocumentFormattingEditProvider('go', {
      async provideDocumentFormattingEdits(model, options, token) {
        const r = await req<LTextEdit[]>('textDocument/formatting', { textDocument: docId(model), options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces } }, token)
        return (r ?? []).map((e) => ({ range: toRange(e.range), text: e.newText }))
      },
    }),
    L.registerInlayHintsProvider('go', {
      async provideInlayHints(model, range, token) {
        const r = await req<any[]>('textDocument/inlayHint', { textDocument: docId(model), range: toLspRange(range) }, token)
        return {
          hints: (r ?? []).map((h) => ({
            position: { lineNumber: h.position.line + 1, column: h.position.character + 1 },
            label: typeof h.label === 'string' ? h.label : h.label.map((p: { value: string }) => p.value).join(''),
            kind: h.kind === 2 ? L.InlayHintKind.Parameter : L.InlayHintKind.Type,
            paddingLeft: h.paddingLeft,
            paddingRight: h.paddingRight,
          })),
          dispose() {},
        }
      },
    }),
  )

  // Estrutura do arquivo (Ctrl+Shift+O no Monaco; base do S08 "File structure").
  disposables.push(
    L.registerDocumentSymbolProvider('go', {
      async provideDocumentSymbols(model, token) {
        type DS = { name: string; detail?: string; kind: number; range: LRange; selectionRange: LRange; children?: DS[] }
        const r = await req<DS[]>('textDocument/documentSymbol', { textDocument: docId(model) }, token)
        const conv = (d: DS): any => ({
          name: d.name,
          detail: d.detail ?? '',
          kind: d.kind - 1, // SymbolKind do LSP começa em 1; o do Monaco em 0
          tags: [],
          range: toRange(d.range),
          selectionRange: toRange(d.selectionRange),
          children: d.children?.map(conv),
        })
        return (r ?? []).filter((d) => 'selectionRange' in d).map(conv)
      },
    }),
  )

  // Navegar para outro arquivo (definição, referências): o Monaco standalone só troca de modelo
  // dentro do mesmo editor se alguém abrir o arquivo — quem abre é o sistema de abas da IDE.
  disposables.push(
    monaco.editor.registerEditorOpener({
      openCodeEditor(_source, resource, selectionOrPosition) {
        const pos = !selectionOrPosition ? undefined : 'startLineNumber' in selectionOrPosition
          ? { line: selectionOrPosition.startLineNumber, col: selectionOrPosition.startColumn }
          : { line: selectionOrPosition.lineNumber, col: selectionOrPosition.column }
        opts.openUri(resource.toString(), pos?.line, pos?.col)
        return true
      },
    }),
  )

  // Comandos do servidor (alguns quick-fixes do gopls são comandos que voltam como applyEdit).
  disposables.push(
    monaco.editor.registerCommand('prumo.lsp.executeCommand', (_acc, cmd: LCommand) => {
      req('workspace/executeCommand', { command: cmd.command, arguments: cmd.arguments })
    }),
  )

  // Tokens semânticos: a legenda só é conhecida depois do initialize.
  let semantic: { dispose(): void } | null = null
  function registerSemanticTokens() {
    semantic?.dispose()
    const prov = c.capabilities.semanticTokensProvider as { legend: { tokenTypes: string[]; tokenModifiers: string[] } } | undefined
    if (!prov?.legend) return
    semantic = L.registerDocumentSemanticTokensProvider('go', {
      getLegend: () => prov.legend,
      async provideDocumentSemanticTokens(model, _last, token) {
        const r = await req<{ data: number[]; resultId?: string }>('textDocument/semanticTokens/full', { textDocument: docId(model) }, token)
        return r ? { data: new Uint32Array(r.data), resultId: r.resultId } : null
      },
      releaseDocumentSemanticTokens() {},
    })
  }

  return () => {
    disposables.forEach((d) => d.dispose())
    semantic?.dispose()
    offs.forEach((o) => o())
    c.dispose()
    if (client === c) client = null
    useLsp.setState({ state: 'closed', message: '' })
  }
}

/** Reconecta o LSP (ex.: depois de confiar no projeto). */
export interface WorkspaceSymbol {
  name: string
  kind: number // SymbolKind do LSP (começa em 1)
  containerName?: string
  location: { uri: string; range: LRange }
}

/** Símbolos do workspace (Buscar em tudo > Símbolos). Vazio enquanto o gopls não estiver pronto. */
export async function workspaceSymbols(query: string): Promise<WorkspaceSymbol[]> {
  if (!client || client.state !== 'ready' || !query.trim()) return []
  const r = await client.request<WorkspaceSymbol[] | null>('workspace/symbol', { query })
  return (r ?? []).filter((s) => 'location' in s && 'range' in s.location)
}

// ---------------- usos (S09), super e prévia do rename

export interface Usage {
  uri: string
  range: LRange
  kind: 'declaration' | 'write' | 'read'
}

/**
 * Usos do símbolo na posição, classificados: declaração, escrita e leitura. A classificação vem do
 * documentHighlight do gopls (uma chamada por arquivo, na primeira ocorrência dele).
 */
export async function findUsages(uri: string, line: number, character: number): Promise<Usage[] | null> {
  if (!client || client.state !== 'ready') return null
  const c = client
  const textDocument = { uri }
  const position = { line, character }
  const refs = await c.request<LLocation[] | null>('textDocument/references', { textDocument, position, context: { includeDeclaration: true } }).catch(() => null)
  if (!refs) return null
  const defs = await c.request<LLocation | LLocation[] | null>('textDocument/definition', { textDocument, position }).catch(() => null)
  const defList = defs ? (Array.isArray(defs) ? defs : [defs]) : []
  const same = (a: LRange, b: LRange) => a.start.line === b.start.line && a.start.character === b.start.character
  const isDecl = (l: LLocation) => defList.some((d) => d.uri === l.uri && same(d.range, l.range))
  const byUri = new Map<string, LLocation[]>()
  for (const r of refs) byUri.set(r.uri, [...(byUri.get(r.uri) ?? []), r])
  const writes = new Set<string>()
  await Promise.all(
    [...byUri.entries()].map(async ([uri, list]) => {
      const hs = await c
        .request<Array<{ range: LRange; kind?: number }> | null>('textDocument/documentHighlight', { textDocument: { uri }, position: list[0].range.start })
        .catch(() => null)
      for (const h of hs ?? []) if (h.kind === 3) writes.add(`${uri}:${h.range.start.line}:${h.range.start.character}`)
    }),
  )
  return refs.map((r) => ({
    uri: r.uri,
    range: r.range,
    kind: isDecl(r) ? 'declaration' : writes.has(`${r.uri}:${r.range.start.line}:${r.range.start.character}`) ? 'write' : 'read',
  }))
}

/** Os métodos de interface que o método na posição implementa (Ctrl+U, "super"). */
export async function superMethods(uri: string, line: number, character: number): Promise<LLocation[]> {
  if (!client || client.state !== 'ready') return []
  const c = client
  const impls = await c.request<LLocation[] | null>('textDocument/implementation', { textDocument: { uri }, position: { line, character } }).catch(() => null)
  if (!impls?.length) return []
  // O implementation do gopls vai nos dois sentidos: fica só com o que está dentro de uma interface.
  type DS = { kind: number; range: LRange; children?: DS[] }
  const inside = (r: LRange, s: LRange) => (r.start.line > s.start.line || (r.start.line === s.start.line && r.start.character >= s.start.character)) && (r.end.line < s.end.line || (r.end.line === s.end.line && r.end.character <= s.end.character))
  const symbols = new Map<string, DS[]>()
  const out: LLocation[] = []
  for (const l of impls) {
    if (!symbols.has(l.uri)) symbols.set(l.uri, (await c.request<DS[] | null>('textDocument/documentSymbol', { textDocument: { uri: l.uri } }).catch(() => null)) ?? [])
    const walk = (list: DS[]): boolean => list.some((s) => inside(l.range, s.range) && (s.kind === 11 || walk(s.children ?? [])))
    if (walk(symbols.get(l.uri)!)) out.push(l)
  }
  return out
}

/** Para onde o nome na posição leva (definição); [] sem LSP. */
export async function definitionAt(uri: string, line: number, character: number): Promise<LLocation[]> {
  if (!client || client.state !== 'ready') return []
  const r = await client.request<LLocation | LLocation[] | null>('textDocument/definition', { textDocument: { uri }, position: { line, character } }).catch(() => null)
  return r ? (Array.isArray(r) ? r : [r]) : []
}

/** Símbolo do arquivo (Estrutura e breadcrumbs). Linhas e colunas 0-based, como no LSP. */
export interface DocSymbol {
  name: string
  detail?: string
  kind: number // SymbolKind do LSP
  range: LRange
  selectionRange: LRange
  children?: DocSymbol[]
}

/** A documentação (markdown do gopls) do símbolo na posição; "" se não houver. */
export async function hoverAt(uri: string, line: number, character: number): Promise<string> {
  if (!client || client.state !== 'ready') return ''
  type H = { contents: string | { value: string } | Array<string | { value: string }> }
  const r = await client.request<H | null>('textDocument/hover', { textDocument: { uri }, position: { line, character } }).catch(() => null)
  if (!r) return ''
  const parts = Array.isArray(r.contents) ? r.contents : [r.contents]
  return parts.map((p) => (typeof p === 'string' ? p : p.value)).join('\n\n')
}

/** A estrutura do arquivo (funções, tipos, métodos, campos...). */
export async function documentSymbols(uri: string): Promise<DocSymbol[]> {
  if (!client || client.state !== 'ready') return []
  const r = await client.request<DocSymbol[] | null>('textDocument/documentSymbol', { textDocument: { uri } }).catch(() => null)
  return (r ?? []).filter((d) => 'selectionRange' in d)
}

/** Uma mudança de um rename, para a prévia. */
export interface RenameChange {
  uri: string
  range: LRange
  newText: string
}

function flattenEdit(edit: LWorkspaceEdit): RenameChange[] {
  const out: RenameChange[] = []
  for (const [uri, list] of Object.entries(edit.changes ?? {})) for (const e of list) out.push({ uri, range: e.range, newText: e.newText })
  for (const dc of edit.documentChanges ?? []) if (dc.textDocument && dc.edits) for (const e of dc.edits) out.push({ uri: dc.textDocument.uri, range: e.range, newText: e.newText })
  return out
}

let renamePreview: ((p: { oldName: string; newName: string; changes: RenameChange[] }) => Promise<boolean>) | null = null
/** Liga a prévia do rename (S11): devolve true para aplicar. */
export function setRenamePreview(fn: typeof renamePreview) {
  renamePreview = fn
}

export function reconnectLsp() {
  client?.reconnect()
}

/** didSave para o gopls (dispara análises que só rodam ao salvar). */
export function notifySaved(model: { uri: { toString(): string }; getLanguageId(): string }) {
  if (client && model.getLanguageId() === 'go') client.notify('textDocument/didSave', { textDocument: docId(model) })
}

/**
 * Organiza imports e formata antes de salvar. Se o gopls não responder em 2s, salva como está.
 */
export async function formatBeforeSave(model: ReturnType<M['editor']['getModel']>) {
  if (!model || !client || client.state !== 'ready') return
  const c = client
  const within = <T,>(p: Promise<T>) => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), 2000))])
  try {
    const actions = await within(
      c.request<LCodeAction[]>('textDocument/codeAction', {
        textDocument: docId(model),
        range: toLspRange(model.getFullModelRange()),
        context: { diagnostics: [], only: ['source.organizeImports'] },
      }),
    )
    for (const a of actions ?? []) {
      let edit = a.edit
      if (!edit && a.data !== undefined) edit = (await within(c.request<LCodeAction>('codeAction/resolve', a)))?.edit
      if (edit) await applyWorkspaceEdit(edit)
    }
    const edits = await within(c.request<LTextEdit[]>('textDocument/formatting', { textDocument: docId(model), options: { tabSize: 4, insertSpaces: false } }))
    if (edits?.length) model.pushEditOperations([], edits.map((e) => ({ range: toRange(e.range), text: e.newText })), () => null)
  } catch {
    // gopls indisponível: salvar sem formatar é melhor que não salvar.
  }
}
