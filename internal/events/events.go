// Package events leva notificações do backend para a UI.
//
// Em produção o destino é o runtime do Wails (EventsEmit); no modo dev, o WebSocket /events
// da ponte local. O backend só conhece o Bus.
package events

import "sync"

// Nomes dos eventos. A fonte única; o frontend espelha em src/lib/events.ts.
const (
	GitStatus     = "git:status"        // {projectId}
	LspState      = "lsp:state"         // {projectId, state, message}
	RunState      = "run:state"         // {runId, projectId, state, exitCode}
	FsChanged     = "fs:changed"        // {projectId, paths}
	Notify        = "notify"            // {level, title, body}
	ToolsStatus   = "tools:status"      // ToolsStatus
	BeforeClose   = "app:before-close"  // {} — a janela vai fechar: a UI salva tudo e chama App.Quit
	DebugState    = "debug:state"       // debug.Info
	Breakpoints   = "debug:breakpoints" // {projectId}
	TestUpdate    = "test:update"       // {runId, projectId}: a árvore de testes mudou
	SearchUpdate  = "search:update"     // {id, projectId, count, done}: a busca de texto tem resultados novos
	TermState     = "term:state"        // term.Info: o shell de um terminal saiu
	CloneProgress = "clone:progress"    // gitx.CloneProgress: andamento (e fim) de um git clone
	Coverage      = "coverage:ready"    // {runId, projectId}: a cobertura de uma execução está pronta
)

// Event é um evento já nomeado.
type Event struct {
	Name string `json:"name"`
	Data any    `json:"data"`
}

// Bus distribui eventos para sinks fixos (Wails) e assinantes dinâmicos (WebSocket de dev).
type Bus struct {
	mu   sync.RWMutex
	sink func(name string, data any)
	subs map[chan Event]struct{}
}

// NewBus cria um barramento sem destino; eventos sem destino são descartados.
func NewBus() *Bus { return &Bus{subs: map[chan Event]struct{}{}} }

// SetSink define o destino principal (o runtime do Wails, quando houver).
func (b *Bus) SetSink(fn func(name string, data any)) {
	b.mu.Lock()
	b.sink = fn
	b.mu.Unlock()
}

// Emit publica o evento. Nunca bloqueia: assinante lento perde eventos (a UI refaz o fetch).
func (b *Bus) Emit(name string, data any) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	if b.sink != nil {
		b.sink(name, data)
	}
	for ch := range b.subs {
		select {
		case ch <- Event{Name: name, Data: data}:
		default:
		}
	}
}

// Subscribe devolve um canal de eventos e a função que cancela a assinatura.
func (b *Bus) Subscribe() (<-chan Event, func()) {
	ch := make(chan Event, 256)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	return ch, func() {
		b.mu.Lock()
		if _, ok := b.subs[ch]; ok {
			delete(b.subs, ch)
			close(ch)
		}
		b.mu.Unlock()
	}
}
