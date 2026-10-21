package lsp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"goide/internal/events"
	"goide/internal/store"
	"goide/internal/workspace"
)

func TestFraming(t *testing.T) {
	var buf bytes.Buffer
	writeFrame(&buf, []byte(`{"a":1}`))
	writeFrame(&buf, []byte(`{"b":"çã"}`))
	r := bufio.NewReader(&buf)
	for _, want := range []string{`{"a":1}`, `{"b":"çã"}`} {
		got, err := readFrame(r)
		if err != nil || string(got) != want {
			t.Fatalf("readFrame = %q, %v; quero %q", got, err, want)
		}
	}
}

func TestMarshalNullResult(t *testing.T) {
	m := &message{ID: json.RawMessage("1")}
	if got := string(m.marshal()); got != `{"jsonrpc":"2.0","id":1,"result":null}` {
		t.Fatalf("resposta null: %s", got)
	}
}

func TestURIRoundTrip(t *testing.T) {
	p := filepath.FromSlash("/home/u/meu projeto/main.go")
	uri := PathToURI(p)
	if uri != "file:///home/u/meu%20projeto/main.go" {
		t.Fatalf("uri: %s", uri)
	}
	back, err := URIToPath(uri)
	if err != nil || back != p {
		t.Fatalf("volta: %q %v", back, err)
	}
}

// fakeConn é uma UI de mentira: o teste escreve em in e lê de out.
type fakeConn struct {
	in  chan []byte
	out chan []byte
}

func (f *fakeConn) Read(ctx context.Context) ([]byte, error) {
	select {
	case b, ok := <-f.in:
		if !ok {
			return nil, errors.New("fechada")
		}
		return b, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (f *fakeConn) Write(ctx context.Context, b []byte) error {
	select {
	case f.out <- b:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// waitFor lê mensagens até uma que satisfaça match.
func waitFor(t *testing.T, c *fakeConn, what string, match func(m message) bool) message {
	t.Helper()
	deadline := time.After(90 * time.Second)
	for {
		select {
		case b := <-c.out:
			var m message
			json.Unmarshal(b, &m)
			if os.Getenv("GOIDE_LSP_DEBUG") != "" {
				t.Logf("<- %.200s", b)
			}
			if match(m) {
				return m
			}
		case <-deadline:
			t.Fatalf("timeout esperando %s", what)
		}
	}
}

// Fluxo real com gopls: initialize via hub, diagnóstico de erro, completion, segunda UI recebe o cache.
func TestHubWithGopls(t *testing.T) {
	gopls, err := exec.LookPath("gopls")
	if err != nil {
		if home, _ := os.UserHomeDir(); home != "" {
			if _, err := os.Stat(filepath.Join(home, "go", "bin", "gopls")); err == nil {
				gopls = filepath.Join(home, "go", "bin", "gopls")
			}
		}
	}
	if gopls == "" {
		t.Skip("gopls ausente")
	}
	if testing.Short() {
		t.Skip("integração com gopls")
	}
	ctx := context.Background()
	root := t.TempDir()
	if real, err := filepath.EvalSymlinks(root); err == nil {
		root = real
	}
	os.WriteFile(filepath.Join(root, "go.mod"), []byte("module demo\n\ngo 1.22\n"), 0o644)
	// Só erros de tipo: com erro de sintaxe o gopls esconde os de tipo.
	src := "package main\n\nimport \"fmt\"\n\nfunc main() {\n\tfmt.Println(naoExiste)\n\tfmt.P\n}\n"
	os.WriteFile(filepath.Join(root, "main.go"), []byte(src), 0o644)

	db, _ := store.Open(ctx, filepath.Join(t.TempDir(), "s.db"))
	defer db.Close()
	p, _ := db.TouchProject(ctx, root, "demo")
	reg := workspace.NewRegistry(db)
	reg.Add(ctx, p)
	hub := NewHub(reg, events.NewBus(), func() string { return gopls })
	defer hub.StopAll()

	ui := &fakeConn{in: make(chan []byte, 16), out: make(chan []byte, 256)}
	if err := hub.Connect(ctx, p.ID, ui); err != workspace.ErrUntrusted {
		t.Fatalf("sem confiança o gopls não pode subir: %v", err)
	}
	reg.SetTrusted(p.ID, true)
	go hub.Connect(ctx, p.ID, ui)

	ui.in <- []byte(`{"jsonrpc":"2.0","id":"ui-1","method":"initialize","params":{}}`)
	init := waitFor(t, ui, "initialize", func(m message) bool { return string(m.ID) == `"ui-1"` })
	if !strings.Contains(string(init.Result), "completionProvider") {
		t.Fatalf("initialize sem capacidades: %s", init.Result)
	}
	ui.in <- []byte(`{"jsonrpc":"2.0","method":"initialized","params":{}}`)

	uri := PathToURI(filepath.Join(root, "main.go"))
	open, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "method": "textDocument/didOpen", "params": map[string]any{
		"textDocument": map[string]any{"uri": uri, "languageId": "go", "version": 1, "text": src}}})
	ui.in <- open

	diag := waitFor(t, ui, "diagnóstico de naoExiste", func(m message) bool {
		return m.Method == "textDocument/publishDiagnostics" && strings.Contains(string(m.Params), "naoExiste")
	})
	if !strings.Contains(string(diag.Params), uri) {
		t.Fatalf("diagnóstico de outro arquivo: %s", diag.Params)
	}

	// Completion depois de "fmt.P" (linha 6, coluna 6; 0-based).
	ui.in <- []byte(`{"jsonrpc":"2.0","id":7,"method":"textDocument/completion","params":{"textDocument":{"uri":"` + uri + `"},"position":{"line":6,"character":6}}}`)
	comp := waitFor(t, ui, "completion", func(m message) bool { return string(m.ID) == "7" })
	if !strings.Contains(string(comp.Result), "Println") {
		t.Fatalf("completion sem Println: %.300s", comp.Result)
	}

	// Requisição do próprio backend no mesmo servidor, sem colidir com os ids da UI.
	var syms []map[string]any
	rctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	if err := hub.Request(rctx, p.ID, "workspace/symbol", map[string]string{"query": "main"}, &syms); err != nil {
		t.Fatal(err)
	}
	if len(syms) == 0 {
		t.Fatal("workspace/symbol vazio")
	}

	// Uma segunda UI (recarregar a janela) recebe os diagnósticos já conhecidos.
	ui2 := &fakeConn{in: make(chan []byte, 16), out: make(chan []byte, 256)}
	go hub.Connect(ctx, p.ID, ui2)
	ui2.in <- []byte(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`)
	waitFor(t, ui2, "diagnóstico em cache", func(m message) bool {
		return m.Method == "textDocument/publishDiagnostics" && strings.Contains(string(m.Params), "naoExiste")
	})
}
