// Package lsp é o hub entre a IDE e o gopls.
//
// Um processo gopls por projeto. A UI conecta por WebSocket e fala LSP como se fosse a única
// cliente; o hub faz o initialize uma vez, reescreve os ids das requisições (a UI e o próprio
// backend dividem o mesmo servidor), responde sozinho o que é configuração e guarda os
// diagnósticos para quem conectar depois.
package lsp

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"sync"
	"time"

	"goide/internal/events"
	"goide/internal/proc"
	"goide/internal/workspace"
)

// Conn é uma conexão de cliente (uma aba de UI). Cada mensagem é um objeto JSON-RPC inteiro.
type Conn interface {
	Read(ctx context.Context) ([]byte, error)
	Write(ctx context.Context, msg []byte) error
}

// Estados publicados em events.LspState.
const (
	StateStarting = "starting"
	StateReady    = "ready"
	StateStopped  = "stopped"
	StateCrashed  = "crashed"
)

// maxCrashes em crashWindow faz o hub desistir de reiniciar o gopls.
const (
	maxCrashes  = 3
	crashWindow = 5 * time.Minute
)

// Hub gerencia os servidores gopls dos projetos abertos.
type Hub struct {
	reg      *workspace.Registry
	bus      *events.Bus
	goplsExe func() string

	mu      sync.Mutex
	servers map[string]*server
	crashes map[string][]time.Time
}

// NewHub cria o hub e fecha o servidor quando o projeto fecha.
func NewHub(reg *workspace.Registry, bus *events.Bus, goplsExe func() string) *Hub {
	h := &Hub{reg: reg, bus: bus, goplsExe: goplsExe, servers: map[string]*server{}, crashes: map[string][]time.Time{}}
	reg.OnClose(h.stop)
	return h
}

func (h *Hub) emitState(projectID, state, msg string) {
	h.bus.Emit(events.LspState, map[string]string{"projectId": projectID, "state": state, "message": msg})
}

// serverFor devolve o servidor do projeto, subindo um se preciso.
func (h *Hub) serverFor(projectID string) (*server, error) {
	o, err := h.reg.RequireTrusted(projectID)
	if err != nil {
		return nil, err
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if s, ok := h.servers[projectID]; ok && !s.isDead() {
		return s, nil
	}
	recent := h.crashes[projectID][:0]
	for _, t := range h.crashes[projectID] {
		if time.Since(t) < crashWindow {
			recent = append(recent, t)
		}
	}
	h.crashes[projectID] = recent
	if len(recent) >= maxCrashes {
		return nil, errors.New("o gopls caiu várias vezes seguidas; reabra o projeto para tentar de novo")
	}
	exe := h.goplsExe()
	if exe == "" {
		return nil, errors.New("gopls não encontrado: instale pelas configurações de ferramentas")
	}
	h.emitState(projectID, StateStarting, "")
	s, err := startServer(o, exe, h)
	if err != nil {
		h.emitState(projectID, StateCrashed, err.Error())
		return nil, err
	}
	h.servers[projectID] = s
	return s, nil
}

func (h *Hub) onServerExit(projectID string, s *server, err error) {
	h.mu.Lock()
	if h.servers[projectID] == s {
		delete(h.servers, projectID)
	}
	if !s.stopping {
		h.crashes[projectID] = append(h.crashes[projectID], time.Now())
	}
	h.mu.Unlock()
	if s.stopping {
		h.emitState(projectID, StateStopped, "")
		return
	}
	msg := "o gopls encerrou"
	if err != nil {
		msg += ": " + err.Error()
	}
	h.emitState(projectID, StateCrashed, msg)
}

// stopIfSame encerra o servidor do projeto só se ainda for este (pode ter sido trocado por um novo).
func (h *Hub) stopIfSame(projectID string, s *server) {
	h.mu.Lock()
	if h.servers[projectID] != s {
		h.mu.Unlock()
		return
	}
	delete(h.servers, projectID)
	h.mu.Unlock()
	s.shutdown()
}

// idleTimeout é quanto o gopls espera, sem nenhuma UI conectada, antes de sair (GOIDE_LSP_IDLE, ex.: "200ms").
func idleTimeout() time.Duration {
	if d, err := time.ParseDuration(os.Getenv("GOIDE_LSP_IDLE")); err == nil && d > 0 {
		return d
	}
	return 30 * time.Second
}

func (h *Hub) stop(projectID string) {
	h.mu.Lock()
	s := h.servers[projectID]
	delete(h.servers, projectID)
	h.mu.Unlock()
	if s != nil {
		s.shutdown()
	}
}

// StopAll encerra todos os servidores (fechamento do app).
func (h *Hub) StopAll() {
	h.mu.Lock()
	all := make([]*server, 0, len(h.servers))
	for id, s := range h.servers {
		all = append(all, s)
		delete(h.servers, id)
	}
	h.mu.Unlock()
	for _, s := range all {
		s.shutdown()
	}
}

// Connect liga uma conexão de UI ao gopls do projeto e bloqueia até ela fechar.
func (h *Hub) Connect(ctx context.Context, projectID string, conn Conn) error {
	s, err := h.serverFor(projectID)
	if err != nil {
		return err
	}
	return s.serveClient(ctx, conn)
}

// Request faz uma requisição do próprio backend (ex.: workspace/symbol para a busca).
func (h *Hub) Request(ctx context.Context, projectID, method string, params any, result any) error {
	s, err := h.serverFor(projectID)
	if err != nil {
		return err
	}
	select {
	case <-s.ready:
	case <-ctx.Done():
		return ctx.Err()
	}
	if s.initErr != nil {
		return s.initErr
	}
	raw, err := s.request(ctx, method, params)
	if err != nil {
		return err
	}
	if result != nil {
		return json.Unmarshal(raw, result)
	}
	return nil
}

// Diagnostics devolve os últimos diagnósticos publicados (params de publishDiagnostics, por URI).
func (h *Hub) Diagnostics(projectID string) map[string]json.RawMessage {
	h.mu.Lock()
	s := h.servers[projectID]
	h.mu.Unlock()
	if s == nil {
		return map[string]json.RawMessage{}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[string]json.RawMessage, len(s.diags))
	for k, v := range s.diags {
		out[k] = v
	}
	return out
}

// ---------------------------------------------------------------- server

type pending struct {
	client *client // nil = requisição do backend
	origID json.RawMessage
	reply  chan *message
}

type client struct {
	conn     Conn
	out      chan []byte
	closed   bool
	mu       sync.Mutex
	idMap    map[string]int64 // id original da UI -> id no servidor (para $/cancelRequest)
	openDocs map[string]bool
	lastUse  time.Time
}

func (c *client) send(b []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return
	}
	select {
	case c.out <- b:
	default:
		// UI travada: perder uma notificação é melhor do que travar o gopls inteiro.
	}
}

// close fecha o canal de saída uma única vez; send depois disso vira no-op.
func (c *client) close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.closed {
		c.closed = true
		close(c.out)
	}
}

type server struct {
	projectID string
	hub       *Hub
	root      string
	cmd       *exec.Cmd
	stdin     io.WriteCloser
	writeMu   sync.Mutex

	ready      chan struct{}
	initResult json.RawMessage
	initErr    error

	mu         sync.Mutex
	nextID     int64
	pending    map[int64]*pending
	clients    map[*client]struct{}
	serverReqs map[string]*client // ids de requisições do gopls repassadas para uma UI
	diags      map[string]json.RawMessage
	dead       bool
	stopping   bool
	settings   map[string]any
	idle       *time.Timer // encerra o gopls quando nenhuma UI usa o projeto
}

func startServer(o *workspace.Open, exe string, h *Hub) (*server, error) {
	cmd := exec.Command(exe, "serve")
	cmd.Dir = o.RootPath
	cmd.Env = o.GoEnv(nil)
	cmd.SysProcAttr = proc.Attr(false)
	cmd.Stderr = io.Discard
	if os.Getenv("GOIDE_LSP_DEBUG") != "" {
		cmd.Stderr = os.Stderr
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("iniciar gopls: %w", err)
	}
	s := &server{
		projectID: o.ID, hub: h, root: o.RootPath, cmd: cmd, stdin: stdin,
		ready: make(chan struct{}), pending: map[int64]*pending{}, clients: map[*client]struct{}{},
		serverReqs: map[string]*client{}, diags: map[string]json.RawMessage{},
		settings: goplsSettings(o),
	}
	go s.readLoop(bufio.NewReaderSize(stdout, 1<<20))
	go s.initialize()
	return s, nil
}

func (s *server) isDead() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.dead
}

func (s *server) write(m *message) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	return writeFrame(s.stdin, m.marshal())
}

// request manda uma requisição com id próprio e espera a resposta.
func (s *server) request(ctx context.Context, method string, params any) (json.RawMessage, error) {
	p, err := json.Marshal(params)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	if s.dead {
		s.mu.Unlock()
		return nil, errors.New("gopls não está rodando")
	}
	s.nextID++
	id := s.nextID
	reply := make(chan *message, 1)
	s.pending[id] = &pending{reply: reply}
	s.mu.Unlock()
	if err := s.write(&message{ID: idJSON(id), Method: method, Params: p}); err != nil {
		return nil, err
	}
	select {
	case m := <-reply:
		if m == nil {
			return nil, errors.New("gopls encerrou antes de responder")
		}
		if len(m.Error) > 0 {
			return nil, fmt.Errorf("%s: %s", method, errorMessage(m.Error))
		}
		return m.Result, nil
	case <-ctx.Done():
		s.mu.Lock()
		delete(s.pending, id)
		s.mu.Unlock()
		_ = s.write(&message{Method: "$/cancelRequest", Params: json.RawMessage(`{"id":` + strconv.FormatInt(id, 10) + `}`)})
		return nil, ctx.Err()
	}
}

func (s *server) initialize() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	rootURI := PathToURI(s.root)
	params := map[string]any{
		"processId":             os.Getpid(),
		"clientInfo":            map[string]string{"name": "goide", "version": "0.1"},
		"rootUri":               rootURI,
		"workspaceFolders":      []map[string]string{{"uri": rootURI, "name": filepath.Base(s.root)}},
		"capabilities":          clientCapabilities(),
		"initializationOptions": s.settings,
	}
	res, err := s.request(ctx, "initialize", params)
	if err == nil {
		err = s.write(&message{Method: "initialized", Params: json.RawMessage("{}")})
	}
	s.initResult, s.initErr = res, err
	close(s.ready)
	if err != nil {
		s.hub.emitState(s.projectID, StateCrashed, err.Error())
		s.kill()
		return
	}
	s.hub.emitState(s.projectID, StateReady, "")
}

func (s *server) readLoop(r *bufio.Reader) {
	var exitErr error
	for {
		body, err := readFrame(r)
		if err != nil {
			if !errors.Is(err, io.EOF) {
				exitErr = err
			}
			break
		}
		var m message
		if err := json.Unmarshal(body, &m); err != nil {
			continue
		}
		s.fromServer(&m, body)
	}
	if err := s.cmd.Wait(); err != nil && exitErr == nil {
		exitErr = err
	}
	s.mu.Lock()
	s.dead = true
	pend := s.pending
	s.pending = map[int64]*pending{}
	clients := make([]*client, 0, len(s.clients))
	for c := range s.clients {
		clients = append(clients, c)
	}
	s.mu.Unlock()
	for _, p := range pend {
		if p.reply != nil {
			p.reply <- nil
		}
	}
	for _, c := range clients {
		c.close() // derruba a conexão; a UI reconecta e ganha um gopls novo
	}
	s.hub.onServerExit(s.projectID, s, exitErr)
}

func (s *server) fromServer(m *message, raw []byte) {
	switch {
	case m.isResponse():
		id, err := strconv.ParseInt(string(m.ID), 10, 64)
		if err != nil {
			return
		}
		s.mu.Lock()
		p := s.pending[id]
		delete(s.pending, id)
		s.mu.Unlock()
		if p == nil {
			return
		}
		if p.client == nil {
			p.reply <- m
			return
		}
		p.client.mu.Lock()
		delete(p.client.idMap, string(p.origID))
		p.client.mu.Unlock()
		m.ID = p.origID
		p.client.send(m.marshal())

	case m.isRequest():
		s.serverRequest(m, raw)

	case m.isNotification():
		if m.Method == "textDocument/publishDiagnostics" {
			var p struct {
				URI string `json:"uri"`
			}
			if json.Unmarshal(m.Params, &p) == nil {
				s.mu.Lock()
				s.diags[p.URI] = m.Params
				s.mu.Unlock()
			}
		}
		s.broadcast(raw)
	}
}

// serverRequest responde sozinho o que é do cliente como um todo e repassa o resto para a UI ativa.
func (s *server) serverRequest(m *message, raw []byte) {
	reply := func(result any) {
		b, _ := json.Marshal(result)
		_ = s.write(&message{ID: m.ID, Result: b})
	}
	switch m.Method {
	case "workspace/configuration":
		var p struct {
			Items []struct {
				Section string `json:"section"`
			} `json:"items"`
		}
		_ = json.Unmarshal(m.Params, &p)
		out := make([]any, len(p.Items))
		for i, it := range p.Items {
			if it.Section == "gopls" || it.Section == "" {
				out[i] = s.settings
			}
		}
		reply(out)
		return
	case "window/workDoneProgress/create", "client/registerCapability", "client/unregisterCapability":
		reply(nil)
		return
	case "workspace/workspaceFolders":
		reply([]map[string]string{{"uri": PathToURI(s.root), "name": filepath.Base(s.root)}})
		return
	}
	c := s.activeClient()
	if c == nil {
		if m.Method == "workspace/applyEdit" {
			reply(map[string]any{"applied": false, "failureReason": "nenhum editor conectado"})
			return
		}
		reply(nil)
		return
	}
	s.mu.Lock()
	s.serverReqs[string(m.ID)] = c
	s.mu.Unlock()
	c.send(raw)
}

func (s *server) activeClient() *client {
	s.mu.Lock()
	defer s.mu.Unlock()
	var best *client
	for c := range s.clients {
		c.mu.Lock()
		if best == nil || c.lastUse.After(best.lastUse) {
			best = c
		}
		c.mu.Unlock()
	}
	return best
}

func (s *server) broadcast(raw []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for c := range s.clients {
		c.send(raw)
	}
}

// serveClient atende uma conexão de UI até ela fechar.
func (s *server) serveClient(ctx context.Context, conn Conn) error {
	c := &client{conn: conn, out: make(chan []byte, 1024), idMap: map[string]int64{}, openDocs: map[string]bool{}, lastUse: time.Now()}
	s.mu.Lock()
	if s.dead {
		s.mu.Unlock()
		return errors.New("gopls não está rodando")
	}
	s.clients[c] = struct{}{}
	if s.idle != nil {
		s.idle.Stop()
		s.idle = nil
	}
	s.mu.Unlock()

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() {
		for b := range c.out {
			if err := conn.Write(ctx, b); err != nil {
				cancel()
				return
			}
		}
		cancel() // servidor caiu: fecha a conexão
	}()
	defer s.dropClient(c)

	for {
		b, err := conn.Read(ctx)
		if err != nil {
			return nil
		}
		var m message
		if err := json.Unmarshal(b, &m); err != nil {
			continue
		}
		c.mu.Lock()
		c.lastUse = time.Now()
		c.mu.Unlock()
		s.fromClient(ctx, c, &m)
	}
}

func (s *server) fromClient(ctx context.Context, c *client, m *message) {
	switch {
	case m.isRequest():
		switch m.Method {
		case "initialize":
			go func(id json.RawMessage) {
				select {
				case <-s.ready:
				case <-ctx.Done():
					return
				}
				resp := &message{ID: id, Result: s.initResult}
				if s.initErr != nil {
					resp = &message{ID: id, Error: rpcError(-32603, s.initErr.Error())}
				}
				c.send(resp.marshal())
				// Quem conecta depois recebe os diagnósticos que já existem.
				s.mu.Lock()
				for _, d := range s.diags {
					c.send((&message{Method: "textDocument/publishDiagnostics", Params: d}).marshal())
				}
				s.mu.Unlock()
			}(m.ID)
			return
		case "shutdown":
			c.send((&message{ID: m.ID}).marshal())
			return
		}
		<-s.ready
		s.mu.Lock()
		s.nextID++
		id := s.nextID
		s.pending[id] = &pending{client: c, origID: m.ID}
		s.mu.Unlock()
		c.mu.Lock()
		c.idMap[string(m.ID)] = id
		c.mu.Unlock()
		m.ID = idJSON(id)
		_ = s.write(m)

	case m.isNotification():
		switch m.Method {
		case "initialized", "exit":
			return
		case "$/cancelRequest":
			var p struct {
				ID json.RawMessage `json:"id"`
			}
			if json.Unmarshal(m.Params, &p) != nil {
				return
			}
			c.mu.Lock()
			id, ok := c.idMap[string(p.ID)]
			c.mu.Unlock()
			if !ok {
				return
			}
			m.Params = json.RawMessage(`{"id":` + strconv.FormatInt(id, 10) + `}`)
		case "textDocument/didOpen", "textDocument/didClose":
			var p struct {
				TextDocument struct {
					URI string `json:"uri"`
				} `json:"textDocument"`
			}
			if json.Unmarshal(m.Params, &p) == nil {
				c.mu.Lock()
				c.openDocs[p.TextDocument.URI] = m.Method == "textDocument/didOpen"
				c.mu.Unlock()
			}
		}
		<-s.ready
		_ = s.write(m)

	case m.isResponse():
		// Resposta da UI a uma requisição do gopls (applyEdit, showMessageRequest).
		s.mu.Lock()
		delete(s.serverReqs, string(m.ID))
		s.mu.Unlock()
		_ = s.write(m)
	}
}

// dropClient fecha os documentos que a UI deixou abertos e esquece as requisições dela.
func (s *server) dropClient(c *client) {
	s.mu.Lock()
	_, present := s.clients[c]
	delete(s.clients, c)
	for id, p := range s.pending {
		if p.client == c {
			delete(s.pending, id)
		}
	}
	for id, owner := range s.serverReqs {
		if owner == c {
			delete(s.serverReqs, id)
			_ = s.write(&message{ID: json.RawMessage(id), Result: json.RawMessage("null")})
		}
	}
	dead := s.dead
	if !dead && len(s.clients) == 0 && s.idle == nil {
		// Último editor saiu (projeto fechado, janela recarregada...). Se ninguém voltar logo,
		// o gopls sai: cada um ocupa centenas de MB e eles se acumulariam projeto após projeto.
		s.idle = time.AfterFunc(idleTimeout(), func() {
			s.mu.Lock()
			still := len(s.clients) == 0 && s.idle != nil
			s.mu.Unlock()
			if still {
				s.hub.stopIfSame(s.projectID, s)
			}
		})
	}
	s.mu.Unlock()
	if present {
		c.close()
	}
	if dead {
		return
	}
	c.mu.Lock()
	docs := c.openDocs
	c.mu.Unlock()
	for uri, open := range docs {
		if open {
			p, _ := json.Marshal(map[string]any{"textDocument": map[string]string{"uri": uri}})
			_ = s.write(&message{Method: "textDocument/didClose", Params: p})
		}
	}
}

func (s *server) shutdown() {
	s.mu.Lock()
	if s.dead {
		s.mu.Unlock()
		return
	}
	s.stopping = true
	s.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	select {
	case <-s.ready:
		_, _ = s.request(ctx, "shutdown", nil)
		_ = s.write(&message{Method: "exit"})
	case <-ctx.Done():
	}
	time.AfterFunc(2*time.Second, s.kill)
}

func (s *server) kill() {
	if s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
	}
}

// ---------------------------------------------------------------- helpers

func idJSON(id int64) json.RawMessage { return json.RawMessage(strconv.FormatInt(id, 10)) }

func rpcError(code int, msg string) json.RawMessage {
	b, _ := json.Marshal(map[string]any{"code": code, "message": msg})
	return b
}

func errorMessage(raw json.RawMessage) string {
	var e struct {
		Message string `json:"message"`
	}
	if json.Unmarshal(raw, &e) == nil && e.Message != "" {
		return e.Message
	}
	return string(raw)
}

// PathToURI converte um caminho absoluto em URI file:// (com a letra do drive no Windows).
func PathToURI(p string) string {
	p = filepath.ToSlash(p)
	if runtime.GOOS == "windows" && len(p) > 1 && p[1] == ':' {
		p = "/" + p
	}
	return (&url.URL{Scheme: "file", Path: p}).String()
}

// URIToPath faz o caminho inverso.
func URIToPath(uri string) (string, error) {
	u, err := url.Parse(uri)
	if err != nil || u.Scheme != "file" {
		return "", fmt.Errorf("URI não é file://: %q", uri)
	}
	p := u.Path
	if runtime.GOOS == "windows" && len(p) > 2 && p[0] == '/' && p[2] == ':' {
		p = p[1:]
	}
	return filepath.FromSlash(p), nil
}

func goplsSettings(o *workspace.Open) map[string]any {
	s := map[string]any{
		"completeUnimported": true,
		"semanticTokens":     true,
		"usePlaceholders":    false,
		"hints": map[string]bool{
			"compositeLiteralFields": true,
			"constantValues":         true,
			"parameterNames":         true,
			"functionTypeParameters": true,
		},
	}
	if len(o.BuildTags) > 0 {
		s["buildFlags"] = []string{"-tags=" + joinComma(o.BuildTags)}
	}
	if len(o.Project.Env) > 0 {
		s["env"] = o.Project.Env
	}
	return s
}

func joinComma(xs []string) string {
	out := ""
	for i, x := range xs {
		if i > 0 {
			out += ","
		}
		out += x
	}
	return out
}

// clientCapabilities declara o que a UI (Monaco + adaptador) sabe fazer.
func clientCapabilities() map[string]any {
	md := []string{"markdown", "plaintext"}
	return map[string]any{
		"general": map[string]any{"positionEncodings": []string{"utf-16"}},
		"window":  map[string]any{"workDoneProgress": true, "showDocument": map[string]bool{"support": true}},
		"workspace": map[string]any{
			"applyEdit":              true,
			"workspaceEdit":          map[string]any{"documentChanges": true, "resourceOperations": []string{"create", "rename", "delete"}},
			"configuration":          true,
			"workspaceFolders":       true,
			"didChangeConfiguration": map[string]bool{"dynamicRegistration": true},
			"symbol":                 map[string]any{"symbolKind": map[string]any{"valueSet": seq(1, 26)}},
			"semanticTokens":         map[string]bool{"refreshSupport": true},
			"inlayHint":              map[string]bool{"refreshSupport": true},
		},
		"textDocument": map[string]any{
			"synchronization": map[string]any{"didSave": true, "willSave": false},
			"completion": map[string]any{
				"completionItem": map[string]any{
					"snippetSupport": true, "documentationFormat": md, "deprecatedSupport": true,
					"insertReplaceSupport": true, "labelDetailsSupport": true,
					"resolveSupport": map[string]any{"properties": []string{"documentation", "detail", "additionalTextEdits"}},
				},
				"completionItemKind": map[string]any{"valueSet": seq(1, 25)},
				"contextSupport":     true,
			},
			"hover":             map[string]any{"contentFormat": md},
			"signatureHelp":     map[string]any{"signatureInformation": map[string]any{"documentationFormat": md, "parameterInformation": map[string]bool{"labelOffsetSupport": true}, "activeParameterSupport": true}},
			"definition":        map[string]bool{"linkSupport": true},
			"typeDefinition":    map[string]bool{"linkSupport": true},
			"implementation":    map[string]bool{"linkSupport": true},
			"references":        map[string]any{},
			"documentHighlight": map[string]any{},
			"documentSymbol":    map[string]any{"hierarchicalDocumentSymbolSupport": true, "symbolKind": map[string]any{"valueSet": seq(1, 26)}},
			"codeAction": map[string]any{
				"codeActionLiteralSupport": map[string]any{"codeActionKind": map[string]any{"valueSet": []string{
					"", "quickfix", "refactor", "refactor.extract", "refactor.inline", "refactor.rewrite", "source", "source.organizeImports", "source.fixAll"}}},
				"resolveSupport":     map[string]any{"properties": []string{"edit"}},
				"dataSupport":        true,
				"isPreferredSupport": true,
			},
			"formatting":         map[string]any{},
			"rename":             map[string]any{"prepareSupport": true},
			"publishDiagnostics": map[string]any{"relatedInformation": true, "tagSupport": map[string]any{"valueSet": []int{1, 2}}, "codeDescriptionSupport": true},
			"foldingRange":       map[string]any{"lineFoldingOnly": true},
			"semanticTokens": map[string]any{
				"requests":       map[string]any{"full": true, "range": true},
				"tokenTypes":     []string{"namespace", "type", "class", "enum", "interface", "struct", "typeParameter", "parameter", "variable", "property", "enumMember", "event", "function", "method", "macro", "keyword", "modifier", "comment", "string", "number", "regexp", "operator", "label"},
				"tokenModifiers": []string{"declaration", "definition", "readonly", "static", "deprecated", "abstract", "async", "modification", "documentation", "defaultLibrary"},
				"formats":        []string{"relative"},
			},
			"inlayHint": map[string]any{},
		},
	}
}

func seq(a, b int) []int {
	out := make([]int, 0, b-a+1)
	for i := a; i <= b; i++ {
		out = append(out, i)
	}
	return out
}
