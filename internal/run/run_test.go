package run

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"

	"goide/internal/events"
	"goide/internal/store"
	"goide/internal/workspace"
)

func TestSplitArgs(t *testing.T) {
	cases := map[string][]string{
		``:                   nil,
		`a b  c`:             {"a", "b", "c"},
		`-name "John Doe" x`: {"-name", "John Doe", "x"},
		`'it''s' "a\"b"`:     {"its", `a"b`},
		`a\ b`:               {"a b"},
		`""`:                 {""},
	}
	for in, want := range cases {
		got, err := SplitArgs(in)
		if err != nil || !reflect.DeepEqual(got, want) {
			t.Errorf("SplitArgs(%q) = %#v, %v; quero %#v", in, got, err, want)
		}
	}
	if _, err := SplitArgs(`"aberto`); err == nil {
		t.Error("aspas abertas deveriam falhar")
	}
}

func TestOutputLimitAndCursor(t *testing.T) {
	o := NewOutput(10)
	o.Write("out", "12345")
	o.Write("out", "67890")
	o.Write("err", "abc")
	cur := o.Subscribe()
	defer cur.Close()
	batch, skipped, done := cur.Next(1 << 10)
	// "12345" saiu pelo teto antes de o cursor existir: começa do mais antigo guardado, sem "skipped".
	if skipped || done || len(batch) != 2 || batch[0].D != "67890" || batch[1].D != "abc" {
		t.Fatalf("lote inicial: %+v skipped=%v done=%v", batch, skipped, done)
	}
	o.Write("out", "x")
	<-cur.C
	if batch, _, _ := cur.Next(1 << 10); len(batch) != 1 || batch[0].D != "x" {
		t.Fatalf("ao vivo: %+v", batch)
	}
	// Cursor que fica para trás do teto é avisado.
	for i := 0; i < 5; i++ {
		o.Write("out", "0123456789")
	}
	if _, skipped, _ := cur.Next(1 << 10); !skipped {
		t.Fatal("deveria avisar que parte foi descartada")
	}
	o.Close()
	if _, _, done := cur.Next(1 << 10); !done {
		t.Fatal("deveria terminar depois do Close")
	}
	o.Write("out", "depois") // não pode entrar em pânico
}

// readAll consome um cursor até o fim e devolve "tipo:texto" de tudo.
func readAll(t *testing.T, cur *Cursor, timeout time.Duration) string {
	t.Helper()
	var all strings.Builder
	deadline := time.After(timeout)
	for {
		batch, _, done := cur.Next(64 << 10)
		for _, c := range batch {
			all.WriteString(c.T + ":" + c.D)
		}
		if done {
			return all.String()
		}
		if len(batch) == 0 {
			select {
			case <-cur.C:
			case <-deadline:
				t.Fatal("timeout esperando a saída")
			}
		}
	}
}

// Fluxo real: projeto com main, config pelo contexto, compila, roda e lê a saída.
func TestStartRunsMain(t *testing.T) {
	goExe, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go ausente")
	}
	ctx := context.Background()
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "go.mod"), []byte("module demo\n\ngo 1.22\n"), 0o644)
	os.MkdirAll(filepath.Join(root, "cmd", "hi"), 0o755)
	os.WriteFile(filepath.Join(root, "cmd", "hi", "main.go"), []byte(`package main

import ("fmt"; "os")

func main() { fmt.Println("olá", os.Args[1:]); fmt.Fprintln(os.Stderr, "aviso"); os.Exit(3) }
`), 0o644)

	db, _ := store.Open(ctx, filepath.Join(t.TempDir(), "s.db"))
	defer db.Close()
	p, _ := db.TouchProject(ctx, root, "demo")
	reg := workspace.NewRegistry(db)
	reg.Add(ctx, p)
	bus := events.NewBus()
	states, unsub := bus.Subscribe()
	defer unsub()
	m := NewManager(db, reg, bus, func() string { return goExe }, t.TempDir())
	rc := NewRunConfigs(db, reg)

	cfg, err := rc.FromContext(p.ID, "cmd/hi/main.go", "")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Name != "go build cmd/hi" || !cfg.Temporary {
		t.Fatalf("config: %+v", cfg)
	}
	again, _ := rc.FromContext(p.ID, "cmd/hi/main.go", "")
	if again.ID != cfg.ID {
		t.Fatal("deveria reaproveitar a config temporária")
	}
	cfg.ProgramArgs = `um "dois três"`
	cfg, _ = rc.Save(p.ID, cfg)

	if _, err := m.Start(p.ID, cfg.ID); err != workspace.ErrUntrusted {
		t.Fatalf("rodar sem confiança deveria falhar: %v", err)
	}
	reg.SetTrusted(p.ID, true)
	info, err := m.Start(p.ID, cfg.ID)
	if err != nil {
		t.Fatal(err)
	}
	out, _ := m.Output(info.ID)
	cur := out.Subscribe()
	defer cur.Close()
	text := readAll(t, cur, 60*time.Second)
	for _, want := range []string{"out:olá [um dois três]", "err:aviso", "código 3"} {
		if !strings.Contains(text, want) {
			t.Errorf("saída sem %q:\n%s", want, text)
		}
	}
	var last Info
	for len(states) > 0 {
		ev := <-states
		if i, ok := ev.Data.(Info); ok && i.ID == info.ID {
			last = i
		}
	}
	if last.State != StateExited || last.ExitCode == nil || *last.ExitCode != 3 {
		t.Fatalf("estado final: %+v", last)
	}
}

func TestStopKillsRunningProgram(t *testing.T) {
	goExe, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go ausente")
	}
	ctx := context.Background()
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "go.mod"), []byte("module demo\n\ngo 1.22\n"), 0o644)
	os.WriteFile(filepath.Join(root, "main.go"), []byte("package main\n\nimport \"time\"\n\nfunc main() { println(\"pronto\"); time.Sleep(time.Hour) }\n"), 0o644)
	db, _ := store.Open(ctx, filepath.Join(t.TempDir(), "s.db"))
	defer db.Close()
	p, _ := db.TouchProject(ctx, root, "demo")
	reg := workspace.NewRegistry(db)
	reg.Add(ctx, p)
	reg.SetTrusted(p.ID, true)
	m := NewManager(db, reg, events.NewBus(), func() string { return goExe }, t.TempDir())
	cfg, _ := NewRunConfigs(db, reg).FromContext(p.ID, "main.go", "")
	info, err := m.Start(p.ID, cfg.ID)
	if err != nil {
		t.Fatal(err)
	}
	out, _ := m.Output(info.ID)
	cur := out.Subscribe()
	defer cur.Close()
	deadline := time.After(60 * time.Second)
	for {
		batch, _, _ := cur.Next(64 << 10)
		for _, c := range batch {
			if strings.Contains(c.D, "pronto") {
				if err := m.Stop(info.ID); err != nil {
					t.Fatal(err)
				}
				readAll(t, cur, 10*time.Second)
				if got := m.List(p.ID)[0].State; got != StateStopped {
					t.Fatalf("estado depois do Stop: %s", got)
				}
				return
			}
		}
		select {
		case <-cur.C:
		case <-deadline:
			t.Fatal("timeout")
		}
	}
}

func TestOutputSlowReaderGetsEverything(t *testing.T) {
	o := NewOutput(OutputLimit)
	cur := o.Subscribe()
	defer cur.Close()
	const n = 20000
	go func() {
		for i := 0; i < n; i++ {
			o.Write("out", "x\n")
		}
		o.Close()
	}()
	got := 0
	for {
		batch, skipped, done := cur.Next(64 << 10)
		if skipped {
			t.Fatal("não deveria descartar nada abaixo do limite")
		}
		for _, c := range batch {
			got += strings.Count(c.D, "\n")
		}
		if done {
			break
		}
		if len(batch) == 0 {
			<-cur.C
		}
		time.Sleep(time.Millisecond) // leitor lento
	}
	if got != n {
		t.Fatalf("recebeu %d linhas de %d", got, n)
	}
}

func TestTestPattern(t *testing.T) {
	cases := map[string]string{
		"TestTotal":        "^TestTotal$",
		"TestTotal/caso 1": "^TestTotal$/^caso_1$",
		"TestA/b.c/(x)":    `^TestA$/^b\.c$/^\(x\)$`,
	}
	for in, want := range cases {
		if got := TestPattern(in); got != want {
			t.Errorf("TestPattern(%q) = %q; quero %q", in, got, want)
		}
	}
}

func TestStartGoToolTidyAndValidation(t *testing.T) {
	goExe, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go ausente")
	}
	ctx := context.Background()
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "go.mod"), []byte("module ex.com/t\n\ngo 1.22\n\nrequire ex.com/nada v1.0.0\n"), 0o644)
	os.WriteFile(filepath.Join(root, "t.go"), []byte("package t\n"), 0o644)
	db, _ := store.Open(ctx, filepath.Join(t.TempDir(), "s.db"))
	defer db.Close()
	p, _ := db.TouchProject(ctx, root, "t")
	reg := workspace.NewRegistry(db)
	reg.Add(ctx, p)
	m := NewManager(db, reg, events.NewBus(), func() string { return goExe }, t.TempDir())
	if _, err := m.StartGoTool(p.ID, "mod-tidy", ""); err == nil {
		t.Fatal("sem confiança deveria falhar")
	}
	reg.SetTrusted(p.ID, true)
	for tool, arg := range map[string]string{"rm": "", "get": "", "get ": "x; rm -rf /"} {
		if _, err := m.StartGoTool(p.ID, strings.TrimSpace(tool), arg); err == nil {
			t.Errorf("%q %q deveria ser recusado", tool, arg)
		}
	}
	info, err := m.StartGoTool(p.ID, "mod-tidy", "")
	if err != nil {
		t.Fatal(err)
	}
	out, _ := m.Output(info.ID)
	text := readAll(t, out.Subscribe(), time.Minute)
	if !strings.Contains(text, "$ go mod tidy") || !strings.Contains(text, "Pronto.") {
		t.Fatalf("saída: %s", text)
	}
	// O require sem uso sumiu do go.mod.
	if b, _ := os.ReadFile(filepath.Join(root, "go.mod")); strings.Contains(string(b), "ex.com/nada") {
		t.Fatalf("go mod tidy não limpou: %s", b)
	}
}

func TestVetPackagesOfFiles(t *testing.T) {
	goExe, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go ausente")
	}
	ctx := context.Background()
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "go.mod"), []byte("module ex.com/v\n\ngo 1.22\n"), 0o644)
	os.MkdirAll(filepath.Join(root, "ok"), 0o755)
	os.MkdirAll(filepath.Join(root, "ruim"), 0o755)
	os.WriteFile(filepath.Join(root, "ok", "ok.go"), []byte("package ok\n\nfunc A() int { return 1 }\n"), 0o644)
	os.WriteFile(filepath.Join(root, "ruim", "ruim.go"), []byte("package ruim\n\nimport \"fmt\"\n\nfunc B() { fmt.Printf(\"%d\\n\", \"x\") }\n"), 0o644)
	db, _ := store.Open(ctx, filepath.Join(t.TempDir(), "s.db"))
	defer db.Close()
	p, _ := db.TouchProject(ctx, root, "v")
	reg := workspace.NewRegistry(db)
	reg.Add(ctx, p)
	reg.SetTrusted(p.ID, true)
	m := NewManager(db, reg, events.NewBus(), func() string { return goExe }, t.TempDir())
	if r, err := m.Vet(p.ID, []string{"ok/ok.go", "README.md"}); err != nil || !r.OK {
		t.Fatalf("pacote bom: %+v %v", r, err)
	}
	r, err := m.Vet(p.ID, []string{"ruim/ruim.go"})
	if err != nil || r.OK || !strings.Contains(r.Output, "wrong type") {
		t.Fatalf("pacote ruim: %+v %v", r, err)
	}
}

func TestTestPackagesBeforeCommit(t *testing.T) {
	goExe, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go ausente")
	}
	ctx := context.Background()
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "go.mod"), []byte("module ex.com/tp\n\ngo 1.22\n"), 0o644)
	os.WriteFile(filepath.Join(root, "a.go"), []byte("package tp\n\nfunc Dobro(x int) int { return x * 2 }\n"), 0o644)
	os.WriteFile(filepath.Join(root, "a_test.go"), []byte("package tp\n\nimport \"testing\"\n\nfunc TestDobro(t *testing.T) {\n\tif Dobro(2) != 5 {\n\t\tt.Fatal(\"dobro de 2 não é 5\")\n\t}\n}\n"), 0o644)
	db, _ := store.Open(ctx, filepath.Join(t.TempDir(), "s.db"))
	defer db.Close()
	p, _ := db.TouchProject(ctx, root, "tp")
	reg := workspace.NewRegistry(db)
	reg.Add(ctx, p)
	reg.SetTrusted(p.ID, true)
	m := NewManager(db, reg, events.NewBus(), func() string { return goExe }, t.TempDir())
	r, err := m.TestPackages(p.ID, []string{"a.go"})
	if err != nil || r.OK || !strings.Contains(r.Output, "dobro de 2 não é 5") {
		t.Fatalf("teste que falha: %+v %v", r, err)
	}
}

func TestEmulateTerminalRunsInPTY(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("sem ConPTY")
	}
	goExe, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go ausente")
	}
	ctx := context.Background()
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "go.mod"), []byte("module demo\n\ngo 1.22\n"), 0o644)
	// isatty sem dependência: no PTY, os.Stdout é um dispositivo de caractere.
	os.WriteFile(filepath.Join(root, "main.go"), []byte(`package main

import ("bufio"; "fmt"; "os")

func main() {
	st, _ := os.Stdout.Stat()
	fmt.Printf("tty=%v\n", st.Mode()&os.ModeCharDevice != 0)
	fmt.Println("nome?")
	s, _ := bufio.NewReader(os.Stdin).ReadString('\n')
	fmt.Printf("\x1b[32moi %s\x1b[0m", s)
}
`), 0o644)
	db, _ := store.Open(ctx, filepath.Join(t.TempDir(), "s.db"))
	defer db.Close()
	p, _ := db.TouchProject(ctx, root, "demo")
	reg := workspace.NewRegistry(db)
	reg.Add(ctx, p)
	reg.SetTrusted(p.ID, true)
	m := NewManager(db, reg, events.NewBus(), func() string { return goExe }, t.TempDir())
	rc := NewRunConfigs(db, reg)
	cfg, _ := rc.FromContext(p.ID, "main.go", "")
	cfg.EmulateTerminal = true
	cfg, _ = rc.Save(p.ID, cfg)
	info, err := m.Start(p.ID, cfg.ID)
	if err != nil {
		t.Fatal(err)
	}
	out, _ := m.Output(info.ID)
	cur := out.Subscribe()
	defer cur.Close()
	deadline := time.After(60 * time.Second)
	var text strings.Builder
	asked := false
	for {
		batch, _, done := cur.Next(64 << 10)
		for _, c := range batch {
			text.WriteString(c.T + ":" + c.D)
		}
		if !asked && strings.Contains(text.String(), "nome?") {
			asked = true
			if err := m.WriteStdin(info.ID, "Ana\n"); err != nil {
				t.Fatal(err)
			}
		}
		if done {
			break
		}
		select {
		case <-cur.C:
		case <-deadline:
			t.Fatalf("timeout:\n%s", text.String())
		}
	}
	got := text.String()
	for _, want := range []string{"tty=true", "\x1b[32moi Ana", "código 0"} {
		if !strings.Contains(got, want) {
			t.Errorf("saída sem %q:\n%q", want, got)
		}
	}
	if strings.Contains(got, "in:") {
		t.Errorf("no terminal a entrada já vem pelo eco, não como pedaço \"in\":\n%q", got)
	}
}
