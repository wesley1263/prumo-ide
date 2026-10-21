// Package bridge é o servidor local que leva tráfego pesado entre o backend e a UI.
//
// Só escuta em loopback, exige um token por sessão e confere a Origin: sem isso qualquer página
// aberta no navegador do usuário poderia falar com o gopls ou com os processos dele.
//
//	WS   /lsp/{projectID}  JSON-RPC do LSP (uma mensagem por frame)
//	WS   /run/{runID}      saída de uma execução: histórico e depois ao vivo
//	WS   /term/{termID}    terminal: saída em frames binários; entrada binária, resize em JSON
//	POST /rpc              (só no modo dev) os mesmos métodos que o Wails expõe por binding
//	WS   /events           (só no modo dev) os eventos que o Wails emitiria
package bridge

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"

	"goide/internal/events"
	"goide/internal/lsp"
	"goide/internal/run"
)

// TokenHeader é o cabeçalho do token em requisições HTTP; em WebSocket vai na query (?token=).
const TokenHeader = "X-Goide-Token"

// Config define a ponte.
type Config struct {
	Addr           string   // "127.0.0.1:0" = porta aleatória
	AllowedOrigins []string // Origins de navegador aceitas; requisição sem Origin só passa com token
	Dev            bool     // liga /rpc e /events
}

// Server é a ponte em execução.
type Server struct {
	cfg   Config
	token string
	ln    net.Listener
	http  *http.Server
	hub   *lsp.Hub
	runs  OutputSource
	bus   *events.Bus
	rpc   *Dispatcher
	terms TermSource
}

// TermSource são os terminais abertos (internal/term).
type TermSource interface {
	Output(id string) (*run.Output, error)
	Input(id string, p []byte) error
	Resize(id string, cols, rows int) error
}

// SetTerminals liga a rota /term (antes de Start).
func (s *Server) SetTerminals(t TermSource) { s.terms = t }

// OutputSource acha a saída de uma execução ou sessão de depuração pelo id.
type OutputSource interface {
	Output(id string) (*run.Output, error)
}

// New cria a ponte. rpc pode ser nil fora do modo dev.
func New(cfg Config, hub *lsp.Hub, runs OutputSource, bus *events.Bus, rpc *Dispatcher) (*Server, error) {
	if !strings.HasPrefix(cfg.Addr, "127.0.0.1:") && !strings.HasPrefix(cfg.Addr, "[::1]:") {
		return nil, errors.New("a ponte só pode escutar em loopback")
	}
	tok := make([]byte, 32)
	if _, err := rand.Read(tok); err != nil {
		return nil, err
	}
	return &Server{cfg: cfg, token: hex.EncodeToString(tok), hub: hub, runs: runs, bus: bus, rpc: rpc}, nil
}

// Token é o segredo da sessão (entregue à UI pelo Bootstrap).
func (s *Server) Token() string { return s.token }

// Port é a porta em que a ponte escuta (depois de Start).
func (s *Server) Port() int {
	if s.ln == nil {
		return 0
	}
	return s.ln.Addr().(*net.TCPAddr).Port
}

// Start abre a porta e começa a atender em segundo plano.
func (s *Server) Start() error {
	ln, err := net.Listen("tcp", s.cfg.Addr)
	if err != nil {
		return err
	}
	s.ln = ln
	mux := http.NewServeMux()
	mux.HandleFunc("GET /lsp/{projectID}", s.guard(s.handleLSP))
	mux.HandleFunc("GET /run/{runID}", s.guard(s.handleRun))
	if s.terms != nil {
		mux.HandleFunc("GET /term/{termID}", s.guard(s.handleTerm))
	}
	if s.cfg.Dev && s.rpc != nil {
		mux.HandleFunc("POST /rpc", s.guard(s.handleRPC))
		mux.HandleFunc("GET /events", s.guard(s.handleEvents))
	}
	s.http = &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		if err := s.http.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("ponte: %v", err)
		}
	}()
	return nil
}

// Close para a ponte.
func (s *Server) Close() error {
	if s.http == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return s.http.Shutdown(ctx)
}

// SetToken substitui o token (o modo dev fixa um token compartilhado com o Vite).
func (s *Server) SetToken(tok string) { s.token = tok }

func (s *Server) guard(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" && !s.originAllowed(origin) {
			http.Error(w, "origem não permitida", http.StatusForbidden)
			return
		}
		tok := r.Header.Get(TokenHeader)
		if tok == "" {
			tok = r.URL.Query().Get("token")
		}
		if subtle.ConstantTimeCompare([]byte(tok), []byte(s.token)) != 1 {
			http.Error(w, "token inválido", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func (s *Server) originAllowed(origin string) bool {
	for _, o := range s.cfg.AllowedOrigins {
		if o == origin {
			return true
		}
	}
	return false
}

func (s *Server) accept(w http.ResponseWriter, r *http.Request) (*websocket.Conn, error) {
	// A Origin já foi conferida em guard contra a lista explícita.
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return nil, err
	}
	c.SetReadLimit(64 << 20) // didOpen de arquivo grande
	return c, nil
}

// ---------------------------------------------------------------- /lsp

type wsConn struct{ c *websocket.Conn }

func (w wsConn) Read(ctx context.Context) ([]byte, error) {
	_, b, err := w.c.Read(ctx)
	return b, err
}

func (w wsConn) Write(ctx context.Context, b []byte) error {
	return w.c.Write(ctx, websocket.MessageText, b)
}

func (s *Server) handleLSP(w http.ResponseWriter, r *http.Request) {
	c, err := s.accept(w, r)
	if err != nil {
		return
	}
	err = s.hub.Connect(r.Context(), r.PathValue("projectID"), wsConn{c})
	if err != nil {
		// 4000+ são códigos de aplicação; a UI mostra o motivo e não fica reconectando à toa.
		c.Close(websocket.StatusCode(4001), truncate(err.Error(), 120))
		return
	}
	c.Close(websocket.StatusNormalClosure, "")
}

// ---------------------------------------------------------------- /run

func (s *Server) handleRun(w http.ResponseWriter, r *http.Request) {
	out, err := s.runs.Output(r.PathValue("runID"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	c, err := s.accept(w, r)
	if err != nil {
		return
	}
	defer c.CloseNow()
	ctx := c.CloseRead(r.Context())
	cur := out.Subscribe()
	defer cur.Close()
	send := func(v any) error {
		b, _ := json.Marshal(v)
		wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		return c.Write(wctx, websocket.MessageText, b)
	}
	// Lê no ritmo da conexão: o programa nunca espera pela UI e a UI nunca perde o meio da saída.
	// Cada frame leva até 64 KB, com pedaços seguidos do mesmo tipo já emendados.
	for {
		batch, skipped, done := cur.Next(64 << 10)
		if skipped {
			if send(run.Chunk{T: "sys", D: "[parte da saída foi descartada: passou do limite guardado]\n"}) != nil {
				return
			}
		}
		if len(batch) > 0 {
			if send(batch) != nil {
				return
			}
			continue
		}
		if done {
			_ = send(map[string]string{"t": "end"})
			c.Close(websocket.StatusNormalClosure, "")
			return
		}
		select {
		case <-cur.C:
		case <-ctx.Done():
			return
		}
	}
}

// ---------------------------------------------------------------- /term

func (s *Server) handleTerm(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("termID")
	out, err := s.terms.Output(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	c, err := s.accept(w, r)
	if err != nil {
		return
	}
	defer c.CloseNow()
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// Entrada: binário = teclas (repassadas como vieram); texto = {"resize":[cols,rows]}.
	go func() {
		defer cancel()
		for {
			typ, b, err := c.Read(ctx)
			if err != nil {
				return
			}
			if typ == websocket.MessageBinary {
				if s.terms.Input(id, b) != nil {
					return
				}
				continue
			}
			var msg struct {
				Resize []int `json:"resize"`
			}
			if json.Unmarshal(b, &msg) == nil && len(msg.Resize) == 2 {
				_ = s.terms.Resize(id, msg.Resize[0], msg.Resize[1])
			}
		}
	}()

	// Saída: o histórico guardado e depois ao vivo, no ritmo da conexão (o shell nunca espera pela UI).
	cur := out.Subscribe()
	defer cur.Close()
	send := func(b []byte) error {
		wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		return c.Write(wctx, websocket.MessageBinary, b)
	}
	var buf []byte
	for {
		batch, skipped, done := cur.Next(64 << 10)
		buf = buf[:0]
		if skipped {
			buf = append(buf, "\x1b[2m[início do histórico descartado]\x1b[0m\r\n"...)
		}
		for _, ch := range batch {
			buf = append(buf, ch.D...)
		}
		if len(buf) > 0 {
			if send(buf) != nil {
				return
			}
			continue
		}
		if done {
			c.Close(websocket.StatusNormalClosure, "fim")
			return
		}
		select {
		case <-cur.C:
		case <-ctx.Done():
			return
		}
	}
}

// ---------------------------------------------------------------- /rpc e /events (dev)

func (s *Server) handleRPC(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		// Exigir JSON força o preflight CORS em navegadores: um form de outro site não chega aqui.
		http.Error(w, "use application/json", http.StatusUnsupportedMediaType)
		return
	}
	var req struct {
		Method string            `json:"method"`
		Args   []json.RawMessage `json:"args"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<20)).Decode(&req); err != nil {
		http.Error(w, "corpo inválido", http.StatusBadRequest)
		return
	}
	result, err := s.rpc.Call(req.Method, req.Args)
	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		var ue *UnknownMethodError
		if errors.As(err, &ue) {
			w.WriteHeader(http.StatusNotFound)
		}
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]any{"result": result})
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	c, err := s.accept(w, r)
	if err != nil {
		return
	}
	defer c.CloseNow()
	ctx := c.CloseRead(r.Context())
	evs, unsub := s.bus.Subscribe()
	defer unsub()
	for {
		select {
		case ev, ok := <-evs:
			if !ok {
				return
			}
			b, _ := json.Marshal(ev)
			if c.Write(ctx, websocket.MessageText, b) != nil {
				return
			}
		case <-ctx.Done():
			return
		}
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
