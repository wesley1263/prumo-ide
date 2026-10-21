// S11 Prévia do rename: quando o novo nome mexe em mais de um arquivo, mostra cada mudança antes de aplicar.
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { setRenamePreview, type RenameChange } from './lsp/adapter'
import { useDocs } from './docs'
import { Button } from '../design/controls'
import { Dialog } from '../design/feedback'
import { t, tn } from '../i18n'

interface Line {
  line: number
  before: string
  after: string
}
interface FileChanges {
  path: string
  lines: Line[]
}
interface Pending {
  oldName: string
  newName: string
  files: FileChanges[]
  total: number
  resolve: (ok: boolean) => void
}

const usePreview = create<{ pending: Pending | null }>(() => ({ pending: null }))

/** Monta, por arquivo, cada linha como está e como fica (as mudanças de uma linha aplicadas juntas). */
async function describe(changes: RenameChange[]): Promise<FileChanges[]> {
  const docs = useDocs.getState()
  const root = 'file://' + docs.root + '/'
  const byUri = new Map<string, RenameChange[]>()
  for (const c of changes) byUri.set(c.uri, [...(byUri.get(c.uri) ?? []), c])
  const out: FileChanges[] = []
  for (const [uri, list] of byUri) {
    const model = await docs.ensureModel(uri)
    const lines = new Map<number, RenameChange[]>()
    for (const c of list) lines.set(c.range.start.line, [...(lines.get(c.range.start.line) ?? []), c])
    const desc: Line[] = []
    for (const [ln, cs] of [...lines.entries()].sort((a, b) => a[0] - b[0])) {
      const before = model?.getLineContent(ln + 1) ?? ''
      let after = before
      // Do fim para o começo: as colunas das mudanças anteriores continuam valendo.
      for (const c of [...cs].sort((a, b) => b.range.start.character - a.range.start.character)) {
        const end = c.range.end.line === ln ? c.range.end.character : before.length
        after = after.slice(0, c.range.start.character) + c.newText + after.slice(end)
      }
      desc.push({ line: ln + 1, before: before.trim(), after: after.trim() })
    }
    const decoded = decodeURIComponent(uri)
    out.push({ path: decoded.startsWith(root) ? decoded.slice(root.length) : decoded, lines: desc })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

export function RenamePreview() {
  const pending = usePreview((s) => s.pending)
  useEffect(() => {
    setRenamePreview(
      ({ oldName, newName, changes }) =>
        new Promise<boolean>((resolve) => {
          void describe(changes).then((files) => usePreview.setState({ pending: { oldName, newName, files, total: changes.length, resolve } }))
        }),
    )
    return () => setRenamePreview(null)
  }, [])
  const [busy, setBusy] = useState(false)
  const answer = (ok: boolean) => {
    if (!pending) return
    setBusy(ok)
    pending.resolve(ok)
    usePreview.setState({ pending: null })
    setBusy(false)
  }
  return (
    <Dialog
      title={pending ? t('Renomear {old} para {new}', { old: pending.oldName, new: pending.newName }) : t('Renomear')}
      isOpen={!!pending}
      onOpenChange={(o) => !o && answer(false)}
      size="lg"
      footer={
        <>
          <Button onPress={() => answer(false)}>{t('Cancelar')}</Button>
          <Button variant="primary" loading={busy} onPress={() => answer(true)}>
            {t('Renomear')}
          </Button>
        </>
      }
    >
      {pending && (
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          <p role="status" className="text-xs text-text-muted">
            {tn(pending.total, '{n} mudança em {files} arquivos. Os arquivos fechados são abertos e ficam com a mudança para salvar (Ctrl+S).', '{n} mudanças em {files} arquivos. Os arquivos fechados são abertos e ficam com a mudança para salvar (Ctrl+S).', { files: pending.files.length })}
          </p>
          <ul aria-label={t('Mudanças do rename')} className="flex flex-col gap-2">
            {pending.files.map((f) => (
              <li key={f.path}>
                <p className="text-sm font-semibold text-text">
                  {f.path} <span className="font-normal text-text-muted">({f.lines.length})</span>
                </p>
                <ul className="mt-1 flex flex-col">
                  {f.lines.map((l) => (
                    <li key={l.line} className="grid grid-cols-[3rem_1fr] gap-x-2 font-mono text-xs">
                      <span className="row-span-2 text-right tabular-nums text-text-muted">{l.line}</span>
                      <span className="truncate text-vcs-deleted line-through" aria-label={t('antes: {text}', { text: l.before })}>
                        {l.before}
                      </span>
                      <span className="truncate text-vcs-added" aria-label={t('depois: {text}', { text: l.after })}>
                        {l.after}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  )
}
