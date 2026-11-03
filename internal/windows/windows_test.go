package windows

import (
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"prumo/internal/bridge"
	"prumo/internal/events"
)

// startBridge sobe uma ponte de verdade com a rota de foco; devolve a porta, o token e quantas vezes focou.
func startBridge(t *testing.T) (int, string, *int) {
	t.Helper()
	focused := 0
	b, err := bridge.New(bridge.Config{Addr: "127.0.0.1:0"}, nil, nil, events.NewBus(), nil)
	if err != nil {
		t.Fatal(err)
	}
	b.SetFocus(func() { focused++ })
	if err := b.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = b.Close() })
	return b.Port(), b.Token(), &focused
}

// other registra uma "outra janela" (outro pid) com os projetos dados.
func other(t *testing.T, dir string, pid, port int, token string, projects ...string) {
	t.Helper()
	b, _ := json.Marshal(Entry{PID: pid, Port: port, Token: token, Projects: projects})
	if err := os.WriteFile(filepath.Join(dir, strconv.Itoa(pid)+".json"), b, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestRegistryWritesOwnFile(t *testing.T) {
	dir := t.TempDir()
	r, err := New(dir, 1234, "tok")
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Opened("/a"); err != nil {
		t.Fatal(err)
	}
	_ = r.Opened("/a") // repetido não duplica
	_ = r.Opened("/b")
	_ = r.Closed("/a")
	f := filepath.Join(dir, strconv.Itoa(os.Getpid())+".json")
	st, err := os.Stat(f)
	if err != nil || st.Mode().Perm() != 0o600 {
		t.Fatalf("arquivo da janela deveria ser 0600 (tem o token da ponte): %v %v", st, err)
	}
	var e Entry
	b, _ := os.ReadFile(f)
	if json.Unmarshal(b, &e) != nil || e.Port != 1234 || e.Token != "tok" || len(e.Projects) != 1 || e.Projects[0] != "/b" {
		t.Fatalf("conteúdo: %s", b)
	}
	r.Close()
	if _, err := os.Stat(f); !os.IsNotExist(err) {
		t.Fatal("fechar a janela deveria apagar o arquivo dela")
	}
	var nilReg *Registry // modo dev: sem registro, tudo é no-op
	if nilReg.Opened("/x") != nil || nilReg.FocusOther("/x") {
		t.Fatal("registro nil")
	}
	nilReg.Close()
}

func TestFocusOtherWindow(t *testing.T) {
	dir := t.TempDir()
	port, token, focused := startBridge(t)
	other(t, dir, 99991, port, token, "/projetos/loja")
	r, err := New(dir, 1, "eu")
	if err != nil {
		t.Fatal(err)
	}
	_ = r.Opened("/projetos/meu") // o projeto desta janela não conta
	if r.FocusOther("/projetos/meu") {
		t.Fatal("o próprio projeto não deveria ir para outra janela")
	}
	if r.FocusOther("/projetos/outro") || *focused != 0 {
		t.Fatal("projeto que nenhuma janela tem")
	}
	if !r.FocusOther("/projetos/loja") || *focused != 1 {
		t.Fatalf("deveria pedir foco à janela que tem o projeto (focou %d)", *focused)
	}
}

func TestStaleWindowIsForgotten(t *testing.T) {
	dir := t.TempDir()
	// Uma porta onde ninguém escuta: a janela caiu sem apagar o arquivo.
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	dead := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	other(t, dir, 99992, dead, "x", "/projetos/loja")
	// Token errado: também não conta (não é a janela que diz ser).
	port, _, focused := startBridge(t)
	other(t, dir, 99993, port, "token-errado", "/projetos/loja")
	r, _ := New(dir, 1, "eu")
	if r.FocusOther("/projetos/loja") || *focused != 0 {
		t.Fatal("janela morta ou com token errado não deveria contar")
	}
	for _, pid := range []string{"99992", "99993"} {
		if _, err := os.Stat(filepath.Join(dir, pid+".json")); !os.IsNotExist(err) {
			t.Fatalf("o registro da janela %s deveria ter sido apagado", pid)
		}
	}
}

func TestProjectArg(t *testing.T) {
	cases := map[string][]string{
		"/a/b": {"--project", "/a/b"},
		"/c d": {"-psn_0_1", "--project=/c d"},
		"":     {"--project"},
		"/x":   {"--outra", "1", "--project", "/x", "--mais"},
	}
	for want, args := range cases {
		if got := ProjectArg(args); got != want {
			t.Errorf("ProjectArg(%q) = %q; quero %q", args, got, want)
		}
	}
}

// TestMain: quando o teste roda como "janela nova" (Launch executa o próprio binário), só grava os argumentos.
func TestMain(m *testing.M) {
	if out := os.Getenv("PRUMO_LAUNCH_CHILD"); out != "" {
		_ = os.WriteFile(out, []byte(strings.Join(os.Args[1:], "\n")), 0o600)
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func TestLaunchStartsAnotherProcessWithProject(t *testing.T) {
	out := filepath.Join(t.TempDir(), "args")
	t.Setenv("PRUMO_LAUNCH_CHILD", out)
	if err := Launch("/projetos/com espaço"); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if b, err := os.ReadFile(out); err == nil && len(b) > 0 {
			if got := ProjectArg(strings.Split(string(b), "\n")); got != "/projetos/com espaço" {
				t.Fatalf("a janela nova recebeu %q", b)
			}
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("a janela nova não rodou")
}
