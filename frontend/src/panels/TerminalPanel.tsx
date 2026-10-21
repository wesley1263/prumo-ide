// S19 Terminal: shells do usuário na pasta do projeto, um por aba. O shell vive no backend; esta janela só
// mostra (xterm.js) e manda teclas pelo WebSocket /term/{id}. Esconder a janela ou recarregar não mata nada.
import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Terminal as XTerm, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { create } from 'zustand'
import { api, bridgeWsUrl, type TermInfo } from '../lib/api'
import { on } from '../lib/events'
import { IconButton, Button } from '../design/controls'
import { EmptyState, Spinner, toast } from '../design/feedback'
import { cn } from '../design/cn'
import { ToolWindowFrame } from '../shell/ToolWindows'
import { useApp } from '../state/app'
import { useDocs } from '../editor/docs'
import { keyLabel } from '../lib/keymap'
import { usePrefs } from '../state/settings'
import tokens from '../../design/tokens.json'
import { t } from '../i18n'

// A aba escolhida sobrevive a esconder/mostrar a janela.
const useTerms = create<{ list: TermInfo[]; active: string | null; loaded: string | null }>(() => ({ list: [], active: null, loaded: null }))

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const

/** Tema do xterm a partir dos tokens (variáveis CSS do tema atual). */
function xtermTheme(): ITheme {
  const css = getComputedStyle(document.documentElement)
  const v = (n: string) => css.getPropertyValue(`--color-${n}`).trim()
  const theme: Record<string, string> = {
    background: v('bg'),
    foreground: v('text'),
    cursor: v('text'),
    cursorAccent: v('bg'),
    selectionBackground: v('selection'),
    selectionInactiveBackground: v('selection-inactive'),
  }
  for (const c of ANSI) {
    theme[c] = v(`ansi-${c}`)
    theme['bright' + c[0].toUpperCase() + c.slice(1)] = v(`ansi-bright-${c}`)
  }
  return theme
}

// arquivo.go:linha[:coluna], relativo à raiz do projeto ou absoluto dentro dela.
const FILE_REF = /(?:\.\/)?[\w\-./]+\.go:\d+(?::\d+)?/

async function refresh(projectId: string) {
  const list = await api.Terminal.List(projectId)
  const { active } = useTerms.getState()
  useTerms.setState({ list, loaded: projectId, active: list.some((t) => t.id === active) ? active : (list.at(-1)?.id ?? null) })
  return list
}

export function TerminalPanel() {
  const project = useApp((s) => s.project)!
  const askTrust = () => useApp.setState({ trustAsked: true })
  const { list, active, loaded } = useTerms()
  const [creating, setCreating] = useState(false)

  const newTerminal = async () => {
    if (!project.trusted) return askTrust()
    setCreating(true)
    try {
      const info = await api.Terminal.Create(project.id, 80, 24)
      useTerms.setState((s) => ({ list: [...s.list, info], active: info.id }))
    } catch (e) {
      toast('danger', t('Não foi possível abrir o terminal'), (e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const closeTerminal = async (id: string) => {
    await api.Terminal.Close(id).catch(() => {})
    const rest = useTerms.getState().list.filter((t) => t.id !== id)
    useTerms.setState((s) => ({ list: rest, active: s.active === id ? (rest.at(-1)?.id ?? null) : s.active }))
  }

  // Carrega os terminais do projeto e, como nas IDEs desktop, abre um se não houver nenhum.
  useEffect(() => {
    let alive = true
    void refresh(project.id).then((l) => {
      if (alive && l.length === 0 && project.trusted) void newTerminal()
    })
    const off = on('term:state', (t) => t.projectId === project.id && void refresh(project.id))
    return () => {
      alive = false
      off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.trusted])

  const actions = (
    <div className="flex min-w-0 items-center gap-1">
      <div role="tablist" aria-label={t('Terminais')} className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {list.map((tm) => (
          <div
            key={tm.id}
            role="tab"
            aria-selected={tm.id === active}
            tabIndex={0}
            onClick={() => useTerms.setState({ active: tm.id })}
            onKeyDown={(e) => e.key === 'Enter' && useTerms.setState({ active: tm.id })}
            className={cn(
              'group flex h-control-sm shrink-0 items-center gap-1.5 rounded-md px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-focus',
              tm.id === active ? 'bg-selection text-text' : 'text-text-muted hover:bg-hover',
              tm.exited && 'italic',
            )}
          >
            <span>{tm.title}</span>
            {tm.exited && <span className="sr-only">{t('(encerrado)')}</span>}
            <span
              aria-hidden
              title={t('Fechar {name}', { name: tm.title })}
              onClick={(e) => (e.stopPropagation(), void closeTerminal(tm.id))}
              className="rounded-xs opacity-0 hover:bg-pressed group-hover:opacity-100 group-aria-selected:opacity-100"
            >
              <X className="size-3" />
            </span>
          </div>
        ))}
      </div>
      <IconButton label={t('Novo terminal')} shortcut={keyLabel('Mod+Shift+T')} size="sm" icon={<Plus className="size-icon-sm" />} isDisabled={creating} onPress={newTerminal} />
      {active && <IconButton label={t('Fechar terminal')} size="sm" icon={<X className="size-icon-sm" />} onPress={() => closeTerminal(active)} />}
    </div>
  )

  let body
  if (!project.trusted) {
    body = (
      <EmptyState title={t('Terminal desligado no modo restrito')} actions={<Button onPress={askTrust}>{t('Confiar no projeto…')}</Button>}>
        {t('O shell pode carregar arquivos do projeto (.envrc, hooks). Confie no projeto para usar o terminal.')}
      </EmptyState>
    )
  } else if (loaded !== project.id || (creating && list.length === 0)) {
    body = (
      <div className="flex h-full items-center justify-center">
        <Spinner label={t('Abrindo o terminal')} />
      </div>
    )
  } else if (list.length === 0) {
    body = (
      <EmptyState title={t('Nenhum terminal aberto')} actions={<Button onPress={newTerminal}>{t('Novo terminal')}</Button>}>
        {t('{key} abre outro terminal.', { key: keyLabel('Mod+Shift+T') ?? '' })}
      </EmptyState>
    )
  } else {
    body = (
      <div className="relative h-full bg-bg">
        {list.map((t) => (
          <TerminalView key={t.id} info={t} visible={t.id === active} onNew={newTerminal} />
        ))}
      </div>
    )
  }
  return (
    <ToolWindowFrame side="bottom" actions={actions}>
      {body}
    </ToolWindowFrame>
  )
}

function TerminalView({ info, visible, onNew }: { info: TermInfo; visible: boolean; onNew: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<XTerm | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const theme = useApp((s) => s.theme)
  const root = useApp((s) => s.project?.rootPath ?? '')

  useEffect(() => {
    const t = new XTerm({
      fontFamily: tokens.font.mono,
      fontSize: usePrefs.getState()['editor.fontSize'],
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 10_000,
      allowProposedApi: false,
      theme: xtermTheme(),
      screenReaderMode: false,
    })
    const f = new FitAddon()
    t.loadAddon(f)
    // arquivo.go:linha abre no editor (Ctrl+clique); URLs abrem no navegador.
    t.loadAddon(new WebLinksAddon((e, uri) => (e.ctrlKey || e.metaKey) && window.open(uri, '_blank', 'noopener')))
    t.registerLinkProvider({
      provideLinks(y, callback) {
        const line = t.buffer.active.getLine(y - 1)?.translateToString(true) ?? ''
        const re = new RegExp(FILE_REF.source, 'g')
        const links = []
        for (let m; (m = re.exec(line)); ) {
          const text = m[0]
          const [path, ln, col] = text.split(':')
          let rel = path.replace(/^\.\//, '')
          if (rel.startsWith(root + '/')) rel = rel.slice(root.length + 1)
          if (rel.startsWith('/')) continue // fora do projeto
          links.push({
            range: { start: { x: m.index + 1, y }, end: { x: m.index + text.length, y } },
            text,
            activate: (e: MouseEvent) => {
              if (!(e.ctrlKey || e.metaKey)) return
              void useDocs.getState().open(rel, { line: Number(ln), col: col ? Number(col) : 1, preview: false })
            },
          })
        }
        callback(links)
      },
    })
    // Copiar/colar de terminal (Ctrl+Shift+C/V); Ctrl+C continua indo para o shell.
    t.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey) return true
      if (e.code === 'KeyC' && t.hasSelection()) {
        void navigator.clipboard?.writeText(t.getSelection())
        return false
      }
      if (e.code === 'KeyV') {
        void navigator.clipboard?.readText().then((s) => s && t.paste(s))
        return false
      }
      return true
    })
    t.open(host.current!)
    t.element?.setAttribute('aria-label', `Terminal ${info.title}`)
    term.current = t
    fit.current = f

    const ws = new WebSocket(bridgeWsUrl(`/term/${info.id}`))
    ws.binaryType = 'arraybuffer'
    const sendResize = () => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ resize: [t.cols, t.rows] }))
    // O que for digitado antes da conexão abrir espera aqui (não se perde).
    const pending: Uint8Array[] = []
    const send = (b: Uint8Array) => (ws.readyState === WebSocket.OPEN ? ws.send(b) : ws.readyState === WebSocket.CONNECTING && pending.push(b))
    ws.onopen = () => {
      try {
        f.fit()
      } catch {
        /* escondido: sem tamanho ainda */
      }
      sendResize()
      for (const b of pending.splice(0)) ws.send(b)
    }
    ws.onmessage = (e) => t.write(new Uint8Array(e.data as ArrayBuffer))
    const enc = new TextEncoder()
    const d1 = t.onData((s) => send(enc.encode(s)))
    const d2 = t.onBinary((s) => send(Uint8Array.from(s, (c) => c.charCodeAt(0))))
    const d3 = t.onResize(sendResize)

    const ro = new ResizeObserver(() => {
      if (host.current?.offsetParent) {
        try {
          f.fit()
        } catch {
          /* ignora */
        }
      }
    })
    ro.observe(host.current!)
    return () => {
      ro.disconnect()
      d1.dispose()
      d2.dispose()
      d3.dispose()
      ws.close()
      t.dispose()
      term.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.id])

  useEffect(() => {
    if (term.current) term.current.options.theme = xtermTheme()
  }, [theme])

  const fontSize = usePrefs((s) => s['editor.fontSize'])
  useEffect(() => {
    if (!term.current || term.current.options.fontSize === fontSize) return
    term.current.options.fontSize = fontSize
    try {
      fit.current?.fit()
    } catch {
      /* escondido */
    }
  }, [fontSize])

  useEffect(() => {
    if (!visible || !term.current) return
    requestAnimationFrame(() => {
      try {
        fit.current?.fit()
      } catch {
        /* ignora */
      }
      term.current?.focus()
    })
  }, [visible])

  return (
    <div
      className={cn('absolute inset-0 px-2 py-1', !visible && 'hidden')}
      data-terminal={info.id}
      onKeyDown={(e) => {
        // Novo terminal sem sair do terminal.
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyT') {
          e.preventDefault()
          onNew()
        }
      }}
    >
      <div ref={host} className="h-full w-full" />
    </div>
  )
}
