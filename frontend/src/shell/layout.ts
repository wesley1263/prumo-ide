// Layout das tool windows: qual está aberta em cada lado e os tamanhos.
import { create } from 'zustand'
import {
  Bell,
  BookOpen,
  Bug,
  CircleAlert,
  FlaskConical,
  FolderTree,
  GitBranch,
  GitCommitHorizontal,
  ListTree,
  Play,
  Search,
  ShieldCheck,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react'
import tokens from '../../../replica/design/tokens.json'
import { t } from '../i18n'

export type Side = 'left' | 'bottom' | 'right'

export interface ToolWindowDef {
  id: string
  title: string
  side: Side
  icon: LucideIcon
  keys?: string
  screen: string
}

export const toolWindows: ToolWindowDef[] = [
  { id: 'project', title: t('Projeto'), side: 'left', icon: FolderTree, keys: 'Alt+1', screen: 'S05' },
  { id: 'commit', title: t('Commit'), side: 'left', icon: GitCommitHorizontal, keys: 'Alt+0', screen: 'S20' },
  { id: 'structure', title: t('Estrutura'), side: 'left', icon: ListTree, keys: 'Alt+7', screen: 'S08' },
  { id: 'run', title: t('Executar'), side: 'bottom', icon: Play, keys: 'Alt+4', screen: 'S13' },
  { id: 'debug', title: t('Depurar'), side: 'bottom', icon: Bug, keys: 'Alt+5', screen: 'S15' },
  { id: 'tests', title: t('Testes'), side: 'bottom', icon: FlaskConical, keys: 'Alt+8', screen: 'S14' },
  { id: 'problems', title: t('Problemas'), side: 'bottom', icon: CircleAlert, keys: 'Alt+6', screen: 'S10' },
  { id: 'terminal', title: t('Terminal'), side: 'bottom', icon: SquareTerminal, keys: 'Alt+F12', screen: 'S19' },
  { id: 'find', title: t('Busca'), side: 'bottom', icon: Search, keys: 'Alt+3', screen: 'S09' },
  { id: 'git', title: 'Git', side: 'bottom', icon: GitBranch, keys: 'Alt+9', screen: 'S24' },
  { id: 'coverage', title: t('Cobertura'), side: 'right', icon: ShieldCheck, screen: 'S18' },
  { id: 'notifications', title: t('Notificações'), side: 'right', icon: Bell, screen: 'S30' },
  { id: 'documentation', title: t('Documentação'), side: 'right', icon: BookOpen, screen: 'S08' },
]

export const toolWindow = (id: string) => toolWindows.find((w) => w.id === id)!

const L = tokens.layout
export const sizeLimits = {
  left: { min: L['toolwindow-side-min'], def: L['toolwindow-side-default'], max: L['toolwindow-max'] },
  right: { min: L['toolwindow-side-min'], def: L['toolwindow-side-default'], max: L['toolwindow-max'] },
  bottom: { min: L['toolwindow-bottom-min'], def: L['toolwindow-bottom-default'], max: L['toolwindow-max'] },
}

/** Onde uma tool window fica: um dos lados ou flutuando sobre a janela. */
export type Place = Side | 'float'

export interface FloatBox {
  x: number
  y: number
  w: number
  h: number
}

interface LayoutState {
  open: Record<Side, string | null>
  sizes: Record<Side, number>
  /** Lado escolhido pelo usuário (o que não está aqui fica no lado padrão da janela). */
  placement: Record<string, Place>
  /** Janelas flutuantes abertas, da de baixo para a de cima. */
  floating: string[]
  floats: Record<string, FloatBox>
  focusRequest: { id: string; nonce: number } | null
  toggle: (id: string) => void
  show: (id: string) => void
  hide: (side: Side) => void
  /** Esconde a janela onde quer que ela esteja. */
  hideWindow: (id: string) => void
  moveTo: (id: string, place: Place) => void
  setFloat: (id: string, box: FloatBox) => void
  resize: (side: Side, px: number) => void
  restore: (s: Partial<Pick<LayoutState, 'open' | 'sizes' | 'placement' | 'floats'>>) => void
}

/** Onde a janela está agora. */
export const placeOf = (id: string): Place => useLayout.getState().placement[id] ?? toolWindow(id).side

const defaultFloat = (): FloatBox => {
  const w = Math.min(720, Math.round(window.innerWidth * 0.5))
  const h = Math.min(420, Math.round(window.innerHeight * 0.45))
  return { x: Math.round((window.innerWidth - w) / 2), y: Math.round((window.innerHeight - h) / 3), w, h }
}

export const useLayout = create<LayoutState>((set, get) => ({
  open: { left: 'project', bottom: null, right: null },
  sizes: { left: sizeLimits.left.def, bottom: sizeLimits.bottom.def, right: sizeLimits.right.def },
  placement: {},
  floating: [],
  floats: {},
  focusRequest: null,
  toggle: (id) => {
    const place = placeOf(id)
    const isOpen = place === 'float' ? get().floating.includes(id) : get().open[place] === id
    if (isOpen) get().hideWindow(id)
    else get().show(id)
  },
  show: (id) => {
    const place = placeOf(id)
    if (place === 'float') {
      set({
        floating: [...get().floating.filter((x) => x !== id), id], // vem para cima
        floats: get().floats[id] ? get().floats : { ...get().floats, [id]: defaultFloat() },
        focusRequest: { id, nonce: Date.now() },
      })
      return
    }
    set({ open: { ...get().open, [place]: id }, focusRequest: { id, nonce: Date.now() } })
  },
  hide: (side) => set({ open: { ...get().open, [side]: null } }),
  hideWindow: (id) => {
    const place = placeOf(id)
    if (place === 'float') set({ floating: get().floating.filter((x) => x !== id) })
    else if (get().open[place] === id) get().hide(place)
  },
  moveTo: (id, place) => {
    get().hideWindow(id)
    const placement = { ...get().placement }
    if (place === toolWindow(id).side) delete placement[id]
    else placement[id] = place
    set({ placement })
    get().show(id)
  },
  setFloat: (id, box) => set({ floats: { ...get().floats, [id]: box } }),
  resize: (side, px) => set({ sizes: { ...get().sizes, [side]: px } }),
  restore: (s) =>
    set({
      open: { ...get().open, ...(s.open ?? {}) },
      sizes: { ...get().sizes, ...(s.sizes ?? {}) },
      placement: { ...get().placement, ...(s.placement ?? {}) },
      floats: { ...get().floats, ...(s.floats ?? {}) },
    }),
}))
