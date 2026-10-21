// Página #design: todas as primitivas, nos dois temas, lado a lado. É a checagem do sistema de design.
import { useState } from 'react'
import { FileCode2, Folder, Play, RefreshCw, Settings } from 'lucide-react'
import { Badge, Button, Checkbox, IconButton, Kbd, Menu, TextArea, TextField, Tooltip } from './controls'
import { Banner, Dialog, EmptyState, ProgressBar, Spinner, Splitter, TreeView, toast, type TreeNode } from './feedback'
import tokens from '../../design/tokens.json'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</h2>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </section>
  )
}

const tree: TreeNode[] = [
  {
    id: 'cmd',
    label: 'cmd',
    textValue: 'cmd',
    isLeaf: false,
    icon: <Folder className="size-icon text-text-muted" />,
    children: [{ id: 'cmd/main.go', label: 'main.go', textValue: 'main.go', isLeaf: true, icon: <FileCode2 className="size-icon text-accent-text" />, className: 'text-vcs-modified' }],
  },
  { id: 'internal', label: 'internal', textValue: 'internal', isLeaf: false, icon: <Folder className="size-icon text-text-muted" /> },
  { id: 'go.mod', label: 'go.mod', textValue: 'go.mod', isLeaf: true, icon: <FileCode2 className="size-icon text-text-muted" /> },
  { id: 'NOTES.md', label: 'NOTES.md', textValue: 'NOTES.md', isLeaf: true, className: 'text-vcs-unversioned', icon: <FileCode2 className="size-icon text-text-muted" /> },
]

function Gallery() {
  const [name, setName] = useState('')
  const [checked, setChecked] = useState(true)
  const [dialog, setDialog] = useState(false)
  const [expanded, setExpanded] = useState(new Set(['cmd']))
  const [selected, setSelected] = useState<string | null>('cmd/main.go')
  const [width, setWidth] = useState(160)
  return (
    <div className="flex flex-col gap-6 bg-surface p-6 text-text">
      <Section title="Botões">
        <Button variant="primary">Commit</Button>
        <Button>Cancelar</Button>
        <Button variant="ghost">Detalhes</Button>
        <Button variant="danger">Descartar</Button>
        <Button variant="primary" loading>
          Salvando
        </Button>
        <Button isDisabled>Indisponível</Button>
        <Button size="sm">Pequeno</Button>
        <Button size="lg" variant="primary" icon={<Play className="size-icon" />}>
          Rodar
        </Button>
      </Section>
      <Section title="Botões de ícone">
        <IconButton label="Rodar" shortcut="Shift+F10" icon={<Play className="size-icon text-success" />} />
        <IconButton label="Atualizar" icon={<RefreshCw className="size-icon" />} />
        <IconButton label="Ativo" toggled icon={<Settings className="size-icon" />} />
        <IconButton label="Desligado" isDisabled icon={<Settings className="size-icon" />} />
        <Tooltip content="Dica com atalho" shortcut="Ctrl+K">
          <Button>Passe o mouse</Button>
        </Tooltip>
        <Kbd>Ctrl+Shift+F</Kbd>
      </Section>
      <Section title="Campos">
        <TextField label="Nome da branch" value={name} onChange={setName} placeholder="feat/minha-mudanca" className="w-dialog-sm max-w-full" />
        <TextField label="Com erro" value="feat/ nome" onChange={() => {}} error="Nome de branch inválido" className="w-dialog-sm max-w-full" />
        <TextArea label="Mensagem do commit" value="" onChange={() => {}} placeholder="Mensagem do commit" className="w-dialog-sm max-w-full" rows={3} />
        <div className="flex flex-col gap-2">
          <Checkbox isSelected={checked} onChange={setChecked}>
            Marcado
          </Checkbox>
          <Checkbox isIndeterminate>Parcial</Checkbox>
          <Checkbox>Desmarcado</Checkbox>
          <Checkbox isDisabled>Desligado</Checkbox>
        </div>
      </Section>
      <Section title="Menus, badges, diálogo, balões">
        <Menu
          label="Exemplo"
          trigger={<Button>Abrir menu</Button>}
          items={[
            { id: 'a', label: 'Commit…', shortcut: 'Ctrl+K' },
            { id: 'b', label: 'Atualizar' },
            { id: 'c', label: 'Push…', disabled: true, separatorBefore: true },
            { id: 'd', label: 'Apagar branch', danger: true },
          ]}
          onAction={() => {}}
        />
        <Badge>3</Badge>
        <Badge tone="info">main</Badge>
        <Badge tone="success">passou</Badge>
        <Badge tone="warning">aviso</Badge>
        <Badge tone="danger">falhou</Badge>
        <Button onPress={() => setDialog(true)}>Abrir diálogo</Button>
        <Button onPress={() => toast('success', 'Commit a1b2c3d criado', 'catálogo e carrinho')}>Balão de sucesso</Button>
        <Button onPress={() => toast('danger', 'O push foi recusado', 'O remoto tem commits que você não tem.')}>Balão de erro</Button>
        <Dialog
          title="Confiar neste projeto?"
          isOpen={dialog}
          onOpenChange={setDialog}
          footer={
            <>
              <Button onPress={() => setDialog(false)}>Modo restrito</Button>
              <Button variant="primary" onPress={() => setDialog(false)}>
                Confiar
              </Button>
            </>
          }
        >
          Exemplo de diálogo modal com foco preso e Esc para fechar.
        </Dialog>
      </Section>
      <Section title="Avisos e progresso">
        <div className="flex w-full flex-col gap-1">
          <Banner level="info">Arquivo de fora do projeto, aberto só para leitura.</Banner>
          <Banner level="warning">Modo restrito: análise de código, execução e commit estão desligados.</Banner>
          <Banner level="danger">Análise de código indisponível: o gopls caiu.</Banner>
          <Banner level="success">Todos os testes passaram.</Banner>
        </div>
        <ProgressBar label="Indexando" value={40} />
        <ProgressBar label="Iniciando" />
        <Spinner label="Carregando" />
      </Section>
      <Section title="Árvore, divisória, estado vazio">
        <div className="flex h-toolwindow-bottom-default rounded-md border border-border bg-surface">
          <div style={{ width }} className="overflow-auto">
            <TreeView
              label="Exemplo de árvore"
              roots={tree}
              expanded={expanded}
              onToggle={(n, open) => setExpanded((e) => (open ? new Set([...e, n.id]) : new Set([...e].filter((x) => x !== n.id))))}
              selected={selected}
              onSelect={(n) => setSelected(n.id)}
              onActivate={() => {}}
            />
          </div>
          <Splitter orientation="vertical" label="Largura do exemplo" value={width} min={120} max={320} defaultValue={160} onChange={setWidth} />
          <div className="w-dialog-sm">
            <EmptyState title="Nada para commitar" actions={<Button size="sm">Atualizar</Button>}>
              Tudo igual ao último commit em main.
            </EmptyState>
          </div>
        </div>
      </Section>
      <Section title="Cores de sintaxe e de status">
        {(['syntax-keyword', 'syntax-type', 'syntax-function', 'syntax-string', 'syntax-number', 'syntax-comment', 'syntax-param', 'syntax-field'] as const).map((k) => (
          <code key={k} className="rounded-sm bg-bg px-2 py-1 font-mono text-code" style={{ color: `var(--color-${k})` }}>
            {k.replace('syntax-', '')}
          </code>
        ))}
        {(['vcs-added', 'vcs-modified', 'vcs-unversioned', 'vcs-deleted', 'coverage-partial', 'breakpoint'] as const).map((k) => (
          <span key={k} className="text-sm" style={{ color: `var(--color-${k})` }}>
            {k}
          </span>
        ))}
      </Section>
    </div>
  )
}

export function DesignPage() {
  return (
    <div className="h-full overflow-auto bg-chrome">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <h1 className="text-lg text-text">Sistema de design · {Object.keys(tokens.color.dark).length} papéis de cor por tema</h1>
        <a href="#" className="text-sm text-accent-text underline underline-offset-2">
          Voltar
        </a>
      </header>
      <div className="grid grid-cols-1 xl:grid-cols-2">
        <div data-theme="dark">
          <Gallery />
        </div>
        <div data-theme="light">
          <Gallery />
        </div>
      </div>
    </div>
  )
}
