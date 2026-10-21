// Gerar código (Alt+Insert): construtor para o struct sob o cursor e teste em tabela para a função sob o cursor.
// Os símbolos vêm do documentSymbol do gopls; o texto gerado é Go comum, e o Ctrl+S formata como sempre.
import { create } from 'zustand'
import { Box, Braces, FlaskConical } from 'lucide-react'
import { monaco } from './monaco'
import { currentEditor } from './EditorArea'
import { useDocs } from './docs'
import { documentSymbols, formatBeforeSave, useDiagnostics, workspaceSymbols, type DocSymbol } from './lsp/adapter'
import { api } from '../lib/api'
import { ContextMenu } from '../design/ContextMenu'
import { Dialog, toast } from '../design/feedback'
import { Button, TextField } from '../design/controls'
import { useEffect, useState } from 'react'
import { constructorFor, testFor, type GenWords } from './generateNames'
import { runAction } from './runAction'
import { t } from '../i18n'

// Comentários do código gerado, no idioma da interface.
const WORDS: GenWords = {
  creates: (fn, type) => t('{fn} cria um {type}.', { fn, type }),
  case1: t('caso 1'),
  todo: (call) => t('TODO: chamar {call} e conferir o resultado', { call }),
}

interface Target {
  key: string
  struct?: DocSymbol
  func?: { name: string; receiver?: string }
}

export const useGenerate = create<{ menu: { x: number; y: number; target: Target } | null; implement: Target | null }>(() => ({ menu: null, implement: null }))

const inside = (s: DocSymbol, line0: number) => line0 >= s.range.start.line && line0 <= s.range.end.line

/** Alt+Insert: o que dá para gerar onde o cursor está. */
export async function openGenerate() {
  const ed = currentEditor()
  const m = ed?.getModel()
  const pos = ed?.getPosition()
  const docs = useDocs.getState()
  const key = docs.active
  if (!ed || !m || !pos || !key || !key.endsWith('.go') || key.startsWith('ext:')) return
  const syms = await documentSymbols(m.uri.toString())
  const hit = syms.find((s) => inside(s, pos.lineNumber - 1))
  const target: Target = { key }
  if (hit && hit.kind === 23 /* struct */) target.struct = hit
  if (hit && (hit.kind === 12 || hit.kind === 6)) {
    // Método: "(*Cart).Total" ou "Cart.Total".
    const mm = /^\(?\*?(\w+)\)?\.(\w+)$/.exec(hit.name)
    target.func = mm ? { name: mm[2], receiver: mm[1] } : { name: hit.name }
  }
  const vis = ed.getScrolledVisiblePosition(pos)
  const box = ed.getDomNode()?.getBoundingClientRect()
  useGenerate.setState({ menu: { x: (box?.left ?? 0) + (vis?.left ?? 0), y: (box?.top ?? 0) + (vis?.top ?? 0) + (vis?.height ?? 16), target } })
}

async function generateConstructor(t: Target) {
  const s = t.struct!
  const fields = (s.children ?? []).filter((c) => c.kind === 8).map((c) => ({ name: c.name, type: c.detail ?? 'any' }))
  const docs = useDocs.getState()
  const model = await docs.ensureModel(monaco.Uri.file(docs.root + '/' + t.key).toString())
  if (!model) return
  const after = s.range.end.line + 1
  const text = constructorFor(s.name, fields, WORDS)
  model.pushEditOperations([], [{ range: new monaco.Range(after, model.getLineMaxColumn(after), after, model.getLineMaxColumn(after)), text: '\n' + text.trimEnd() }], () => null)
  void docs.open(t.key, { line: after + 3, col: 1, preview: false })
}

async function generateTest(t: Target) {
  const f = t.func!
  const docs = useDocs.getState()
  const pid = docs.projectId
  if (!pid) return
  const testKey = t.key.replace(/\.go$/, '_test.go')
  const src = await docs.ensureModel(monaco.Uri.file(docs.root + '/' + t.key).toString())
  const pkg = /^package (\w+)/m.exec(src?.getValue() ?? '')?.[1] ?? 'main'
  const body = testFor(f.name, f.receiver, WORDS)
  let exists = true
  try {
    await api.Files.Read(pid, testKey)
  } catch {
    exists = false
  }
  if (!exists) {
    await api.Files.Write(pid, testKey, `package ${pkg}\n\nimport "testing"\n${body}`, 0)
    window.dispatchEvent(new CustomEvent('prumo:refresh-tree'))
  } else {
    const model = await docs.ensureModel(monaco.Uri.file(docs.root + '/' + testKey).toString())
    if (!model) return
    const last = model.getLineCount()
    model.pushEditOperations([], [{ range: new monaco.Range(last, model.getLineMaxColumn(last), last, model.getLineMaxColumn(last)), text: body }], () => null)
  }
  await docs.open(testKey, { preview: false })
  // Leva até o TODO do teste novo.
  const model = monaco.editor.getModel(monaco.Uri.file(docs.root + '/' + testKey))
  const m = model?.findMatches('// ' + WORDS.todo((f.receiver ? f.receiver + '.' : '') + f.name), false, false, true, null, false)
  const hit = m?.[m.length - 1]
  if (hit) void docs.open(testKey, { line: hit.range.startLineNumber, col: hit.range.startColumn, preview: false })
}

export function GenerateMenu() {
  const menu = useGenerate((s) => s.menu)
  if (!menu) return null
  const target = menu.target
  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      label={t('Gerar')}
      items={[
        { id: 'implement', label: target.struct ? t('Implementar interface em {name}…', { name: target.struct.name }) : t('Implementar interface (cursor num struct)'), disabled: !target.struct, icon: <Braces className="size-icon-sm" /> },
        { id: 'constructor', label: target.struct ? t('Construtor New{name}', { name: target.struct.name }) : t('Construtor (cursor num struct)'), disabled: !target.struct, icon: <Box className="size-icon-sm" /> },
        { id: 'test', label: target.func ? t('Teste para {name}', { name: (target.func.receiver ? target.func.receiver + '.' : '') + target.func.name }) : t('Teste (cursor numa função)'), disabled: !target.func, icon: <FlaskConical className="size-icon-sm" /> },
      ]}
      onAction={(id) => {
        if (id === 'implement') return useGenerate.setState({ implement: target })
        const run = id === 'constructor' ? generateConstructor(target) : generateTest(target)
        void run.catch((e) => toast('danger', t('Não foi possível gerar'), String((e as Error).message)))
      }}
      onClose={() => useGenerate.setState({ menu: null })}
    />
  )
}

// Interfaces comuns da biblioteca padrão, sugeridas antes de digitar.
const STD = ['fmt.Stringer', 'error', 'io.Reader', 'io.Writer', 'io.Closer', 'sort.Interface', 'json.Marshaler', 'http.Handler']

/** Implementar interface: escolhe a interface, escreve o "var _ I = (*T)(nil)" e aplica o quick-fix do gopls. */
export function ImplementDialog() {
  const target = useGenerate((s) => s.implement)
  const close = () => useGenerate.setState({ implement: null })
  const [name, setName] = useState('')
  const [found, setFound] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!target) return setName('')
    let stale = false
    const timer = setTimeout(async () => {
      const q = name.trim()
      const ws = q ? (await workspaceSymbols(q)).filter((s) => s.kind === 11).map((s) => s.name) : []
      if (!stale) setFound([...new Set([...ws, ...STD.filter((x) => !q || x.toLowerCase().includes(q.toLowerCase()))])].slice(0, 8))
    }, 150)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [name, target])
  const apply = async (iface: string) => {
    if (!target?.struct) return
    setBusy(true)
    try {
      await implementInterface(target, iface.trim())
      close()
    } catch (e) {
      toast('warning', t('Não foi possível implementar'), String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={target?.struct ? t('Implementar interface em {name}', { name: target.struct.name }) : t('Implementar interface')}
      isOpen={!!target}
      onOpenChange={(o) => !o && close()}
      footer={
        <>
          <Button onPress={close}>{t('Cancelar')}</Button>
          <Button variant="primary" loading={busy} isDisabled={!name.trim()} onPress={() => void apply(name)}>
            {t('Implementar')}
          </Button>
        </>
      }
    >
      <TextField label={t('Interface')} value={name} onChange={setName} placeholder={t('ex.: fmt.Stringer')} autoFocus onKeyDown={(e) => e.key === 'Enter' && name.trim() && void apply(name)} />
      {found.length > 0 && (
        <ul aria-label={t('Sugestões de interface')} className="mt-2 flex flex-wrap gap-1">
          {found.map((f) => (
            <li key={f}>
              <Button size="sm" onPress={() => setName(f)}>
                {f}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}

async function implementInterface(target: Target, iface: string) {
  if (!/^[A-Za-z_][\w]*(\.[A-Za-z_]\w*)?$/.test(iface)) throw new Error(t('nome de interface inválido'))
  const s = target.struct!
  const docs = useDocs.getState()
  const uri = monaco.Uri.file(docs.root + '/' + target.key).toString()
  const model = await docs.ensureModel(uri)
  if (!model) return
  await docs.open(target.key, { preview: false })
  const after = s.range.end.line + 1
  const line = `var _ ${iface} = (*${s.name})(nil)`
  model.pushEditOperations([], [{ range: new monaco.Range(after, model.getLineMaxColumn(after), after, model.getLineMaxColumn(after)), text: '\n\n' + line }], () => null)
  await formatBeforeSave(model) // traz o import (fmt, io...) se faltar
  // Espera o gopls acusar o que falta nessa linha e aplica a correção dele.
  const at = model.findMatches(line, false, false, true, null, false)[0]?.range
  if (!at) return
  const ed = currentEditor()
  ed?.setPosition({ lineNumber: at.startLineNumber, column: at.endColumn - 6 })
  ed?.focus()
  for (let i = 0; i < 40; i++) {
    const diags = useDiagnostics.getState().byUri[uri] ?? []
    if (diags.some((d) => d.range.start.line === at.startLineNumber - 1)) break
    await new Promise((r) => setTimeout(r, 250))
  }
  runAction(ed, 'editor.action.codeAction', { kind: 'quickfix', apply: 'first' })
}
