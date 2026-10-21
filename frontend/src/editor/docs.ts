// Documentos abertos: um modelo do Monaco por arquivo, abas, estado sujo, salvar com formatação.
import { create } from 'zustand'
import { api } from '../lib/api'
import { monaco } from './monaco'
import { toast } from '../design/feedback'
import { formatBeforeSave, notifySaved } from './lsp/adapter'
import { t } from '../i18n'

export interface Doc {
  key: string // caminho relativo ao projeto, ou "ext:<absoluto>" para arquivos de fora (somente leitura)
  title: string
  uri: string
  mtime: number
  savedVersion: number
  readOnly: boolean
  lineEnding: '\n' | '\r\n'
  status: 'ok' | 'binary' | 'tooLarge'
  dirty: boolean
}

// Diff: sem rev compara o último commit com o disco; com rev, o arquivo antes e depois daquele commit.
export type Tab = { kind: 'file'; key: string; preview: boolean } | { kind: 'diff'; key: string; path: string; rev?: string; oldPath?: string }

interface ConflictInfo {
  key: string
  diskMtime: number
}

interface DocsState {
  projectId: string | null
  root: string
  docs: Record<string, Doc>
  tabs: Tab[]
  active: string | null // key da aba ativa ("diff:<path>" para diffs)
  conflict: ConflictInfo | null
  reveal: { key: string; line: number; col: number; nonce: number } | null

  reset: (projectId: string | null, root: string) => void
  open: (key: string, opts?: { line?: number; col?: number; preview?: boolean }) => Promise<void>
  openUri: (uri: string, line?: number, col?: number) => Promise<boolean>
  ensureModel: (uri: string) => Promise<monaco.editor.ITextModel | null>
  openDiff: (path: string, commit?: { rev: string; oldPath?: string }) => Promise<void>
  close: (tabKey: string) => Promise<void>
  activate: (tabKey: string) => void
  pin: (key: string) => void
  /** Salva um arquivo. format: organizar imports e formatar antes (só no salvar explícito, Ctrl+S). */
  save: (key: string, opts?: { format?: boolean }) => Promise<boolean>
  saveAll: (opts?: { format?: boolean }) => Promise<void>
  /** Salvamento automático (sem formatar): perda de foco, ociosidade, antes de rodar/commitar/fechar. */
  autosave: () => Promise<void>
  anyDirty: () => boolean
  /** Relê do disco os arquivos abertos sem alteração pendente (depois de trocar de branch, atualizar...). */
  reloadFromDisk: () => Promise<void>
  resolveConflict: (keepMine: boolean) => Promise<void>
  markDirty: (key: string, dirty: boolean) => void
}

const languageOf = (path: string): string => {
  const ext = path.toLowerCase().split('.').pop() ?? ''
  const base = path.split('/').pop() ?? ''
  if (base === 'go.mod' || base === 'go.sum' || base === 'go.work') return 'plaintext'
  if (base === 'Dockerfile') return 'dockerfile'
  if (base === 'Makefile') return 'plaintext'
  const map: Record<string, string> = {
    go: 'go', md: 'markdown', yaml: 'yaml', yml: 'yaml', sh: 'shell', bash: 'shell', sql: 'sql', ts: 'typescript',
    tsx: 'typescript', js: 'javascript', mjs: 'javascript', json: 'json', html: 'html', css: 'css', proto: 'proto',
    toml: 'ini', ini: 'ini', xml: 'xml', py: 'python', txt: 'plaintext', mod: 'plaintext',
  }
  return map[ext] ?? 'plaintext'
}

export const tabKeyOf = (t: Tab) => (t.kind === 'diff' ? diffKey(t.path, t.rev) : t.key)
// rev "cmp:<branch>": o arquivo entre a branch atual e outra (comparar branches).
const diffKey = (path: string, rev?: string) => 'diff:' + (rev ? (rev.startsWith('cmp:') ? rev : rev.slice(0, 7)) + ':' : '') + path

const inflight = new Map<string, Promise<boolean>>()

export const useDocs = create<DocsState>((set, get) => {
  const uriFor = (key: string) => {
    if (key.startsWith('ext:')) return monaco.Uri.file(key.slice(4)).toString()
    return monaco.Uri.file(get().root + '/' + key).toString()
  }
  const keyForUri = (uri: string): string => {
    const path = monaco.Uri.parse(uri).fsPath.replace(/\\/g, '/')
    const root = get().root.replace(/\\/g, '/')
    return path.startsWith(root + '/') ? path.slice(root.length + 1) : 'ext:' + path
  }

  /** Carrega o arquivo e cria o modelo (sem aba). */
  const load = async (key: string): Promise<Doc | null> => {
    const existing = get().docs[key]
    if (existing) return existing
    const pid = get().projectId
    if (!pid) return null
    const fc = key.startsWith('ext:') ? await api.Files.ReadExternal(pid, key.slice(4)) : await api.Files.Read(pid, key)
    const uri = uriFor(key)
    const status: Doc['status'] = fc.binary ? 'binary' : fc.tooLarge ? 'tooLarge' : 'ok'
    let model = monaco.editor.getModel(monaco.Uri.parse(uri))
    if (!model) {
      model = monaco.editor.createModel(status === 'ok' ? fc.content : '', languageOf(key), monaco.Uri.parse(uri))
    }
    model.setEOL(fc.lineEnding === '\r\n' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF)
    const doc: Doc = {
      key,
      title: key.split('/').pop() ?? key,
      uri,
      mtime: fc.mtime,
      savedVersion: model.getAlternativeVersionId(),
      readOnly: fc.readOnly || status !== 'ok',
      lineEnding: fc.lineEnding,
      status,
      dirty: false,
    }
    model.onDidChangeContent(() => {
      const d = get().docs[key]
      if (d) get().markDirty(key, model!.getAlternativeVersionId() !== d.savedVersion)
    })
    set({ docs: { ...get().docs, [key]: doc } })
    return doc
  }

  const doSave = async (key: string, format: boolean): Promise<boolean> => {
    const d = get().docs[key]
    const pid = get().projectId
    if (!d || !pid || d.readOnly || key.startsWith('ext:')) return true
    const model = monaco.editor.getModel(monaco.Uri.parse(d.uri))
    if (!model) return true
    if (format && model.getLanguageId() === 'go') await formatBeforeSave(model)
    if (!format && !get().docs[key]?.dirty) return true // já gravado por quem estava na fila
    const version = model.getAlternativeVersionId()
    const res = await api.Files.Write(pid, key, model.getValue(), get().docs[key].mtime).catch((e) => {
      toast('danger', t('Não foi possível salvar {name}', { name: d.title }), String(e.message))
      return null
    })
    if (!res) return false
    if (res.conflict) {
      set({ conflict: { key, diskMtime: res.diskMtime } })
      return false
    }
    const cur = get().docs[key]
    set({
      docs: {
        ...get().docs,
        [key]: { ...cur, mtime: res.mtime, savedVersion: version, dirty: model.getAlternativeVersionId() !== version },
      },
    })
    notifySaved(model)
    return true
  }

  return {
    projectId: null,
    root: '',
    docs: {},
    tabs: [],
    active: null,
    conflict: null,
    reveal: null,

    reset: (projectId, root) => {
      // Só os modelos dos documentos (file://). Os do diff são do editor de diff, que cuida deles.
      for (const m of monaco.editor.getModels()) if (m.uri.scheme === 'file') m.dispose()
      set({ projectId, root, docs: {}, tabs: [], active: null, conflict: null, reveal: null })
    },

    open: async (key, opts = {}) => {
      try {
        await load(key)
      } catch (e) {
        toast('danger', t('Não foi possível abrir o arquivo'), String((e as Error).message))
        return
      }
      const tabs = get().tabs
      if (!tabs.some((t) => t.kind === 'file' && t.key === key)) {
        // Aba de preview: abrir outro arquivo em preview substitui a anterior.
        const preview = opts.preview ?? false
        const idx = preview ? tabs.findIndex((t) => t.kind === 'file' && t.preview) : -1
        const tab: Tab = { kind: 'file', key, preview }
        const next = [...tabs]
        if (idx >= 0) next.splice(idx, 1, tab)
        else {
          const at = tabs.findIndex((t) => tabKeyOf(t) === get().active)
          next.splice(at + 1, 0, tab)
        }
        set({ tabs: next })
      } else if (opts.preview === false) {
        get().pin(key)
      }
      set({ active: key })
      if (opts.line) set({ reveal: { key, line: opts.line, col: opts.col ?? 1, nonce: Date.now() } })
    },

    openUri: async (uri, line, col) => {
      const key = keyForUri(uri)
      await get().open(key, { line, col, preview: false })
      return !!get().docs[key]
    },

    ensureModel: async (uri) => {
      const existing = monaco.editor.getModel(monaco.Uri.parse(uri))
      if (existing) return existing
      try {
        const doc = await load(keyForUri(uri))
        return doc ? monaco.editor.getModel(monaco.Uri.parse(doc.uri)) : null
      } catch {
        return null
      }
    },

    openDiff: async (path, commit) => {
      const key = diffKey(path, commit?.rev)
      if (!get().tabs.some((t) => tabKeyOf(t) === key)) {
        set({ tabs: [...get().tabs, { kind: 'diff', key, path, rev: commit?.rev, oldPath: commit?.oldPath }] })
      }
      set({ active: key })
    },

    activate: (tabKey) => set({ active: tabKey }),

    pin: (key) => set({ tabs: get().tabs.map((t) => (t.kind === 'file' && t.key === key ? { ...t, preview: false } : t)) }),

    close: async (tabKey) => {
      const tab = get().tabs.find((t) => tabKeyOf(t) === tabKey)
      if (!tab) return
      // Como nas IDEs desktop, fechar não descarta: salva antes.
      if (tab.kind === 'file' && get().docs[tab.key]?.dirty) {
        const ok = await get().save(tab.key, { format: false })
        if (!ok) return
      }
      const tabs = get().tabs
      const i = tabs.indexOf(tab)
      const next = tabs.filter((t) => t !== tab)
      let active = get().active
      if (active === tabKey) {
        const neighbor = next[Math.min(i, next.length - 1)]
        active = neighbor ? tabKeyOf(neighbor) : null
      }
      set({ tabs: next, active })
    },

    markDirty: (key, dirty) => {
      const d = get().docs[key]
      if (!d || d.dirty === dirty) return
      set({ docs: { ...get().docs, [key]: { ...d, dirty } } })
      if (dirty) get().pin(key)
    },

    // Uma gravação por arquivo de cada vez: duas gravações simultâneas usariam o mesmo mtime esperado
    // e a segunda acusaria um conflito falso.
    save: (key, opts = {}) => {
      const prev = inflight.get(key) ?? Promise.resolve(true)
      const next = prev.then(() => doSave(key, opts.format ?? true))
      inflight.set(key, next)
      next.finally(() => inflight.get(key) === next && inflight.delete(key))
      return next
    },

    saveAll: async (opts = {}) => {
      for (const d of Object.values(get().docs)) {
        if (d.dirty) await get().save(d.key, opts)
      }
    },

    autosave: async () => {
      if (get().conflict) return // o usuário está decidindo um conflito: não grava nada por cima
      await get().saveAll({ format: false })
    },

    anyDirty: () => Object.values(get().docs).some((d) => d.dirty && !d.readOnly),

    reloadFromDisk: async () => {
      const pid = get().projectId
      if (!pid) return
      for (const d of Object.values(get().docs)) {
        if (d.dirty || d.key.startsWith('ext:') || d.status !== 'ok') continue
        const model = monaco.editor.getModel(monaco.Uri.parse(d.uri))
        if (!model) continue
        let fc
        try {
          fc = await api.Files.Read(pid, d.key)
        } catch {
          // Sumiu nesta branch: fecha a aba.
          const tab = get().tabs.find((t) => t.kind === 'file' && t.key === d.key)
          if (tab) await get().close(d.key)
          model.dispose()
          const { [d.key]: _, ...rest } = get().docs
          set({ docs: rest })
          continue
        }
        if (fc.mtime === d.mtime) continue
        if (model.getValue() !== fc.content) {
          // Como edição (dá para desfazer com Ctrl+Z), não setValue.
          model.pushEditOperations([], [{ range: model.getFullModelRange(), text: fc.content }], () => null)
        }
        const cur = get().docs[d.key]
        set({ docs: { ...get().docs, [d.key]: { ...cur, mtime: fc.mtime, savedVersion: model.getAlternativeVersionId(), dirty: false } } })
      }
    },

    resolveConflict: async (keepMine) => {
      const c = get().conflict
      const pid = get().projectId
      if (!c || !pid) return
      set({ conflict: null })
      const d = get().docs[c.key]
      const model = monaco.editor.getModel(monaco.Uri.parse(d.uri))
      if (!model) return
      if (keepMine) {
        set({ docs: { ...get().docs, [c.key]: { ...d, mtime: c.diskMtime } } })
        await get().save(c.key, { format: false })
      } else {
        const fc = await api.Files.Read(pid, c.key)
        model.setValue(fc.content)
        set({ docs: { ...get().docs, [c.key]: { ...d, mtime: fc.mtime, savedVersion: model.getAlternativeVersionId(), dirty: false } } })
      }
    },
  }
})
