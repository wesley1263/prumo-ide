package run

import (
	"context"
	"encoding/json"
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

const calcTest = `package calc

import "testing"

func TestAdd(t *testing.T) {
	if 1+1 != 2 {
		t.Fatal("soma")
	}
}

func TestSub(t *testing.T) {
	t.Log("conta errada de propósito")
	t.Fatal("2-1 deveria ser 1")
}

func TestTable(t *testing.T) {
	cases := []struct {
		name string
		in   int
	}{
		{"positivo", 1},
		{"negativo", -1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if c.in < 0 {
				t.Errorf("negativo: %d", c.in)
			}
		})
	}
}

func TestSkip(t *testing.T) { t.Skip("depois") }
`

type testFixture struct {
	m   *Manager
	rc  *RunConfigs
	p   store.Project
	reg *workspace.Registry
}

func newTestFixture(t *testing.T) *testFixture {
	t.Helper()
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("go ausente")
	}
	ctx := context.Background()
	root := t.TempDir()
	if real, err := filepath.EvalSymlinks(root); err == nil {
		root = real
	}
	os.WriteFile(filepath.Join(root, "go.mod"), []byte("module demo\n\ngo 1.22\n"), 0o644)
	os.MkdirAll(filepath.Join(root, "calc"), 0o755)
	os.WriteFile(filepath.Join(root, "calc", "calc_test.go"), []byte(calcTest), 0o644)
	os.MkdirAll(filepath.Join(root, "quebrado"), 0o755)
	os.WriteFile(filepath.Join(root, "quebrado", "q_test.go"), []byte("package quebrado\n\nimport \"testing\"\n\nfunc TestX(t *testing.T) { var x int = \"s\" }\n"), 0o644)
	db, _ := store.Open(ctx, filepath.Join(t.TempDir(), "s.db"))
	t.Cleanup(func() { db.Close() })
	p, _ := db.TouchProject(ctx, root, "demo")
	reg := workspace.NewRegistry(db)
	reg.Add(ctx, p)
	reg.SetTrusted(p.ID, true)
	goExe, _ := exec.LookPath("go")
	m := NewManager(db, reg, events.NewBus(), func() string { return goExe }, t.TempDir())
	return &testFixture{m: m, rc: NewRunConfigs(db, reg), p: p, reg: reg}
}

func (f *testFixture) runAndWait(t *testing.T, cfgID string) TestRun {
	t.Helper()
	info, err := f.m.Start(f.p.ID, cfgID)
	if err != nil {
		t.Fatal(err)
	}
	return f.wait(t, info.ID)
}

func (f *testFixture) wait(t *testing.T, runID string) TestRun {
	t.Helper()
	deadline := time.Now().Add(2 * time.Minute)
	for time.Now().Before(deadline) {
		r, err := f.m.Tests(runID)
		if err != nil {
			t.Fatal(err)
		}
		if r.State != StateBuilding && r.State != StateRunning {
			return r
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("timeout esperando os testes")
	return TestRun{}
}

func status(r TestRun, name string) string {
	for _, n := range r.Nodes {
		if n.Name == name {
			return n.Status
		}
	}
	return "(ausente)"
}

func TestGoTestTreeLocateAndRerunFailed(t *testing.T) {
	f := newTestFixture(t)
	cfg, err := f.rc.FromContext(f.p.ID, "calc/calc_test.go", "")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Type != "go_test" || cfg.Name != "go test calc" {
		t.Fatalf("config: %+v", cfg)
	}
	r := f.runAndWait(t, cfg.ID)
	want := map[string]string{
		"TestAdd": "passed", "TestSub": "failed", "TestTable": "failed",
		"TestTable/positivo": "passed", "TestTable/negativo": "failed", "TestSkip": "skipped", "": "failed",
	}
	for name, st := range want {
		if got := status(r, name); got != st {
			t.Errorf("%q = %s; quero %s", name, got, st)
		}
	}
	if r.Passed != 2 || r.Failed != 3 || r.Skipped != 1 {
		t.Fatalf("contagens: %d/%d/%d", r.Passed, r.Failed, r.Skipped)
	}
	for _, n := range r.Nodes {
		if n.Name == "TestSub" && !strings.Contains(n.Output, "conta errada de propósito") {
			t.Fatalf("saída do teste não guardada: %q", n.Output)
		}
	}

	// Do resultado para o código: teste e subteste.
	loc, err := f.m.Locate(f.p.ID, r.RunID, "demo/calc", "TestSub")
	if err != nil || loc.File != "calc/calc_test.go" || loc.Line != 11 {
		t.Fatalf("Locate TestSub: %+v %v", loc, err)
	}
	loc, err = f.m.Locate(f.p.ID, r.RunID, "demo/calc", "TestTable/negativo")
	if err != nil || loc.Line != 22 { // {"negativo", -1}
		t.Fatalf("Locate subteste: %+v %v", loc, err)
	}

	// Rodar de novo só os que falharam.
	info, err := f.m.RerunFailed(f.p.ID, r.RunID)
	if err != nil {
		t.Fatal(err)
	}
	r2 := f.wait(t, info.ID)
	if status(r2, "TestAdd") != "(ausente)" || status(r2, "TestSkip") != "(ausente)" || status(r2, "TestSub") != "failed" {
		t.Fatalf("rerun deveria ter só os falhos: %+v", r2.Nodes)
	}
}

func TestGoTestSingleAndBuildError(t *testing.T) {
	f := newTestFixture(t)
	cfg, _ := f.rc.FromContext(f.p.ID, "calc/calc_test.go", "TestTable/negativo")
	if *cfg.TestPattern != "^TestTable$/^negativo$" {
		t.Fatalf("padrão: %s", *cfg.TestPattern)
	}
	r := f.runAndWait(t, cfg.ID)
	if status(r, "TestTable/positivo") != "(ausente)" || status(r, "TestTable/negativo") != "failed" {
		t.Fatalf("só o subteste pedido: %+v", r.Nodes)
	}

	bad, _ := f.rc.FromContext(f.p.ID, "quebrado/q_test.go", "")
	info, _ := f.m.Start(f.p.ID, bad.ID)
	rb := f.wait(t, info.ID)
	if status(rb, "") != "failed" {
		t.Fatalf("pacote que não compila deveria falhar: %+v", rb.Nodes)
	}
	out, _ := f.m.Output(info.ID)
	cur := out.Subscribe()
	defer cur.Close()
	text := readAll(t, cur, 30*time.Second)
	if !strings.Contains(text, "cannot use") {
		t.Fatalf("erro de compilação deveria ir para o console:\n%s", text)
	}
}

func TestBenchAndFuzzArgs(t *testing.T) {
	cases := []struct {
		pattern string
		extra   []string
		want    string
	}{
		{"^TestA$", nil, "-run ^TestA$"},
		{"^BenchmarkSoma$", nil, "-run ^$ -bench ^BenchmarkSoma$ -benchmem"},
		{"^FuzzEco$", nil, "-run ^$ -fuzz ^FuzzEco$ -fuzztime 10s"},
		{"^FuzzEco$", []string{"-fuzztime=3s"}, "-run ^$ -fuzz ^FuzzEco$"},
	}
	for _, c := range cases {
		if got := strings.Join(testModeArgs(c.pattern, c.extra), " "); got != c.want {
			t.Errorf("%s: %q, queria %q", c.pattern, got, c.want)
		}
	}
}

func TestBenchmarkNodeClosesWithPackage(t *testing.T) {
	ts := newTestState(func() {})
	for _, l := range []string{
		`{"Action":"start","Package":"bx"}`,
		`{"Action":"run","Package":"bx","Test":"BenchmarkSoma"}`,
		`{"Action":"output","Package":"bx","Test":"BenchmarkSoma","Output":"BenchmarkSoma-12    \t     100\t         6.960 ns/op\t       0 B/op\t       0 allocs/op\n"}`,
		`{"Action":"pass","Package":"bx","Elapsed":0.006}`,
		`{"Action":"run","Package":"bx","Test":"FuzzEco"}`,
		`{"Action":"output","Package":"bx","Test":"FuzzEco","Output":"fuzz: elapsed: 3s, execs: 69165 (23051/sec), new interesting: 0 (total: 1)\n"}`,
		`{"Action":"pass","Package":"bx","Test":"FuzzEco","Elapsed":3.03}`,
	} {
		var e event
		if err := json.Unmarshal([]byte(l), &e); err != nil {
			t.Fatal(err)
		}
		ts.apply(e)
	}
	snap := ts.snapshot("r", StateExited)
	got := map[string]TestNode{}
	for _, n := range snap.Nodes {
		got[n.Name] = n
	}
	if b := got["BenchmarkSoma"]; b.Status != "passed" || b.Summary != "100× · 6.960 ns/op · 0 B/op · 0 allocs/op" {
		t.Errorf("benchmark: %+v", b)
	}
	if f := got["FuzzEco"]; f.Status != "passed" || !strings.HasPrefix(f.Summary, "elapsed: 3s, execs: 69165") {
		t.Errorf("fuzz: %+v", f)
	}
}
