// Estado dos popups de busca (S06 Buscar em tudo, S07 Buscar nos arquivos) e a lista de arquivos recentes.
import { create } from 'zustand'
import { useDocs } from '../editor/docs'

export type EverywhereTab = 'all' | 'files' | 'symbols' | 'actions'

interface SearchUi {
  everywhere: EverywhereTab | null // aba aberta; null = fechado
  find: { replace: boolean; seed: string } | null // seed: texto selecionado no editor ao abrir
  recent: string[] // arquivos (chave do doc), o mais recente primeiro
  openEverywhere: (tab: EverywhereTab) => void
  closeEverywhere: () => void
  openFind: (replace: boolean, seed?: string) => void
  closeFind: () => void
}

export const useSearchUi = create<SearchUi>((set) => ({
  everywhere: null,
  find: null,
  recent: [],
  openEverywhere: (tab) => set({ everywhere: tab }),
  closeEverywhere: () => set({ everywhere: null }),
  openFind: (replace, seed = '') => set({ find: { replace, seed }, everywhere: null }),
  closeFind: () => set({ find: null }),
}))

/** Acompanha a aba ativa para montar os recentes (vazio do Buscar em tudo). */
export function trackRecentFiles(): () => void {
  useSearchUi.setState({ recent: [] })
  return useDocs.subscribe((s, prev) => {
    const key = s.active
    if (!key || key === prev.active || key.startsWith('diff:') || key.startsWith('ext:')) return
    const list = useSearchUi.getState().recent.filter((k) => k !== key)
    useSearchUi.setState({ recent: [key, ...list].slice(0, 30) })
  })
}

/** Ignora acentos e maiúsculas (achar "Depurar" digitando "depu", "Ações" digitando "acoes"). */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** "cart.go:22" ou "cart.go:22:5" → consulta e posição. */
export function splitLine(q: string): { query: string; line?: number; col?: number } {
  const m = /^(.*?):(\d+)(?::(\d+))?$/.exec(q.trim())
  if (!m || !m[1]) return { query: q.trim() }
  return { query: m[1], line: Number(m[2]), col: m[3] ? Number(m[3]) : undefined }
}
