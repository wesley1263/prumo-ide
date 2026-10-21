package debug

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"prumo/internal/events"
	"prumo/internal/run"
	"prumo/internal/store"
	"prumo/internal/workspace"
)

func find(name string) string {
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	if home, err := os.UserHomeDir(); err == nil {
		p := filepath.Join(home, "go", "bin", name)
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

const prog = `package main

import "fmt"

type item struct {
	Name  string
	Price int
}

func total(items []item) int {
	sum := 0
	for _, it := range items {
		sum += it.Price
	}
	return sum
}

func main() {
	items := []item{{"café", 3490}, {"caneca", 5900}}
	t := total(items)
	fmt.Println("total", t)
}
`

const progTest = `package main

import "testing"

func TestTotal(t *testing.T) {
	got := total([]item{{"a", 1}, {"b", 2}})
	if got != 3 {
		t.Fatal(got)
	}
}
`

type fixture struct {
	m    *Manager
	db   *store.DB
	p    store.Project
	bus  *events.Bus
	evs  <-chan events.Event
	root string
}

func setup(t *testing.T) *fixture {
	t.Helper()
	if find("dlv") == "" || find("go") == "" {
		t.Skip("dlv ou go ausente")
	}
	if testing.Short() {
		t.Skip("integração com o Delve")
	}
	ctx := context.Background()
	root := t.TempDir()
	if real, err := filepath.EvalSymlinks(root); err == nil {
		root = real
	}
	os.WriteFile(filepath.Join(root, "go.mod"), []byte("module demo\n\ngo 1.22\n"), 0o644)
	os.WriteFile(filepath.Join(root, "main.go"), []byte(prog), 0o644)
	os.WriteFile(filepath.Join(root, "main_test.go"), []byte(progTest), 0o644)
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "s.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	p, _ := db.TouchProject(ctx, root, "demo")
	reg := workspace.NewRegistry(db)
	reg.Add(ctx, p)
	reg.SetTrusted(p.ID, true)
	bus := events.NewBus()
	evs, unsub := bus.Subscribe()
	t.Cleanup(unsub)
	m := NewManager(db, reg, bus, func() string { return find("dlv") }, func() string { return find("go") })
	t.Cleanup(m.StopAll)
	return &fixture{m: m, db: db, p: p, bus: bus, evs: evs, root: root}
}

// waitState espera um debug:state com o estado pedido (e a posição já resolvida, quando parado).
func (f *fixture) waitState(t *testing.T, id, state string) Info {
	t.Helper()
	deadline := time.After(3 * time.Minute)
	for {
		select {
		case ev := <-f.evs:
			if i, ok := ev.Data.(Info); ok && i.ID == id && i.State == state && (state != StateStopped || i.Line > 0) {
				return i
			}
		case <-deadline:
			t.Fatalf("timeout esperando %s", state)
		}
	}
}

func readOut(t *testing.T, o *run.Output) string {
	t.Helper()
	cur := o.Subscribe()
	defer cur.Close()
	var b strings.Builder
	deadline := time.After(time.Minute)
	for {
		batch, _, done := cur.Next(1 << 20)
		for _, c := range batch {
			b.WriteString(c.D)
		}
		if done {
			return b.String()
		}
		if len(batch) == 0 {
			select {
			case <-cur.C:
			case <-deadline:
				t.Fatal("timeout lendo a saída")
			}
		}
	}
}

func TestDebugProgramBreakpointVariablesStep(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	// Breakpoint em "sum += it.Price" (linha 13).
	if on, err := f.db.ToggleLineBreakpoint(ctx, f.p.ID, "main.go", 13); err != nil || !on {
		t.Fatalf("toggle: %v %v", on, err)
	}
	dir := ""
	cfg, err := f.db.SaveRunConfig(ctx, store.RunConfig{ProjectID: f.p.ID, Name: "demo", Type: "go_build", RunKind: "directory", Directory: &dir, RunAfterBuild: true})
	if err != nil {
		t.Fatal(err)
	}
	info, err := f.m.Start(f.p.ID, cfg.ID)
	if err != nil {
		t.Fatal(err)
	}
	stop := f.waitState(t, info.ID, StateStopped)
	if stop.File != "main.go" || stop.Line != 13 || stop.Reason != "breakpoint" {
		t.Fatalf("parou em %s:%d (%s)", stop.File, stop.Line, stop.Reason)
	}

	frames, err := f.m.Stack(info.ID, 0)
	if err != nil || len(frames) < 2 || frames[0].Name != "main.total" || frames[1].Name != "main.main" {
		t.Fatalf("pilha: %+v %v", frames, err)
	}
	scopes, err := f.m.Scopes(info.ID, frames[0].ID)
	if err != nil || len(scopes) == 0 {
		t.Fatalf("escopos: %+v %v", scopes, err)
	}
	vars, err := f.m.Variables(info.ID, scopes[0].Ref, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]Variable{}
	for _, v := range vars {
		names[v.Name] = v
	}
	if names["sum"].Value != "0" || names["it"].Ref == 0 {
		t.Fatalf("variáveis: %+v", vars)
	}
	// Filhos de uma struct.
	kids, err := f.m.Variables(info.ID, names["it"].Ref, 0, 0)
	if err != nil || len(kids) != 2 || !strings.Contains(kids[0].Value, "café") {
		t.Fatalf("campos de it: %+v %v", kids, err)
	}
	ev, err := f.m.Evaluate(info.ID, frames[0].ID, "it.Price * 2")
	if err != nil || ev.Value != "6980" {
		t.Fatalf("evaluate: %+v %v", ev, err)
	}
	gs, err := f.m.Goroutines(info.ID)
	if err != nil || len(gs) == 0 {
		t.Fatalf("goroutines: %+v %v", gs, err)
	}
	// A que parou está marcada e é a main; as do runtime vêm marcadas como sistema.
	var cur *Goroutine
	system := 0
	for i := range gs {
		if gs[i].Current {
			cur = &gs[i]
		}
		if gs[i].System {
			system++
		}
	}
	if cur == nil || cur.Function != "main.total" || cur.System { // o breakpoint está dentro de total()
		t.Fatalf("goroutine atual: %+v (todas: %+v)", cur, gs)
	}
	if system == 0 {
		t.Logf("nenhuma goroutine do runtime listada (pode variar com a versão do Go): %+v", gs)
	}

	// Step over: sai do loop para a próxima iteração (mesmo breakpoint) ou próxima linha.
	if err := f.m.Control(info.ID, "stepOver", 0); err != nil {
		t.Fatal(err)
	}
	next := f.waitState(t, info.ID, StateStopped)
	if next.Line == 0 {
		t.Fatal("step sem posição")
	}
	// Tira o breakpoint com a sessão viva e continua até o fim.
	if on, _ := f.db.ToggleLineBreakpoint(ctx, f.p.ID, "main.go", 13); on {
		t.Fatal("deveria desligar")
	}
	f.m.SyncFile(f.p.ID, "main.go")
	out, _ := f.m.Output(info.ID)
	if err := f.m.Control(info.ID, "resume", 0); err != nil {
		t.Fatal(err)
	}
	end := f.waitState(t, info.ID, StateTerminated)
	text := readOut(t, out)
	if !strings.Contains(text, "total 9390") {
		t.Fatalf("saída do programa:\n%s", text)
	}
	if end.ExitCode == nil || *end.ExitCode != 0 {
		t.Fatalf("código de saída: %+v", end.ExitCode)
	}
}

func TestDebugTest(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	f.db.ToggleLineBreakpoint(ctx, f.p.ID, "main_test.go", 7) // "if got != 3"
	dir := ""
	pat := "^TestTotal$"
	fw := "gotest"
	cfg, _ := f.db.SaveRunConfig(ctx, store.RunConfig{ProjectID: f.p.ID, Name: "TestTotal", Type: "go_test", RunKind: "directory", Directory: &dir, TestFramework: &fw, TestPattern: &pat})
	info, err := f.m.Start(f.p.ID, cfg.ID)
	if err != nil {
		t.Fatal(err)
	}
	stop := f.waitState(t, info.ID, StateStopped)
	if stop.File != "main_test.go" || stop.Line != 7 {
		t.Fatalf("parou em %s:%d", stop.File, stop.Line)
	}
	frames, _ := f.m.Stack(info.ID, 0)
	scopes, _ := f.m.Scopes(info.ID, frames[0].ID)
	vars, _ := f.m.Variables(info.ID, scopes[0].Ref, 0, 0)
	found := false
	for _, v := range vars {
		if v.Name == "got" && v.Value == "3" {
			found = true
		}
	}
	if !found {
		t.Fatalf("got=3 não encontrado: %+v", vars)
	}
	if err := f.m.Stop(info.ID); err != nil {
		t.Fatal(err)
	}
	f.waitState(t, info.ID, StateTerminated)
}

func TestUntrustedCannotDebug(t *testing.T) {
	f := setup(t)
	reg := workspace.NewRegistry(f.db)
	p, _ := f.db.TouchProject(context.Background(), t.TempDir(), "x")
	reg.Add(context.Background(), p)
	m := NewManager(f.db, reg, f.bus, func() string { return find("dlv") }, func() string { return find("go") })
	if _, err := m.Start(p.ID, "qualquer"); err != workspace.ErrUntrusted {
		t.Fatalf("esperava ErrUntrusted, veio %v", err)
	}
}

func TestParseGoroutine(t *testing.T) {
	cases := map[string]Goroutine{
		"* [Go 1] main.main (Thread 4242)":                       {ID: 1, Function: "main.main", Current: true},
		"[Go 7] example.com/app/worker.Run":                      {ID: 7, Function: "example.com/app/worker.Run"},
		"* [Go 1] example.com/app/cart.(*Cart).Total (Thread 7)": {ID: 1, Function: "example.com/app/cart.(*Cart).Total", Current: true},
		"[Go 2] runtime.gopark":                                  {ID: 2, Function: "runtime.gopark", System: true},
		"[Go 9] internal/poll.runtime_pollWait":                  {ID: 9, Function: "internal/poll.runtime_pollWait", System: true},
		"Thread 1":                                               {ID: 1, System: true},
	}
	for name, want := range cases {
		got := parseGoroutine(want.ID, name)
		want.Name = name
		if got != want {
			t.Errorf("parseGoroutine(%q) = %+v; quero %+v", name, got, want)
		}
	}
}

// Silenciar: o breakpoint continua salvo, mas o programa roda até o fim sem parar.
// Breakpoint em panic: para dentro do runtime.gopanic mesmo num panic recuperado.
func TestMutedAndPanicBreakpoints(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	os.WriteFile(filepath.Join(f.root, "main.go"), []byte(`package main

import "fmt"

func arrisca() (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("recuperado: %v", r)
		}
	}()
	panic("ops")
}

func main() {
	fmt.Println("antes")
	fmt.Println(arrisca())
}
`), 0o644)
	os.Remove(filepath.Join(f.root, "main_test.go"))
	if _, err := f.db.ToggleLineBreakpoint(ctx, f.p.ID, "main.go", 15); err != nil {
		t.Fatal(err)
	}
	dir := ""
	cfg, err := f.db.SaveRunConfig(ctx, store.RunConfig{ProjectID: f.p.ID, Name: "demo", Type: "go_build", RunKind: "directory", Directory: &dir, RunAfterBuild: true})
	if err != nil {
		t.Fatal(err)
	}

	f.m.SetMuted(f.p.ID, true)
	if !f.m.Muted(f.p.ID) {
		t.Fatal("deveria estar silenciado")
	}
	info, err := f.m.Start(f.p.ID, cfg.ID)
	if err != nil {
		t.Fatal(err)
	}
	f.waitState(t, info.ID, StateTerminated) // passou pelo breakpoint sem parar

	f.m.SetMuted(f.p.ID, false)
	bps, _ := f.db.ListBreakpoints(ctx, f.p.ID)
	if err := f.db.DeleteBreakpoint(ctx, f.p.ID, bps[0].ID); err != nil {
		t.Fatal(err)
	}
	if err := f.db.SetPanicBreakpoint(ctx, f.p.ID, true); err != nil {
		t.Fatal(err)
	}
	info, err = f.m.Start(f.p.ID, cfg.ID)
	if err != nil {
		t.Fatal(err)
	}
	stop := f.waitState(t, info.ID, StateStopped)
	frames, err := f.m.Stack(info.ID, 0)
	if err != nil || len(frames) == 0 || frames[0].Name != "runtime.gopanic" {
		t.Fatalf("deveria parar no runtime.gopanic (parou em %s:%d %s): %+v %v", stop.File, stop.Line, stop.Reason, frames, err)
	}
	called := false
	for _, fr := range frames {
		called = called || fr.Name == "main.arrisca"
	}
	if !called {
		t.Fatalf("main.arrisca deveria estar na pilha: %+v", frames)
	}
}
