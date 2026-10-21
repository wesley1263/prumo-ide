// Package run compila e executa programas Go do projeto e guarda as configurações de execução.
package run

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"prumo/internal/events"
	"prumo/internal/proc"
	"prumo/internal/store"
	"prumo/internal/workspace"
)

// OutputLimit é quanto de saída cada execução guarda (o resto vai sendo descartado do início).
const OutputLimit = 10 << 20

// Estados de uma execução.
const (
	StateBuilding = "building"
	StateRunning  = "running"
	StateExited   = "exited"  // terminou sozinho (ok ou com erro)
	StateFailed   = "failed"  // a compilação falhou ou o processo não subiu
	StateStopped  = "stopped" // parado pelo usuário
)

// Info é o que a UI sabe de uma execução.
type Info struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	ConfigID  string `json:"configId"`
	Name      string `json:"name"`
	State     string `json:"state"`
	Kind      string `json:"kind"`     // "" (programa) | "test"
	Coverage  bool   `json:"coverage"` // go test com -coverprofile
	ExitCode  *int   `json:"exitCode"`
	StartedAt int64  `json:"startedAt"`
}

type execution struct {
	mu      sync.Mutex
	info    Info
	out     *Output
	tests   *testState // só em execuções de teste
	cover   string     // arquivo do -coverprofile ("" = sem cobertura)
	result  *Coverage  // cobertura lida no fim
	cancel  context.CancelFunc
	proc    *os.Process
	stdin   io.WriteCloser
	tty     bool // programa num pseudo-terminal: o próprio terminal ecoa a entrada
	stopped bool
	done    chan struct{}
}

// Manager guarda as execuções da sessão.
type Manager struct {
	db       *store.DB
	reg      *workspace.Registry
	bus      *events.Bus
	goExe    func() string
	buildDir string

	mu   sync.Mutex
	runs map[string]*execution
}

// NewManager cria o gerenciador. buildDir guarda os binários temporários.
func NewManager(db *store.DB, reg *workspace.Registry, bus *events.Bus, goExe func() string, buildDir string) *Manager {
	m := &Manager{db: db, reg: reg, bus: bus, goExe: goExe, buildDir: buildDir, runs: map[string]*execution{}}
	reg.OnClose(m.stopProject)
	return m
}

// Output devolve o buffer de saída de uma execução (usado pela ponte WebSocket).
func (m *Manager) Output(runID string) (*Output, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.runs[runID]
	if !ok {
		return nil, errors.New("execução não encontrada")
	}
	return e.out, nil
}

func (m *Manager) setState(e *execution, state string, code *int) {
	e.mu.Lock()
	e.info.State = state
	if code != nil {
		e.info.ExitCode = code
	}
	info := e.info
	e.mu.Unlock()
	m.bus.Emit(events.RunState, info)
}

// Start compila a config e, se pedido, roda o binário. Volta assim que a compilação começa.
func (m *Manager) Start(projectID, configID string) (Info, error) {
	return m.start(projectID, configID, false)
}

// StartCoverage roda uma config Go Test com -coverprofile; no fim a cobertura fica em Coverage(runID).
func (m *Manager) StartCoverage(projectID, configID string) (Info, error) {
	return m.start(projectID, configID, true)
}

func (m *Manager) start(projectID, configID string, coverage bool) (Info, error) {
	o, err := m.reg.RequireTrusted(projectID)
	if err != nil {
		return Info{}, err
	}
	ctx := context.Background()
	cfg, err := m.db.RunConfigByID(ctx, projectID, configID)
	if err != nil {
		return Info{}, err
	}
	if cfg.Type != "go_build" && cfg.Type != "go_test" {
		return Info{}, fmt.Errorf("tipo de configuração desconhecido: %s", cfg.Type)
	}
	if coverage && cfg.Type != "go_test" {
		return Info{}, errors.New("cobertura só existe para configurações Go Test")
	}
	goExe := m.goExe()
	if o.GoRoot != "" {
		goExe = filepath.Join(o.GoRoot, "bin", exeName("go"))
	}
	if goExe == "" {
		return Info{}, errors.New("go não encontrado: configure um Go SDK")
	}
	plan, err := planBuild(o, cfg)
	if err != nil {
		return Info{}, err
	}
	_ = m.db.TouchRunConfig(ctx, projectID, configID)

	rctx, cancel := context.WithCancel(context.Background())
	e := &execution{
		info:   Info{ID: store.NewID(), ProjectID: projectID, ConfigID: cfg.ID, Name: cfg.Name, State: StateBuilding, StartedAt: store.NowMs()},
		out:    NewOutput(OutputLimit),
		cancel: cancel,
		done:   make(chan struct{}),
	}
	info := e.info
	if cfg.Type == "go_test" {
		info.Kind, e.info.Kind = "test", "test"
		e.tests = newTestState(throttle(150*time.Millisecond, func() { m.emitTests(e) }))
	}
	if coverage {
		info.Coverage, e.info.Coverage = true, true
		e.cover = filepath.Join(m.buildDir, "cover-"+e.info.ID+".out")
	}
	m.mu.Lock()
	m.runs[e.info.ID] = e
	m.mu.Unlock()
	m.bus.Emit(events.RunState, info)

	if cfg.Type == "go_test" {
		go m.executeTest(rctx, o, cfg, plan, goExe, e)
	} else {
		go m.execute(rctx, o, cfg, plan, goExe, e)
	}
	return info, nil
}

type buildPlan struct {
	dir    string // onde rodar o go build (o módulo)
	target []string
	runDir string
}

// planBuild decide o que compilar e de onde, a partir do tipo da config.
func planBuild(o *workspace.Open, cfg store.RunConfig) (buildPlan, error) {
	var p buildPlan
	switch cfg.RunKind {
	case "package":
		if cfg.PackagePath == nil {
			return p, errors.New("informe o import path do pacote")
		}
		p.dir, p.target = o.RootPath, []string{*cfg.PackagePath}
	case "directory", "file":
		var rels []string
		if cfg.RunKind == "directory" {
			d := ""
			if cfg.Directory != nil {
				d = *cfg.Directory
			}
			rels = []string{d}
		} else {
			if len(cfg.Files) == 0 {
				return p, errors.New("escolha ao menos um arquivo")
			}
			rels = cfg.Files
		}
		firstAbs, err := o.Abs(rels[0])
		if err != nil {
			return p, err
		}
		start := firstAbs
		if cfg.RunKind == "file" {
			start = filepath.Dir(firstAbs)
		}
		p.dir = moduleRoot(start, o.RootPath)
		for _, r := range rels {
			abs, err := o.Abs(r)
			if err != nil {
				return p, err
			}
			rel, err := filepath.Rel(p.dir, abs)
			if err != nil {
				return p, err
			}
			t := filepath.ToSlash(rel)
			if t == "." {
				t = "."
			} else if !strings.HasPrefix(t, "../") {
				t = "./" + t
			}
			p.target = append(p.target, t)
		}
	default:
		return p, fmt.Errorf("run kind desconhecido: %s", cfg.RunKind)
	}
	p.runDir = p.dir
	if cfg.WorkingDir != nil && *cfg.WorkingDir != "" {
		wd, err := o.Abs(*cfg.WorkingDir)
		if err != nil {
			return p, err
		}
		p.runDir = wd
	}
	return p, nil
}

// moduleRoot sobe de dir até achar um go.mod, sem passar da raiz do projeto.
func moduleRoot(dir, projectRoot string) string {
	for d := dir; ; d = filepath.Dir(d) {
		if _, err := os.Stat(filepath.Join(d, "go.mod")); err == nil {
			return d
		}
		if d == projectRoot || d == filepath.Dir(d) {
			return projectRoot
		}
	}
}

func (m *Manager) execute(ctx context.Context, o *workspace.Open, cfg store.RunConfig, plan buildPlan, goExe string, e *execution) {
	defer close(e.done)
	defer e.out.Close()
	env := o.GoEnv(cfg.Env)
	if !m.beforeLaunch(ctx, o, cfg, plan, goExe, env, e) {
		return
	}

	binDir, err := os.MkdirTemp(m.buildDir, "build-")
	if err != nil {
		m.fail(e, "não foi possível criar a pasta de build: "+err.Error())
		return
	}
	defer os.RemoveAll(binDir)
	bin := filepath.Join(binDir, exeName(path.Base(strings.ReplaceAll(cfg.Name, " ", "_"))))

	args := []string{"build", "-o", bin}
	if cfg.UseBuildTags && len(o.BuildTags) > 0 {
		args = append(args, "-tags", strings.Join(o.BuildTags, ","))
	}
	extra, err := SplitArgs(cfg.GoToolArgs)
	if err != nil {
		m.fail(e, "argumentos do go inválidos: "+err.Error())
		return
	}
	args = append(append(args, extra...), plan.target...)

	e.out.Write("sys", fmt.Sprintf("$ go %s\n", strings.Join(args, " ")))
	build := exec.CommandContext(ctx, goExe, args...)
	build.Dir, build.Env = plan.dir, env
	build.SysProcAttr = proc.Attr(false)
	build.Stdout, build.Stderr = writerFor(e.out, "out"), writerFor(e.out, "err")
	if err := build.Run(); err != nil {
		if ctx.Err() != nil {
			m.finishStopped(e)
			return
		}
		code := exitCode(err)
		e.out.Write("sys", fmt.Sprintf("\nA compilação falhou (código %d).\n", code))
		m.setState(e, StateFailed, &code)
		return
	}
	if !cfg.RunAfterBuild {
		zero := 0
		e.out.Write("sys", "Compilado em "+bin+"\n")
		m.setState(e, StateExited, &zero)
		return
	}

	progArgs, err := SplitArgs(cfg.ProgramArgs)
	if err != nil {
		m.fail(e, "argumentos do programa inválidos: "+err.Error())
		return
	}
	cmd := exec.Command(bin, progArgs...)
	cmd.Dir, cmd.Env = plan.runDir, env
	cmd.Stdout, cmd.Stderr = writerFor(e.out, "out"), writerFor(e.out, "err")
	setProcessGroup(cmd)
	redirect := cfg.RedirectInputFrom != nil && *cfg.RedirectInputFrom != ""
	if cfg.EmulateTerminal && !redirect {
		m.runTTY(ctx, e, cmd)
		return
	}
	if redirect {
		inPath, err := o.Abs(*cfg.RedirectInputFrom)
		if err != nil {
			m.fail(e, err.Error())
			return
		}
		f, err := os.Open(inPath)
		if err != nil {
			m.fail(e, "não foi possível abrir a entrada: "+err.Error())
			return
		}
		defer f.Close()
		cmd.Stdin = f
	} else if stdin, err := cmd.StdinPipe(); err == nil {
		e.mu.Lock()
		e.stdin = stdin
		e.mu.Unlock()
	}
	if ctx.Err() != nil {
		m.finishStopped(e)
		return
	}
	if err := cmd.Start(); err != nil {
		m.fail(e, "não foi possível iniciar o programa: "+err.Error())
		return
	}
	e.mu.Lock()
	e.proc = cmd.Process
	e.mu.Unlock()
	m.setState(e, StateRunning, nil)

	err = cmd.Wait()
	e.mu.Lock()
	stopped := e.stopped
	e.mu.Unlock()
	if stopped {
		m.finishStopped(e)
		return
	}
	code := exitCode(err)
	e.out.Write("sys", fmt.Sprintf("\nProcesso encerrado com código %d.\n", code))
	m.setState(e, StateExited, &code)
}

// runTTY roda o programa num pseudo-terminal; a saída (stdout e stderr juntos, como num terminal) vai como "out".
func (m *Manager) runTTY(ctx context.Context, e *execution, cmd *exec.Cmd) {
	if ctx.Err() != nil {
		m.finishStopped(e)
		return
	}
	f, err := startPTY(cmd)
	if err != nil {
		m.fail(e, "não foi possível iniciar o programa num terminal: "+err.Error())
		return
	}
	e.mu.Lock()
	e.proc, e.stdin, e.tty = cmd.Process, f, true
	e.mu.Unlock()
	m.setState(e, StateRunning, nil)
	copied := make(chan struct{})
	go func() {
		defer close(copied)
		buf := make([]byte, 32*1024)
		for {
			n, err := f.Read(buf)
			if n > 0 {
				e.out.Write("out", string(buf[:n]))
			}
			if err != nil {
				return // EIO quando o programa (e quem herdou o terminal) fecha
			}
		}
	}()
	err = cmd.Wait()
	select {
	case <-copied:
	case <-time.After(time.Second): // um filho segurando o terminal não prende o fim da execução
	}
	f.Close()
	e.mu.Lock()
	stopped := e.stopped
	e.stdin = nil
	e.mu.Unlock()
	if stopped {
		m.finishStopped(e)
		return
	}
	code := exitCode(err)
	e.out.Write("sys", fmt.Sprintf("\nProcesso encerrado com código %d.\n", code))
	m.setState(e, StateExited, &code)
}

func (m *Manager) fail(e *execution, msg string) {
	e.out.Write("sys", msg+"\n")
	code := -1
	m.setState(e, StateFailed, &code)
}

func (m *Manager) finishStopped(e *execution) {
	e.out.Write("sys", "\nParado.\n")
	m.setState(e, StateStopped, nil)
}

// Stop interrompe a execução: cancela a compilação ou manda SIGINT ao grupo e, após 3s, SIGKILL.
func (m *Manager) Stop(runID string) error {
	m.mu.Lock()
	e, ok := m.runs[runID]
	m.mu.Unlock()
	if !ok {
		return errors.New("execução não encontrada")
	}
	e.mu.Lock()
	e.stopped = true
	proc := e.proc
	e.mu.Unlock()
	e.cancel()
	if proc != nil {
		interruptGroup(proc)
		go func() {
			select {
			case <-e.done:
			case <-time.After(3 * time.Second):
				killGroup(proc)
			}
		}()
	}
	return nil
}

// WriteStdin manda texto para a entrada do programa.
func (m *Manager) WriteStdin(runID, data string) error {
	m.mu.Lock()
	e, ok := m.runs[runID]
	m.mu.Unlock()
	if !ok {
		return errors.New("execução não encontrada")
	}
	e.mu.Lock()
	in, tty := e.stdin, e.tty
	e.mu.Unlock()
	if in == nil {
		return errors.New("o programa não aceita entrada agora")
	}
	if !tty {
		e.out.Write("in", data)
	}
	_, err := io.WriteString(in, data)
	return err
}

// List devolve as execuções do projeto nesta sessão, mais recentes primeiro.
func (m *Manager) List(projectID string) []Info {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []Info{}
	for _, e := range m.runs {
		e.mu.Lock()
		if e.info.ProjectID == projectID {
			out = append(out, e.info)
		}
		e.mu.Unlock()
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].StartedAt > out[j-1].StartedAt; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}

func (m *Manager) stopProject(projectID string) {
	for _, info := range m.List(projectID) {
		if info.State == StateBuilding || info.State == StateRunning {
			_ = m.Stop(info.ID)
		}
	}
}

// StopAll para tudo (fechamento do app).
func (m *Manager) StopAll() {
	m.mu.Lock()
	ids := make([]string, 0, len(m.runs))
	for id := range m.runs {
		ids = append(ids, id)
	}
	m.mu.Unlock()
	for _, id := range ids {
		_ = m.Stop(id)
	}
}

type chunkWriter struct {
	out *Output
	t   string
}

func (w chunkWriter) Write(p []byte) (int, error) {
	w.out.Write(w.t, string(p))
	return len(p), nil
}

func writerFor(o *Output, t string) io.Writer { return chunkWriter{out: o, t: t} }

func exitCode(err error) int {
	if err == nil {
		return 0
	}
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return ee.ExitCode()
	}
	return -1
}

func exeName(name string) string {
	if os.PathSeparator == '\\' {
		return name + ".exe"
	}
	return name
}

// SplitArgs separa argumentos como um shell simples: espaços, aspas simples e duplas, barra invertida.
func SplitArgs(s string) ([]string, error) {
	var out []string
	var cur strings.Builder
	inArg := false
	var quote rune
	escaped := false
	for _, r := range s {
		switch {
		case escaped:
			cur.WriteRune(r)
			escaped = false
		case r == '\\' && quote != '\'':
			escaped, inArg = true, true
		case quote != 0:
			if r == quote {
				quote = 0
			} else {
				cur.WriteRune(r)
			}
		case r == '"' || r == '\'':
			quote, inArg = r, true
		case r == ' ' || r == '\t' || r == '\n':
			if inArg {
				out = append(out, cur.String())
				cur.Reset()
				inArg = false
			}
		default:
			cur.WriteRune(r)
			inArg = true
		}
	}
	if quote != 0 {
		return nil, errors.New("aspas sem fechamento")
	}
	if escaped {
		return nil, errors.New("barra invertida no fim")
	}
	if inArg {
		out = append(out, cur.String())
	}
	return out, nil
}
