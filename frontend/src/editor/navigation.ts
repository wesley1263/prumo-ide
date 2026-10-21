// Histórico de navegação: cada salto (outro arquivo, ou mais de 10 linhas) guarda o lugar de onde se saiu.
// Ctrl+Alt+← volta, Ctrl+Alt+→ vai para a frente; Ctrl+Shift+E lista os locais recentes.
import { create } from 'zustand'
import { useDocs } from './docs'
import { useCursor } from './EditorArea'

export interface Location {
  key: string
  line: number
  col: number
}

interface Nav {
  back: Location[]
  forward: Location[]
  recent: Location[] // mais recente primeiro, sem repetir a mesma linha
  popup: boolean
}

export const useNav = create<Nav>(() => ({ back: [], forward: [], recent: [], popup: false }))

const JUMP = 10
let last: Location | null = null
let moving = false // o salto vem do próprio voltar/avançar: não grava

const same = (a: Location, b: Location) => a.key === b.key && a.line === b.line

function remember(loc: Location) {
  const { back, recent } = useNav.getState()
  useNav.setState({
    back: [...back, loc].slice(-50),
    forward: [],
    recent: [loc, ...recent.filter((r) => !same(r, loc))].slice(0, 30),
  })
}

export function installNavigation(): () => void {
  useNav.setState({ back: [], forward: [], recent: [] })
  last = null
  const onMove = () => {
    const key = useDocs.getState().active
    if (!key || key.startsWith('diff:')) return
    const { line, col } = useCursor.getState()
    const here = { key, line, col }
    if (last && !moving && (last.key !== key || Math.abs(last.line - line) >= JUMP)) remember(last)
    last = here
    // Os recentes também guardam onde se está agora (atualiza a linha do mesmo arquivo).
  }
  const a = useCursor.subscribe(onMove)
  const b = useDocs.subscribe((s, prev) => s.active !== prev.active && onMove())
  return () => {
    a()
    b()
  }
}

async function go(loc: Location) {
  moving = true
  try {
    await useDocs.getState().open(loc.key, { line: loc.line, col: loc.col, preview: false })
  } finally {
    setTimeout(() => (moving = false), 50)
  }
}

export function navigateBack() {
  const { back, forward } = useNav.getState()
  const target = back.at(-1)
  if (!target) return
  useNav.setState({ back: back.slice(0, -1), forward: last ? [...forward, last] : forward })
  void go(target)
}

export function navigateForward() {
  const { back, forward } = useNav.getState()
  const target = forward.at(-1)
  if (!target) return
  useNav.setState({ forward: forward.slice(0, -1), back: last ? [...back, last] : back })
  void go(target)
}

export function openRecentLocations() {
  // Inclui onde se está agora, para a lista começar pelo ponto atual.
  if (last) {
    const { recent } = useNav.getState()
    useNav.setState({ recent: [last, ...recent.filter((r) => !same(r, last!))].slice(0, 30) })
  }
  useNav.setState({ popup: true })
}

export const goToLocation = go
