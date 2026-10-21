package run

import (
	"context"
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

func TestBeforeLaunchTasks(t *testing.T) {
	goExe, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go ausente")
	}
	ctx := context.Background()
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "go.mod"), []byte("module demo\n\ngo 1.22\n"), 0o644)
	// go:generate escreve o gerado.go que o main usa: sem a tarefa, não compila.
	os.WriteFile(filepath.Join(root, "main.go"), []byte("package main\n\n//go:generate go run ./gen\n\nfunc main() { println(Gerado) }\n"), 0o644)
	os.MkdirAll(filepath.Join(root, "gen"), 0o755)
	os.WriteFile(filepath.Join(root, "gen", "main.go"), []byte("package main\n\nimport \"os\"\n\nfunc main() { os.WriteFile(\"gerado.go\", []byte(\"package main\\n\\nconst Gerado = \\\"ok-gerado\\\"\\n\"), 0o644) }\n"), 0o644)
	db, _ := store.Open(ctx, filepath.Join(t.TempDir(), "s.db"))
	defer db.Close()
	p, _ := db.TouchProject(ctx, root, "demo")
	reg := workspace.NewRegistry(db)
	reg.Add(ctx, p)
	reg.SetTrusted(p.ID, true)
	m := NewManager(db, reg, events.NewBus(), func() string { return goExe }, t.TempDir())
	rc := NewRunConfigs(db, reg)

	run := func(id string) string {
		info, err := m.Start(p.ID, id)
		if err != nil {
			t.Fatal(err)
		}
		out, _ := m.Output(info.ID)
		cur := out.Subscribe()
		defer cur.Close()
		return readAll(t, cur, 90*time.Second)
	}
	dir := ""
	main := store.RunConfig{Name: "Main", Type: "go_build", RunKind: "directory", Directory: &dir, RunAfterBuild: true,
		BeforeLaunch: []store.BeforeTask{{Kind: "go_generate"}}}
	main, err = rc.Save(p.ID, main)
	if err != nil {
		t.Fatal(err)
	}
	if len(main.BeforeLaunch) != 1 || main.BeforeLaunch[0].Kind != "go_generate" {
		t.Fatalf("tarefas gravadas: %+v", main.BeforeLaunch)
	}
	if text := run(main.ID); !strings.Contains(text, "$ go generate .") || !strings.Contains(text, "ok-gerado") {
		t.Fatalf("go generate antes:\n%s", text)
	}

	// Comando que falha: para antes de compilar.
	bad := "go vet ./nao-existe"
	main.BeforeLaunch = []store.BeforeTask{{Kind: "external_tool", Command: &bad}}
	main, _ = rc.Save(p.ID, main)
	if text := run(main.ID); !strings.Contains(text, "falhou") || strings.Contains(text, "$ go build") {
		t.Fatalf("tarefa que falha:\n%s", text)
	}

	// Outra config antes; e o ciclo é recusado no Save.
	other, err := rc.Save(p.ID, store.RunConfig{Name: "Gera", Type: "go_build", RunKind: "directory", Directory: &dir,
		BeforeLaunch: []store.BeforeTask{{Kind: "go_generate"}}})
	if err != nil {
		t.Fatal(err)
	}
	main.BeforeLaunch = []store.BeforeTask{{Kind: "run_config", Ref: &other.ID}}
	main, _ = rc.Save(p.ID, main)
	if text := run(main.ID); !strings.Contains(text, "rodando antes: Gera") || !strings.Contains(text, "ok-gerado") {
		t.Fatalf("outra config antes:\n%s", text)
	}
	other.BeforeLaunch = []store.BeforeTask{{Kind: "run_config", Ref: &main.ID}}
	if _, err := rc.Save(p.ID, other); err == nil || !strings.Contains(err.Error(), "ciclo") {
		t.Fatalf("ciclo deveria ser recusado: %v", err)
	}
	self := []store.BeforeTask{{Kind: "run_config", Ref: &main.ID}}
	main.BeforeLaunch = self
	if _, err := rc.Save(p.ID, main); err == nil || !strings.Contains(err.Error(), "si mesma") {
		t.Fatalf("a si mesma: %v", err)
	}
}
