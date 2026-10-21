package run

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"prumo/internal/events"
	"prumo/internal/proc"
	"prumo/internal/store"
	"prumo/internal/workspace"
)

// TestNode é um pacote (Name vazio), um teste ou um subteste ("TestA/caso_1").
type TestNode struct {
	Package   string  `json:"package"`
	Name      string  `json:"name"`
	Status    string  `json:"status"` // running | passed | failed | skipped
	ElapsedMs int64   `json:"elapsedMs"`
	Output    string  `json:"output"`
	Summary   string  `json:"summary,omitempty"` // benchmark: "100 · 6.96 ns/op · 0 B/op"; fuzz: o último "execs: …"
	order     int     // ordem de chegada (a árvore mostra na ordem em que rodou)
	elapsed   float64 // segundos, como vem do test2json
}

// TestRun é o resultado (parcial ou final) de uma execução de testes.
type TestRun struct {
	RunID   string     `json:"runId"`
	State   string     `json:"state"` // mesmo estado da execução
	Passed  int        `json:"passed"`
	Failed  int        `json:"failed"`
	Skipped int        `json:"skipped"`
	Nodes   []TestNode `json:"nodes"`
}

// testState acumula os eventos do test2json de uma execução.
type testState struct {
	mu     sync.Mutex
	nodes  map[string]*TestNode
	seq    int
	dirs   map[string]string // import path → pasta absoluta
	notify func()
}

const nodeOutputMax = 64 << 10

func newTestState(notify func()) *testState {
	return &testState{nodes: map[string]*TestNode{}, dirs: map[string]string{}, notify: notify}
}

// event é uma linha do "go test -json" (test2json). Desde o Go 1.24 os erros de compilação também vêm
// como eventos, com Action "build-output"/"build-fail" e ImportPath no lugar de Package.
type event struct {
	Action     string
	Package    string
	ImportPath string
	Test       string
	Elapsed    float64
	Output     string
}

func (ts *testState) node(pkg, name string) *TestNode {
	k := pkg + "\x00" + name
	n, ok := ts.nodes[k]
	if !ok {
		ts.seq++
		n = &TestNode{Package: pkg, Name: name, Status: "running", order: ts.seq}
		ts.nodes[k] = n
	}
	return n
}

func (ts *testState) apply(e event) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	if e.Package == "" {
		return
	}
	n := ts.node(e.Package, e.Test)
	switch e.Action {
	case "run", "start", "cont":
		n.Status = "running"
	case "pass":
		n.Status, n.elapsed = "passed", e.Elapsed
	case "fail":
		n.Status, n.elapsed = "failed", e.Elapsed
	case "skip":
		n.Status, n.elapsed = "skipped", e.Elapsed
	case "output":
		if len(n.Output) < nodeOutputMax {
			n.Output += e.Output
		}
		if sum := summaryOf(e.Test, e.Output); sum != "" {
			n.Summary = sum
		}
	}
	n.ElapsedMs = int64(n.elapsed * 1000)
	// Benchmark não ganha "pass"/"fail" próprio no test2json: fecha junto com o pacote.
	if e.Test == "" && (e.Action == "pass" || e.Action == "fail") {
		for _, b := range ts.nodes {
			if b.Package == e.Package && b.Status == "running" && strings.HasPrefix(b.Name, "Benchmark") {
				b.Status = map[string]string{"pass": "passed", "fail": "failed"}[e.Action]
			}
		}
	}
}

// Linha de resultado do benchmark: "BenchmarkSoma-12  \t 100\t 6.960 ns/op\t 0 B/op\t 0 allocs/op".
var benchLine = regexp.MustCompile(`^Benchmark\S*\s+(\d+)\s+(.+)$`)

func summaryOf(test, out string) string {
	out = strings.TrimSpace(out)
	switch {
	case strings.HasPrefix(test, "Benchmark"):
		if m := benchLine.FindStringSubmatch(out); m != nil {
			parts := []string{m[1] + "×"}
			for _, f := range strings.Split(m[2], "\t") {
				if f = strings.Join(strings.Fields(f), " "); f != "" {
					parts = append(parts, f)
				}
			}
			return strings.Join(parts, " · ")
		}
	case strings.HasPrefix(test, "Fuzz"):
		if rest, ok := strings.CutPrefix(out, "fuzz: "); ok && strings.Contains(rest, "execs:") {
			return rest
		}
	}
	return ""
}

// benchOrFuzz: o padrão aponta para um benchmark ou um alvo de fuzz (ex.: "^BenchmarkSoma$").
var benchOrFuzz = regexp.MustCompile(`^\^?(Benchmark|Fuzz)`)

// testModeArgs troca o -run pelo que o go test precisa para benchmark (-bench) e fuzz (-fuzz).
func testModeArgs(pattern string, extra []string) []string {
	m := benchOrFuzz.FindStringSubmatch(pattern)
	if m == nil {
		return []string{"-run", pattern}
	}
	if m[1] == "Benchmark" {
		return []string{"-run", "^$", "-bench", pattern, "-benchmem"}
	}
	args := []string{"-run", "^$", "-fuzz", pattern}
	for _, a := range extra {
		if strings.HasPrefix(a, "-fuzztime") {
			return args
		}
	}
	return append(args, "-fuzztime", "10s") // sem prazo, o fuzz roda até parar na mão
}

// snapshot devolve a árvore em ordem de chegada, com as contagens dos testes (não dos pacotes).
func (ts *testState) snapshot(runID, state string) TestRun {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	r := TestRun{RunID: runID, State: state, Nodes: make([]TestNode, 0, len(ts.nodes))}
	for _, n := range ts.nodes {
		c := *n
		// Execução encerrada com teste ainda "rodando" = morreu no meio (panic, timeout, Stop).
		if c.Status == "running" && state != StateRunning && state != StateBuilding {
			c.Status = "failed"
		}
		r.Nodes = append(r.Nodes, c)
		if c.Name == "" {
			continue
		}
		switch c.Status {
		case "passed":
			r.Passed++
		case "failed":
			r.Failed++
		case "skipped":
			r.Skipped++
		}
	}
	sort.Slice(r.Nodes, func(i, j int) bool { return r.Nodes[i].order < r.Nodes[j].order })
	return r
}

// executeTest roda "go test -json" e alimenta a árvore e o console.
func (m *Manager) executeTest(ctx context.Context, o *workspace.Open, cfg store.RunConfig, plan buildPlan, goExe string, e *execution) {
	defer close(e.done)
	defer e.out.Close()
	env := o.GoEnv(cfg.Env)
	if !m.beforeLaunch(ctx, o, cfg, plan, goExe, env, e) {
		return
	}

	// Pacote → pasta, para levar do resultado ao código.
	list := exec.CommandContext(ctx, goExe, append([]string{"list", "-f", "{{.ImportPath}}\t{{.Dir}}"}, plan.target...)...)
	list.Dir, list.Env = plan.dir, env
	list.SysProcAttr = proc.Attr(false)
	if out, err := list.Output(); err == nil {
		e.tests.mu.Lock()
		for _, l := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			if p := strings.SplitN(l, "\t", 2); len(p) == 2 {
				e.tests.dirs[p[0]] = p[1]
			}
		}
		e.tests.mu.Unlock()
	}

	args := []string{"test", "-json"}
	if cfg.UseBuildTags && len(o.BuildTags) > 0 {
		args = append(args, "-tags", strings.Join(o.BuildTags, ","))
	}
	extra, err := SplitArgs(cfg.GoToolArgs)
	if err != nil {
		m.fail(e, "argumentos do go inválidos: "+err.Error())
		return
	}
	if cfg.TestPattern != nil && *cfg.TestPattern != "" {
		args = append(args, testModeArgs(*cfg.TestPattern, extra)...)
	}
	if e.cover != "" {
		args = append(args, "-coverprofile="+e.cover)
	}
	args = append(append(args, extra...), plan.target...)
	if progArgs, err := SplitArgs(cfg.ProgramArgs); err == nil && len(progArgs) > 0 {
		args = append(append(args, "-args"), progArgs...)
	}

	e.out.Write("sys", fmt.Sprintf("$ go %s\n", strings.Join(args, " ")))
	cmd := exec.Command(goExe, args...)
	cmd.Dir, cmd.Env = plan.dir, env
	cmd.Stderr = writerFor(e.out, "err") // erros de compilação vêm aqui, fora do JSON
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		m.fail(e, err.Error())
		return
	}
	setProcessGroup(cmd)
	if err := cmd.Start(); err != nil {
		m.fail(e, "não foi possível rodar o go test: "+err.Error())
		return
	}
	e.mu.Lock()
	e.proc = cmd.Process
	e.mu.Unlock()
	m.setState(e, StateRunning, nil)

	readTestJSON(stdout, e.tests, e.out)
	err = cmd.Wait()
	e.mu.Lock()
	stopped := e.stopped
	e.mu.Unlock()
	if stopped {
		m.finishStopped(e)
		m.emitTests(e)
		return
	}
	code := exitCode(err)
	snap := e.tests.snapshot(e.info.ID, StateExited)
	e.out.Write("sys", fmt.Sprintf("\n%d passaram, %d falharam, %d pulados.\n", snap.Passed, snap.Failed, snap.Skipped))
	if e.cover != "" {
		m.readCoverage(o, e)
	}
	m.setState(e, StateExited, &code)
	m.emitTests(e)
}

// readTestJSON lê o stdout do go test -json: eventos vão para a árvore; o texto, para o console.
func readTestJSON(r io.Reader, ts *testState, out *Output) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64<<10), 8<<20)
	for sc.Scan() {
		line := sc.Bytes()
		var ev event
		if len(line) == 0 || line[0] != '{' || json.Unmarshal(line, &ev) != nil {
			out.Write("out", string(line)+"\n") // não é JSON (ex.: saída do vet antes dos testes)
			continue
		}
		ts.apply(ev)
		switch ev.Action {
		case "output":
			out.Write("out", ev.Output)
		case "build-output":
			out.Write("err", ev.Output) // erro de compilação: o motivo do "build failed"
		}
		ts.notify()
	}
}

// emitTests avisa a UI que a árvore mudou (com intervalo mínimo enquanto roda).
func (m *Manager) emitTests(e *execution) {
	m.bus.Emit(events.TestUpdate, map[string]string{"runId": e.info.ID, "projectId": e.info.ProjectID})
}

func throttle(every time.Duration, fn func()) func() {
	var mu sync.Mutex
	var last time.Time
	var pending bool
	return func() {
		mu.Lock()
		defer mu.Unlock()
		if wait := every - time.Since(last); wait > 0 {
			if !pending {
				pending = true
				time.AfterFunc(wait, func() {
					mu.Lock()
					pending, last = false, time.Now()
					mu.Unlock()
					fn()
				})
			}
			return
		}
		last = time.Now()
		fn()
	}
}

// Tests devolve a árvore de uma execução de testes.
func (m *Manager) Tests(runID string) (TestRun, error) {
	m.mu.Lock()
	e, ok := m.runs[runID]
	m.mu.Unlock()
	if !ok || e.tests == nil {
		return TestRun{}, errors.New("execução de testes não encontrada")
	}
	e.mu.Lock()
	state := e.info.State
	e.mu.Unlock()
	return e.tests.snapshot(runID, state), nil
}

// Location é um arquivo do projeto e uma linha.
type Location struct {
	File string `json:"file"`
	Line int    `json:"line"`
}

// Locate acha no código o teste (ou o subteste, pelo nome do caso) de um resultado.
func (m *Manager) Locate(projectID, runID, pkg, name string) (Location, error) {
	o, err := m.reg.Get(projectID)
	if err != nil {
		return Location{}, err
	}
	m.mu.Lock()
	e, ok := m.runs[runID]
	m.mu.Unlock()
	if !ok || e.tests == nil {
		return Location{}, errors.New("execução de testes não encontrada")
	}
	e.tests.mu.Lock()
	dir := e.tests.dirs[pkg]
	e.tests.mu.Unlock()
	if dir == "" {
		return Location{}, fmt.Errorf("pasta do pacote %s desconhecida", pkg)
	}
	parts := strings.Split(name, "/")
	files, _ := filepath.Glob(filepath.Join(dir, "*_test.go"))
	sort.Strings(files)
	funcRe := regexp.MustCompile(`^func ` + regexp.QuoteMeta(parts[0]) + `\(`)
	for _, f := range files {
		data, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		lines := strings.Split(string(data), "\n")
		for i, l := range lines {
			if !funcRe.MatchString(l) {
				continue
			}
			line := i + 1
			// Subteste: procura o nome do caso como texto, dentro da função (o go test troca espaço por _).
			if len(parts) > 1 {
				sub := parts[len(parts)-1]
				for _, cand := range []string{`"` + sub + `"`, `"` + strings.ReplaceAll(sub, "_", " ") + `"`} {
					for j := i + 1; j < len(lines) && !strings.HasPrefix(lines[j], "func "); j++ {
						if strings.Contains(lines[j], cand) {
							line = j + 1
							break
						}
					}
					if line != i+1 {
						break
					}
				}
			}
			rel, err := o.Rel(f)
			if err != nil {
				return Location{File: f, Line: line}, nil
			}
			return Location{File: rel, Line: line}, nil
		}
	}
	return Location{}, fmt.Errorf("não achei %s no código", parts[0])
}

// RerunFailed roda de novo só os testes que falharam (pelo teste de nível mais alto de cada falha).
func (m *Manager) RerunFailed(projectID, runID string) (Info, error) {
	snap, err := m.Tests(runID)
	if err != nil {
		return Info{}, err
	}
	m.mu.Lock()
	e := m.runs[runID]
	m.mu.Unlock()
	seen := map[string]bool{}
	var names []string
	for _, n := range snap.Nodes {
		if n.Status != "failed" || n.Name == "" {
			continue
		}
		top := strings.SplitN(n.Name, "/", 2)[0]
		if !seen[top] {
			seen[top] = true
			names = append(names, regexp.QuoteMeta(top))
		}
	}
	if len(names) == 0 {
		return Info{}, errors.New("nenhum teste falhou nesta execução")
	}
	ctx := context.Background()
	orig, err := m.db.RunConfigByID(ctx, projectID, e.info.ConfigID)
	if err != nil {
		return Info{}, err
	}
	pattern := "^(" + strings.Join(names, "|") + ")$"
	cfg := orig
	cfg.ID, cfg.Temporary, cfg.TestPattern = "", true, &pattern
	cfg.Name = strings.TrimSuffix(orig.Name, " (falhos)") + " (falhos)"
	if existing, err := m.db.RunConfigByName(ctx, projectID, cfg.Name); err == nil {
		cfg.ID = existing.ID
	}
	saved, err := m.db.SaveRunConfig(ctx, cfg)
	if err != nil {
		return Info{}, err
	}
	return m.Start(projectID, saved.ID)
}

// readCoverage lê o perfil gravado pelo go test e avisa a UI (o arquivo temporário é apagado).
func (m *Manager) readCoverage(o *workspace.Open, e *execution) {
	defer os.Remove(e.cover)
	f, err := os.Open(e.cover)
	if err != nil {
		e.out.Write("sys", "Sem dados de cobertura (os testes não compilaram?).\n")
		return
	}
	defer f.Close()
	e.tests.mu.Lock()
	dirs := make(map[string]string, len(e.tests.dirs))
	for k, v := range e.tests.dirs {
		dirs[k] = v
	}
	e.tests.mu.Unlock()
	cov, err := ParseCoverProfile(f, dirs, o)
	if err != nil {
		e.out.Write("sys", "Cobertura ilegível: "+err.Error()+"\n")
		return
	}
	cov.RunID = e.info.ID
	e.mu.Lock()
	e.result = &cov
	e.mu.Unlock()
	pct := 0.0
	if cov.Total > 0 {
		pct = 100 * float64(cov.Covered) / float64(cov.Total)
	}
	e.out.Write("sys", fmt.Sprintf("Cobertura: %.1f%% dos comandos.\n", pct))
	m.bus.Emit(events.Coverage, map[string]string{"runId": e.info.ID, "projectId": e.info.ProjectID})
}

// Coverage devolve a cobertura de uma execução (depois que ela terminou).
func (m *Manager) Coverage(runID string) (Coverage, error) {
	m.mu.Lock()
	e := m.runs[runID]
	m.mu.Unlock()
	if e == nil {
		return Coverage{}, errors.New("execução não encontrada")
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.result == nil {
		return Coverage{}, errors.New("essa execução não tem cobertura (ainda)")
	}
	return *e.result, nil
}
