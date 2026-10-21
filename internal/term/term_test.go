//go:build !windows

package term

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"prumo/internal/events"
	"prumo/internal/store"
	"prumo/internal/workspace"
)

func setup(t *testing.T) (*Manager, *workspace.Registry, string, string) {
	t.Helper()
	t.Setenv("SHELL", "/bin/sh") // previsível: sem rc do usuário imprimindo coisas
	ctx := context.Background()
	root := t.TempDir()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "s.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	p, _ := db.TouchProject(ctx, root, "p")
	reg := workspace.NewRegistry(db)
	if _, err := reg.Add(ctx, p); err != nil {
		t.Fatal(err)
	}
	m := NewManager(reg, events.NewBus())
	t.Cleanup(m.StopAll)
	return m, reg, p.ID, root
}

// waitOutput lê o histórico até aparecer want (ou estoura o tempo).
func waitOutput(t *testing.T, m *Manager, id, want string) string {
	t.Helper()
	out, err := m.Output(id)
	if err != nil {
		t.Fatal(err)
	}
	cur := out.Subscribe()
	defer cur.Close()
	var all strings.Builder
	deadline := time.After(10 * time.Second)
	for {
		batch, _, done := cur.Next(1 << 20)
		for _, c := range batch {
			all.WriteString(c.D)
		}
		if strings.Contains(all.String(), want) {
			return all.String()
		}
		if done && len(batch) == 0 {
			t.Fatalf("o terminal fechou sem mostrar %q; saída:\n%s", want, all.String())
		}
		select {
		case <-cur.C:
		case <-deadline:
			t.Fatalf("esperava %q; saída:\n%s", want, all.String())
		}
	}
}

func TestShellRunsInProjectAndExits(t *testing.T) {
	m, reg, pid, root := setup(t)
	if _, err := m.Create(pid, "", 80, 24); err != workspace.ErrUntrusted {
		t.Fatalf("sem confiança deveria falhar: %v", err)
	}
	reg.SetTrusted(pid, true)
	info, err := m.Create(pid, "", 100, 30)
	if err != nil {
		t.Fatal(err)
	}
	if info.Title != "Local" || info.Shell != "sh" {
		t.Fatalf("info: %+v", info)
	}
	if _, err := m.Create(pid, "/nao/existe/zsh", 80, 24); err == nil || !strings.Contains(err.Error(), "não encontrado") {
		t.Fatalf("shell configurado inexistente: %v", err)
	}
	m.Input(info.ID, []byte("pwd; echo \"[$TERM]\"; stty size\n"))
	out := waitOutput(t, m, info.ID, "30 100")
	real, _ := filepath.EvalSymlinks(root)
	if !strings.Contains(out, real) && !strings.Contains(out, root) {
		t.Errorf("o shell deveria abrir na pasta do projeto; saída:\n%s", out)
	}
	if !strings.Contains(out, "[xterm-256color]") {
		t.Errorf("TERM; saída:\n%s", out)
	}
	if err := m.Resize(info.ID, 120, 40); err != nil {
		t.Fatal(err)
	}
	m.Input(info.ID, []byte("stty size\n"))
	waitOutput(t, m, info.ID, "40 120")

	second, _ := m.Create(pid, "", 80, 24)
	if second.Title != "Local (2)" {
		t.Errorf("título do segundo: %q", second.Title)
	}
	if l := m.List(pid); len(l) != 2 || l[0].ID != info.ID {
		t.Fatalf("lista: %+v", l)
	}

	m.Input(info.ID, []byte("exit 3\n"))
	waitOutput(t, m, info.ID, "[processo encerrado com código 3]")
	for _, i := range m.List(pid) {
		if i.ID == info.ID && (!i.Exited || i.ExitCode != 3) {
			t.Fatalf("depois do exit: %+v", i)
		}
	}
}

func TestCloseKillsWhatIsRunning(t *testing.T) {
	m, reg, pid, root := setup(t)
	reg.SetTrusted(pid, true)
	info, _ := m.Create(pid, "", 80, 24)
	pidFile := filepath.Join(root, "sleep.pid")
	m.Input(info.ID, []byte("sleep 300 & echo $! > "+pidFile+"; wait\n"))
	var child int
	for i := 0; i < 100 && child == 0; i++ {
		time.Sleep(50 * time.Millisecond)
		b, _ := os.ReadFile(pidFile)
		child = atoi(strings.TrimSpace(string(b)))
	}
	if child == 0 {
		t.Fatal("o sleep não começou")
	}
	if err := m.Close(info.ID); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 100; i++ {
		if syscall.Kill(child, 0) != nil {
			if len(m.List(pid)) != 0 {
				t.Fatal("o terminal fechado continua na lista")
			}
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("o processo do terminal sobreviveu ao fechamento")
}

func TestProjectCloseClosesTerminals(t *testing.T) {
	m, reg, pid, _ := setup(t)
	reg.SetTrusted(pid, true)
	m.Create(pid, "", 80, 24)
	reg.Remove(pid)
	if len(m.List(pid)) != 0 {
		t.Fatal("terminais deveriam fechar com o projeto")
	}
	if _, err := m.Output("nao-existe"); err != ErrNotFound {
		t.Fatalf("id desconhecido: %v", err)
	}
}

func atoi(s string) int {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0
		}
		n = n*10 + int(c-'0')
	}
	return n
}
