package run

import "sync"

// Chunk é um pedaço de saída. T: "out" | "err" | "sys" | "in".
type Chunk struct {
	T string `json:"t"`
	D string `json:"d"`
}

// Output guarda a saída de uma execução com teto de memória.
//
// Quem lê usa um Cursor: o escritor nunca espera por leitor nenhum e nenhum leitor é desligado por
// ficar para trás. Um leitor lento só perde o que o próprio teto de memória já descartou (e fica sabendo).
type Output struct {
	mu      sync.Mutex
	chunks  []Chunk
	base    int // índice absoluto de chunks[0] (quantos pedaços já saíram pelo teto)
	size    int
	limit   int
	closed  bool
	cursors map[*Cursor]struct{}
}

// NewOutput cria um buffer com o limite em bytes.
func NewOutput(limit int) *Output {
	return &Output{limit: limit, cursors: map[*Cursor]struct{}{}}
}

// Write acrescenta um pedaço. Pedaços antigos saem quando passa do limite.
func (o *Output) Write(t, d string) {
	if d == "" {
		return
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closed {
		return
	}
	o.chunks = append(o.chunks, Chunk{T: t, D: d})
	o.size += len(d)
	for o.size > o.limit && len(o.chunks) > 1 {
		o.size -= len(o.chunks[0].D)
		o.chunks[0] = Chunk{}
		o.chunks = o.chunks[1:]
		o.base++
	}
	o.wakeLocked()
}

// Close encerra o fluxo: os cursores leem o que falta e recebem done.
func (o *Output) Close() {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closed {
		return
	}
	o.closed = true
	o.wakeLocked()
}

func (o *Output) wakeLocked() {
	for c := range o.cursors {
		select {
		case c.wake <- struct{}{}:
		default: // já tem um aviso pendente
		}
	}
}

// Cursor lê a saída do começo (do que ainda está guardado) até o fim, no ritmo do leitor.
type Cursor struct {
	o    *Output
	next int // próximo índice absoluto a ler
	wake chan struct{}
	// C recebe um aviso quando há algo novo para Next (ou quando a saída fechou).
	C <-chan struct{}
}

// Subscribe cria um cursor posicionado no pedaço mais antigo ainda guardado.
func (o *Output) Subscribe() *Cursor {
	o.mu.Lock()
	defer o.mu.Unlock()
	w := make(chan struct{}, 1)
	c := &Cursor{o: o, next: o.base, wake: w, C: w}
	o.cursors[c] = struct{}{}
	if len(o.chunks) > 0 || o.closed {
		w <- struct{}{}
	}
	return c
}

// Next devolve o que há de novo, até max bytes, emendando pedaços seguidos do mesmo tipo.
// skipped: parte da saída foi descartada pelo teto antes de este cursor ler.
// done: a saída terminou e não há mais nada para ler.
func (c *Cursor) Next(max int) (batch []Chunk, skipped bool, done bool) {
	o := c.o
	o.mu.Lock()
	defer o.mu.Unlock()
	if c.next < o.base {
		skipped = true
		c.next = o.base
	}
	size := 0
	for c.next < o.base+len(o.chunks) && size < max {
		ch := o.chunks[c.next-o.base]
		if n := len(batch); n > 0 && batch[n-1].T == ch.T {
			batch[n-1].D += ch.D
		} else {
			batch = append(batch, ch)
		}
		size += len(ch.D)
		c.next++
	}
	if c.next < o.base+len(o.chunks) {
		// Sobrou para a próxima chamada: garante o aviso.
		select {
		case c.wake <- struct{}{}:
		default:
		}
	}
	done = o.closed && c.next >= o.base+len(o.chunks)
	return batch, skipped, done
}

// Close solta o cursor.
func (c *Cursor) Close() {
	c.o.mu.Lock()
	delete(c.o.cursors, c)
	c.o.mu.Unlock()
}
