// Comparar a branch atual com outra: os commits que só a outra tem, os que só a atual tem e os arquivos que
// diferem (duplo clique abre o diff do arquivo entre as duas).
import { useEffect, useState } from 'react'
import { api, type BranchCompare } from '../lib/api'
import { Dialog, EmptyState, Spinner } from '../design/feedback'
import { Button } from '../design/controls'
import { useApp } from '../state/app'
import { useBranchCompare } from '../state/git'
import { useDocs } from '../editor/docs'
import { formatDate } from '../panels/GitLogPanel'
import { t } from '../i18n'

const kindLabel = { added: t('adicionado'), modified: t('modificado'), deleted: t('apagado'), renamed: t('renomeado') }

export function BranchCompareDialog() {
  const other = useBranchCompare((s) => s.other)
  const project = useApp((s) => s.project)
  const [data, setData] = useState<BranchCompare | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setData(null)
    setError(null)
    if (!other || !project) return
    api.Git.CompareBranches(project.id, other).then(setData, (e) => setError(String((e as Error).message)))
  }, [other, project])
  const close = () => useBranchCompare.setState({ other: null })
  const openFile = (path: string, oldPath?: string) => {
    close()
    void useDocs.getState().openDiff(path, { rev: 'cmp:' + other, oldPath })
  }
  const Commits = ({ title, list }: { title: string; list: BranchCompare['onlyOther'] }) => (
    <section aria-label={title} className="min-w-0 flex-1">
      <h3 className="mb-1 text-xs font-semibold text-text-muted">
        {title} ({list.length})
      </h3>
      {list.length === 0 ? (
        <p className="text-xs text-text-muted">{t('Nenhum.')}</p>
      ) : (
        <ul className="flex max-h-[12rem] flex-col overflow-y-auto">
          {list.map((c) => (
            <li key={c.hash} className="flex gap-2 text-sm">
              <span className="shrink-0 font-mono text-xs text-text-muted">{c.hash.slice(0, 7)}</span>
              <span className="truncate text-text">{c.subject}</span>
              <span className="ml-auto shrink-0 text-xs text-text-muted">{formatDate(c.date)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
  return (
    <Dialog title={other && data ? `${data.current} ↔ ${other}` : t('Comparar com {name}', { name: other ?? '' })} isOpen={!!other} onOpenChange={(o) => !o && close()} size="lg" footer={<Button onPress={close}>{t('Fechar')}</Button>}>
      {error ? (
        <EmptyState title={t('Não foi possível comparar')}>{error}</EmptyState>
      ) : !data ? (
        <div className="flex justify-center p-4">
          <Spinner label={t('Comparando')} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex gap-4">
            <Commits title={t('Só em {name}', { name: data.other })} list={data.onlyOther} />
            <Commits title={t('Só em {name}', { name: data.current })} list={data.onlyCurrent} />
          </div>
          {data.truncated && <p className="text-xs text-text-muted">{t('Lista cortada nos 300 commits mais novos de cada lado.')}</p>}
          <section aria-label={t('Arquivos diferentes')}>
            <h3 className="mb-1 text-xs font-semibold text-text-muted">{t('Arquivos diferentes ({n}) · duplo clique abre o diff', { n: data.files.length })}</h3>
            <ul className="flex max-h-[14rem] flex-col overflow-y-auto">
              {data.files.map((f) => (
                <li key={f.path}>
                  <button
                    type="button"
                    disabled={f.outside}
                    onDoubleClick={() => openFile(f.path, f.oldPath || undefined)}
                    onKeyDown={(e) => e.key === 'Enter' && openFile(f.path, f.oldPath || undefined)}
                    aria-label={`${f.path}, ${kindLabel[f.kind]}`}
                    className="flex h-row w-full items-center gap-2 rounded-sm px-1 text-left text-sm hover:bg-hover focus-visible:bg-selection focus-visible:outline-none"
                  >
                    <span className="truncate text-text">{f.path}</span>
                    <span className="ml-auto shrink-0 text-xs text-text-muted">{kindLabel[f.kind]}</span>
                  </button>
                </li>
              ))}
              {data.files.length === 0 && <li className="text-xs text-text-muted">{t('O conteúdo é o mesmo.')}</li>}
            </ul>
          </section>
        </div>
      )}
    </Dialog>
  )
}
