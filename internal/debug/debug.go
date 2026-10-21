package debug

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/go-dap"

	"prumo/internal/events"
	"prumo/internal/run"
	"prumo/internal/store"
	"prumo/internal/workspace"
)

// Estados de uma sessão.
const (
	StateStarting   = "starting"
	StateRunning    = "running"
	StateStopped    = "stopped"
	StateTerminated = "terminated"
)

// Info é o que a UI sabe de uma sessão de depuração.
type Info struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	ConfigID  string `json:"configId"`
	Name      string `json:"name"`
	State     string `json:"state"`
	Reason    string `json:"reason"`   // breakpoint | step | pause | panic | exception | entry
	ThreadID  int    `json:"threadId"` // goroutine parada
	File      string `json:"file"`     // relativo ao projeto, ou absoluto fora dele
	Line      int    `json:"line"`
	Message   string `json:"message"`
	ExitCode  *int   `json:"exitCode"`
}

// Frame é um quadro da pilha.
type Frame struct {
	ID       int    `json:"id"`
	Name     string `json:"name"`
	File     string `json:"file"`
	Line     int    `json:"line"`
	Column   int    `json:"column"`
	External bool   `json:"external"` // fora do projeto (runtime, stdlib, dependências)
}

// Goroutine é uma thread do DAP (no Delve, uma goroutine).
type Goroutine struct {
	ID       int    `json:"id"`
	Name     string `json:"name"`
	Function string `json:"function"` // onde ela está agora ("main.worker"); "" se o Delve não disse
	Current  bool   `json:"current"`  // a que parou
	System   bool   `json:"system"`   // do runtime do Go (a UI esconde por padrão)
}

// goroutineName é o nome que o Delve dá: "* [Go 1] main.main (Thread 123)".
// A função pode ter parênteses (método com ponteiro: "pkg.(*T).M"); o "(Thread N)" do fim não faz parte dela.
var goroutineName = regexp.MustCompile(`^(\* )?\[Go (\d+)\]\s*(.*?)(?:\s+\(Thread \d+\))?$`)

// parseGoroutine extrai a função e se a goroutine é do runtime (agrupar e filtrar na UI).
func parseGoroutine(id int, name string) Goroutine {
	g := Goroutine{ID: id, Name: name}
	if m := goroutineName.FindStringSubmatch(name); m != nil {
		g.Current = m[1] != ""
		g.Function = m[3]
	}
	g.System = isRuntimeFunc(g.Function)
	return g
}

// maxStackLookups limita quantas goroutines do "runtime" têm a pilha consultada para achar a função do usuário.
const maxStackLookups = 200

func isRuntimeFunc(f string) bool {
	return f == "" || strings.HasPrefix(f, "runtime.") || strings.HasPrefix(f, "internal/") || strings.HasPrefix(f, "internal.")
}

// Variable é um nó da árvore de variáveis. Ref > 0 = tem filhos.
type Variable struct {
	Name  string `json:"name"`
	Value string `json:"value"`
	Type  string `json:"type"`
	Ref   int    `json:"ref"`
}

// Scope é um escopo de um quadro (Locals, Arguments...).
type Scope struct {
	Name string `json:"name"`
	Ref  int    `json:"ref"`
}

type session struct {
	mu      sync.Mutex
	info    Info
	project *workspace.Open
	cmd     *exec.Cmd
	c       *client
	out     *run.Output
	inited  chan struct{}
	done    chan struct{}
	cursor  string // "Run to cursor" em andamento: arquivo com o breakpoint temporário ("" = nenhum)
	attach  bool   // ligado a um processo que já existia (local ou remoto): parar só desconecta
}

// Manager mantém as sessões de depuração da IDE.
type Manager struct {
	db     *store.DB
	reg    *workspace.Registry
	bus    *events.Bus
	dlvExe func() string
	goExe  func() string

	mu       sync.Mutex
	sessions map[string]*session
	muted    map[string]bool // projectID → breakpoints silenciados (ficam salvos, não vão para o Delve)
}

// NewManager cria o gerenciador.
func NewManager(db *store.DB, reg *workspace.Registry, bus *events.Bus, dlvExe, goExe func() string) *Manager {
	m := &Manager{db: db, reg: reg, bus: bus, dlvExe: dlvExe, goExe: goExe, sessions: map[string]*session{}, muted: map[string]bool{}}
	reg.OnClose(m.stopProject)
	return m
}

// Output devolve a saída do programa depurado (para a ponte WebSocket).
func (m *Manager) Output(id string) (*run.Output, error) {
	s, err := m.get(id)
	if err != nil {
		return nil, err
	}
	return s.out, nil
}

func (m *Manager) get(id string) (*session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[id]
	if !ok {
		return nil, errors.New("sessão de depuração não encontrada")
	}
	return s, nil
}

func (m *Manager) emit(s *session) {
	s.mu.Lock()
	info := s.info
	s.mu.Unlock()
	m.bus.Emit(events.DebugState, info)
}

// Start sobe o Delve para a config (programa ou teste) e começa a depuração.
func (m *Manager) Start(projectID, configID string) (Info, error) {
	o, err := m.reg.RequireTrusted(projectID)
	if err != nil {
		return Info{}, err
	}
	ctx := context.Background()
	cfg, err := m.db.RunConfigByID(ctx, projectID, configID)
	if err != nil {
		return Info{}, err
	}
	dlv := m.dlvExe()
	if dlv == "" {
		return Info{}, errors.New("o Delve (dlv) não está instalado: instale pelas ferramentas da IDE")
	}
	launch, err := launchArgs(o, cfg)
	if err != nil {
		return Info{}, err
	}
	_ = m.db.TouchRunConfig(ctx, projectID, configID)

	// O backend escuta e o Delve liga para cá (--client-addr): sem depender de ler a porta da saída dele.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return Info{}, err
	}
	cmd := exec.Command(dlv, "dap", "--client-addr", ln.Addr().String())
	cmd.Dir = o.RootPath
	cmd.Env = o.GoEnv(cfg.Env)
	s := &session{
		info:    Info{ID: store.NewID(), ProjectID: projectID, ConfigID: cfg.ID, Name: cfg.Name, State: StateStarting},
		project: o,
		cmd:     cmd,
		out:     run.NewOutput(run.OutputLimit),
		inited:  make(chan struct{}),
		done:    make(chan struct{}),
	}
	cmd.Stdout = outWriter{s.out, "sys"}
	cmd.Stderr = outWriter{s.out, "err"}
	setProcessGroup(cmd)
	if err := cmd.Start(); err != nil {
		ln.Close()
		return Info{}, fmt.Errorf("iniciar o Delve: %w", err)
	}
	m.mu.Lock()
	m.sessions[s.info.ID] = s
	m.mu.Unlock()
	info := s.info // cópia antes de a goroutine começar a mexer
	m.emit(s)
	s.out.Write("sys", fmt.Sprintf("Depurando %s com o Delve…\n", cfg.Name))

	go m.run(s, acceptOnce(ln), &dap.LaunchRequest{Request: req("launch"), Arguments: raw(launch)})
	return info, nil
}

// acceptOnce espera o Delve ligar de volta (até 30 s).
func acceptOnce(ln net.Listener) func() (net.Conn, error) {
	return func() (net.Conn, error) {
		_ = ln.(*net.TCPListener).SetDeadline(time.Now().Add(30 * time.Second))
		defer ln.Close()
		return ln.Accept()
	}
}

func (m *Manager) run(s *session, connect func() (net.Conn, error), start dap.RequestMessage) {
	fail := func(msg string) {
		s.out.Write("err", msg+"\n")
		m.finish(s, nil)
	}
	conn, err := connect()
	if err != nil {
		fail("o Delve não conectou: " + err.Error())
		return
	}
	c := newClient(conn, func(ev dap.EventMessage) { m.onEvent(s, ev) })
	s.mu.Lock()
	s.c = c
	s.mu.Unlock()
	go func() {
		if s.cmd != nil {
			_ = s.cmd.Wait()
		}
		<-c.closed
		m.finish(s, nil)
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute) // a compilação pode demorar
	defer cancel()
	if _, err := c.do(ctx, &dap.InitializeRequest{Request: req("initialize"), Arguments: dap.InitializeRequestArguments{
		ClientID: "prumo", ClientName: "prumo", AdapterID: "go", Locale: "pt-BR", PathFormat: "path",
		LinesStartAt1: true, ColumnsStartAt1: true, SupportsVariableType: true, SupportsRunInTerminalRequest: false,
	}}); err != nil {
		fail(err.Error())
		return
	}
	if _, err := c.do(ctx, start); err != nil {
		msg := "não foi possível iniciar: " + err.Error()
		if s.attach && strings.Contains(err.Error(), "operation not permitted") {
			msg += "\nO kernel não deixa anexar a um processo que não é filho do Delve (ptrace_scope = 1). " +
				"Libere com: echo 0 | sudo tee /proc/sys/kernel/yama/ptrace_scope, ou rode o programa com " +
				"dlv exec --headless --listen=:2345 e use o modo remoto."
		}
		fail(msg)
		return
	}
	select {
	case <-s.inited:
	case <-ctx.Done():
		fail("o Delve não ficou pronto a tempo")
		return
	}
	if err := m.sendAllBreakpoints(ctx, s); err != nil {
		s.out.Write("err", "breakpoints: "+err.Error()+"\n")
	}
	if _, err := c.do(ctx, &dap.ConfigurationDoneRequest{Request: req("configurationDone")}); err != nil {
		fail(err.Error())
		return
	}
	if s.attach {
		// Anexar para o processo (ou o headless começa parado): segue rodando até um breakpoint.
		_, _ = c.do(ctx, &dap.ContinueRequest{Request: req("continue"), Arguments: dap.ContinueArguments{ThreadId: 1}})
	}
	s.mu.Lock()
	if s.info.State == StateStarting {
		s.info.State = StateRunning
	}
	s.mu.Unlock()
	m.emit(s)
}

func (m *Manager) finish(s *session, code *int) {
	s.mu.Lock()
	if s.info.State == StateTerminated {
		s.mu.Unlock()
		return
	}
	s.info.State = StateTerminated
	if code != nil {
		s.info.ExitCode = code
	}
	c := s.c
	s.mu.Unlock()
	if c != nil {
		c.close()
	}
	killGroup(s.cmd)
	s.out.Write("sys", "\nDepuração encerrada.\n")
	s.out.Close()
	close(s.done)
	m.emit(s)
}

func (m *Manager) onEvent(s *session, ev dap.EventMessage) {
	switch e := ev.(type) {
	case *dap.InitializedEvent:
		close(s.inited)
	case *dap.OutputEvent:
		t := "out"
		switch e.Body.Category {
		case "stderr":
			t = "err"
		case "console", "important":
			t = "sys"
		}
		s.out.Write(t, e.Body.Output)
	case *dap.StoppedEvent:
		s.mu.Lock()
		s.info.State, s.info.Reason, s.info.ThreadID, s.info.Message = StateStopped, e.Body.Reason, e.Body.ThreadId, e.Body.Text
		s.info.File, s.info.Line = "", 0
		temp := s.cursor
		s.cursor = ""
		s.mu.Unlock()
		// Onde parou: o topo da pilha da goroutine (fora do loop de leitura, que é quem entrega a resposta).
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if temp != "" { // parou (no cursor ou antes): o breakpoint temporário sai
				_ = m.setFileBreakpoints(ctx, s, temp, m.fileBreakpoints(ctx, s.info.ProjectID, temp), 0)
			}
			if frames, err := m.stack(ctx, s, e.Body.ThreadId); err == nil {
				for _, f := range frames {
					if f.File != "" && !f.External {
						s.mu.Lock()
						s.info.File, s.info.Line = f.File, f.Line
						s.mu.Unlock()
						break
					}
				}
			}
			m.emit(s)
		}()
	case *dap.ContinuedEvent:
		s.mu.Lock()
		s.info.State, s.info.Reason, s.info.File, s.info.Line = StateRunning, "", "", 0
		s.mu.Unlock()
		m.emit(s)
	case *dap.ExitedEvent:
		code := e.Body.ExitCode
		s.mu.Lock()
		s.info.ExitCode = &code
		s.mu.Unlock()
		s.out.Write("sys", fmt.Sprintf("\nO programa terminou com código %d.\n", code))
	case *dap.TerminatedEvent:
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			_, _ = s.c.do(ctx, &dap.DisconnectRequest{Request: req("disconnect"), Arguments: &dap.DisconnectArguments{TerminateDebuggee: true}})
			m.finish(s, nil)
		}()
	}
}

// launchArgs monta o "launch" do Delve a partir da config: programa (debug) ou teste (test).
func launchArgs(o *workspace.Open, cfg store.RunConfig) (map[string]any, error) {
	var program string
	switch cfg.RunKind {
	case "directory":
		d := ""
		if cfg.Directory != nil {
			d = *cfg.Directory
		}
		abs, err := o.Abs(d)
		if err != nil {
			return nil, err
		}
		program = abs
	case "file":
		if len(cfg.Files) == 0 {
			return nil, errors.New("escolha um arquivo")
		}
		abs, err := o.Abs(cfg.Files[0])
		if err != nil {
			return nil, err
		}
		program = abs
	case "package":
		if cfg.PackagePath == nil {
			return nil, errors.New("informe o pacote")
		}
		program = *cfg.PackagePath
	}
	args, err := run.SplitArgs(cfg.ProgramArgs)
	if err != nil {
		return nil, fmt.Errorf("argumentos do programa: %w", err)
	}
	l := map[string]any{
		"request":     "launch",
		"mode":        "debug",
		"program":     program,
		"args":        args,
		"outputMode":  "remote", // a saída do programa chega como evento DAP, no console da IDE
		"stopOnEntry": false,
		"cwd":         o.RootPath,
	}
	if cfg.WorkingDir != nil && *cfg.WorkingDir != "" {
		wd, err := o.Abs(*cfg.WorkingDir)
		if err != nil {
			return nil, err
		}
		l["cwd"] = wd
	} else if cfg.RunKind != "package" {
		l["cwd"] = moduleDir(program, o.RootPath)
	}
	if len(cfg.Env) > 0 {
		l["env"] = cfg.Env
	}
	if cfg.UseBuildTags && len(o.BuildTags) > 0 {
		l["buildFlags"] = "-tags=" + strings.Join(o.BuildTags, ",")
	}
	if cfg.Type == "go_test" {
		l["mode"] = "test"
		targs := []string{"-test.v"}
		if cfg.TestPattern != nil && *cfg.TestPattern != "" {
			targs = append(targs, "-test.run", *cfg.TestPattern)
		}
		l["args"] = append(targs, args...)
	}
	return l, nil
}

func moduleDir(dir, root string) string {
	if st, err := os.Stat(dir); err == nil && !st.IsDir() {
		dir = filepath.Dir(dir)
	}
	for d := dir; ; d = filepath.Dir(d) {
		if _, err := os.Stat(filepath.Join(d, "go.mod")); err == nil {
			return d
		}
		if d == root || d == filepath.Dir(d) {
			return root
		}
	}
}

// ---------------------------------------------------------------- breakpoints

// sendAllBreakpoints envia, arquivo por arquivo, os breakpoints ligados do projeto.
func (m *Manager) sendAllBreakpoints(ctx context.Context, s *session) error {
	bps, err := m.db.ListBreakpoints(ctx, s.info.ProjectID)
	if err != nil {
		return err
	}
	byFile := map[string][]store.Breakpoint{}
	for _, b := range bps {
		if b.Kind == "line" && b.FilePath != nil {
			byFile[*b.FilePath] = append(byFile[*b.FilePath], b)
		}
	}
	files := make([]string, 0, len(byFile))
	for f := range byFile {
		files = append(files, f)
	}
	sort.Strings(files)
	for _, f := range files {
		if err := m.setFileBreakpoints(ctx, s, f, byFile[f], 0); err != nil {
			return err
		}
	}
	return m.setPanicBreakpoint(ctx, s, bps)
}

// setPanicBreakpoint para em qualquer panic (inclusive os recuperados): breakpoint de função em runtime.gopanic.
func (m *Manager) setPanicBreakpoint(ctx context.Context, s *session, bps []store.Breakpoint) error {
	list := []dap.FunctionBreakpoint{}
	if !m.isMuted(s.info.ProjectID) {
		for _, b := range bps {
			if b.Kind == "panic" && b.Enabled {
				list = append(list, dap.FunctionBreakpoint{Name: "runtime.gopanic"})
				break
			}
		}
	}
	_, err := s.c.do(ctx, &dap.SetFunctionBreakpointsRequest{Request: req("setFunctionBreakpoints"), Arguments: dap.SetFunctionBreakpointsArguments{Breakpoints: list}})
	return err
}

func (m *Manager) isMuted(projectID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.muted[projectID]
}

// SetMuted silencia (ou volta a ligar) todos os breakpoints do projeto nas sessões ativas e nas próximas.
func (m *Manager) SetMuted(projectID string, muted bool) {
	m.mu.Lock()
	m.muted[projectID] = muted
	m.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for _, s := range m.active(projectID) {
		_ = m.sendAllBreakpoints(ctx, s)
	}
}

// Muted diz se os breakpoints do projeto estão silenciados.
func (m *Manager) Muted(projectID string) bool { return m.isMuted(projectID) }

// SyncPanic reenvia o breakpoint de panic para as sessões ativas.
func (m *Manager) SyncPanic(projectID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	bps, err := m.db.ListBreakpoints(ctx, projectID)
	if err != nil {
		return
	}
	for _, s := range m.active(projectID) {
		_ = m.setPanicBreakpoint(ctx, s, bps)
	}
}

// setFileBreakpoints substitui o conjunto de breakpoints de um arquivo na sessão (o DAP é por arquivo).
// extra > 0 acrescenta um breakpoint temporário nessa linha (Run to cursor), mesmo com os breakpoints silenciados.
func (m *Manager) setFileBreakpoints(ctx context.Context, s *session, path string, bps []store.Breakpoint, extra int) error {
	abs, err := s.project.Abs(path)
	if err != nil {
		return err
	}
	list := []dap.SourceBreakpoint{}
	muted := m.isMuted(s.info.ProjectID)
	for _, b := range bps {
		if muted || !b.Enabled || b.Line == nil {
			continue
		}
		sb := dap.SourceBreakpoint{Line: *b.Line}
		if b.Condition != nil {
			sb.Condition = *b.Condition
		}
		if b.LogMessage != nil {
			sb.LogMessage = *b.LogMessage
		}
		if sb.Line == extra {
			continue // a linha temporária entra sem condição, logo abaixo
		}
		list = append(list, sb)
	}
	if extra > 0 {
		list = append(list, dap.SourceBreakpoint{Line: extra})
	}
	_, err = s.c.do(ctx, &dap.SetBreakpointsRequest{Request: req("setBreakpoints"), Arguments: dap.SetBreakpointsArguments{
		Source: dap.Source{Path: abs}, Breakpoints: list,
	}})
	return err
}

// SyncFile reenvia os breakpoints de um arquivo para as sessões ativas do projeto.
func (m *Manager) SyncFile(projectID, path string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	mine := m.fileBreakpoints(ctx, projectID, path)
	for _, s := range m.active(projectID) {
		_ = m.setFileBreakpoints(ctx, s, path, mine, 0)
	}
}

// fileBreakpoints: os breakpoints de linha gravados de um arquivo.
func (m *Manager) fileBreakpoints(ctx context.Context, projectID, path string) []store.Breakpoint {
	bps, err := m.db.ListBreakpoints(ctx, projectID)
	if err != nil {
		return nil
	}
	var mine []store.Breakpoint
	for _, b := range bps {
		if b.Kind == "line" && b.FilePath != nil && *b.FilePath == path {
			mine = append(mine, b)
		}
	}
	return mine
}

// RunToCursor continua até a linha dada (Alt+F9): breakpoint temporário, continue, e na próxima parada ele sai.
// Um breakpoint de verdade no caminho para antes, como na IDE desktop.
func (m *Manager) RunToCursor(id, path string, line int) error {
	s, err := m.live(id)
	if err != nil {
		return err
	}
	s.mu.Lock()
	stopped := s.info.State == StateStopped
	s.mu.Unlock()
	if !stopped {
		return errors.New("o programa precisa estar parado")
	}
	if line < 1 {
		return errors.New("linha inválida")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := m.setFileBreakpoints(ctx, s, path, m.fileBreakpoints(ctx, s.info.ProjectID, path), line); err != nil {
		return err
	}
	s.mu.Lock()
	s.cursor = path
	s.mu.Unlock()
	return m.Control(id, "resume", 0)
}

func (m *Manager) active(projectID string) []*session {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*session
	for _, s := range m.sessions {
		s.mu.Lock()
		live := s.info.ProjectID == projectID && s.info.State != StateTerminated && s.c != nil
		s.mu.Unlock()
		if live {
			out = append(out, s)
		}
	}
	return out
}

// ---------------------------------------------------------------- controle

func (m *Manager) live(id string) (*session, error) {
	s, err := m.get(id)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.info.State == StateTerminated || s.c == nil {
		return nil, errors.New("a depuração já terminou")
	}
	return s, nil
}

func (m *Manager) threadOr(s *session, threadID int) int {
	if threadID > 0 {
		return threadID
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.info.ThreadID
}

// Control executa resume | pause | stepOver | stepInto | stepOut na goroutine (0 = a que parou).
func (m *Manager) Control(id, action string, threadID int) error {
	s, err := m.live(id)
	if err != nil {
		return err
	}
	tid := m.threadOr(s, threadID)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var r dap.RequestMessage
	switch action {
	case "resume":
		r = &dap.ContinueRequest{Request: req("continue"), Arguments: dap.ContinueArguments{ThreadId: tid}}
	case "pause":
		r = &dap.PauseRequest{Request: req("pause"), Arguments: dap.PauseArguments{ThreadId: tid}}
	case "stepOver":
		r = &dap.NextRequest{Request: req("next"), Arguments: dap.NextArguments{ThreadId: tid}}
	case "stepInto":
		r = &dap.StepInRequest{Request: req("stepIn"), Arguments: dap.StepInArguments{ThreadId: tid}}
	case "stepOut":
		r = &dap.StepOutRequest{Request: req("stepOut"), Arguments: dap.StepOutArguments{ThreadId: tid}}
	default:
		return fmt.Errorf("ação desconhecida: %s", action)
	}
	if _, err := s.c.do(ctx, r); err != nil {
		return err
	}
	if action != "pause" {
		// O Delve nem sempre manda "continued" para um step: a UI precisa saber que saiu do "parado".
		s.mu.Lock()
		if s.info.State == StateStopped {
			s.info.State, s.info.File, s.info.Line = StateRunning, "", 0
		}
		s.mu.Unlock()
		m.emit(s)
	}
	return nil
}

// Stop encerra a depuração e o programa.
func (m *Manager) Stop(id string) error {
	s, err := m.get(id)
	if err != nil {
		return err
	}
	s.mu.Lock()
	c := s.c
	s.mu.Unlock()
	if c != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		// Num attach, o processo é de outra pessoa (ou de outra máquina): só solta.
		_, _ = c.do(ctx, &dap.DisconnectRequest{Request: req("disconnect"), Arguments: &dap.DisconnectArguments{TerminateDebuggee: !s.attach}})
		cancel()
	}
	m.finish(s, nil)
	return nil
}

// Goroutines lista as goroutines (threads do DAP).
func (m *Manager) Goroutines(id string) ([]Goroutine, error) {
	s, err := m.live(id)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	resp, err := s.c.do(ctx, &dap.ThreadsRequest{Request: req("threads")})
	if err != nil {
		return nil, err
	}
	out := []Goroutine{}
	for _, t := range resp.(*dap.ThreadsResponse).Body.Threads {
		out = append(out, parseGoroutine(t.Id, t.Name))
	}
	// Parada num canal ou num lock, a goroutine do usuário aparece no runtime (runtime.gopark): a função que
	// interessa é a primeira da pilha fora do runtime. Só olha as primeiras (pilha custa uma ida ao Delve).
	for i := range out {
		if i >= maxStackLookups || !out[i].System {
			continue
		}
		st, err := s.c.do(ctx, &dap.StackTraceRequest{Request: req("stackTrace"), Arguments: dap.StackTraceArguments{ThreadId: out[i].ID, Levels: 20}})
		if err != nil {
			continue
		}
		for _, f := range st.(*dap.StackTraceResponse).Body.StackFrames {
			if !isRuntimeFunc(f.Name) {
				out[i].Function, out[i].System = f.Name, false
				break
			}
		}
	}
	return out, nil
}

// Stack devolve a pilha da goroutine (0 = a que parou).
func (m *Manager) Stack(id string, threadID int) ([]Frame, error) {
	s, err := m.live(id)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return m.stack(ctx, s, m.threadOr(s, threadID))
}

func (m *Manager) stack(ctx context.Context, s *session, threadID int) ([]Frame, error) {
	resp, err := s.c.do(ctx, &dap.StackTraceRequest{Request: req("stackTrace"), Arguments: dap.StackTraceArguments{ThreadId: threadID, Levels: 50}})
	if err != nil {
		return nil, err
	}
	out := []Frame{}
	for _, f := range resp.(*dap.StackTraceResponse).Body.StackFrames {
		fr := Frame{ID: f.Id, Name: f.Name, Line: f.Line, Column: f.Column, External: true}
		if f.Source != nil && f.Source.Path != "" {
			fr.File = f.Source.Path
			if rel, err := s.project.Rel(f.Source.Path); err == nil {
				fr.File, fr.External = rel, false
			}
		}
		out = append(out, fr)
	}
	return out, nil
}

// Scopes devolve os escopos de um quadro.
func (m *Manager) Scopes(id string, frameID int) ([]Scope, error) {
	s, err := m.live(id)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	resp, err := s.c.do(ctx, &dap.ScopesRequest{Request: req("scopes"), Arguments: dap.ScopesArguments{FrameId: frameID}})
	if err != nil {
		return nil, err
	}
	out := []Scope{}
	for _, sc := range resp.(*dap.ScopesResponse).Body.Scopes {
		out = append(out, Scope{Name: sc.Name, Ref: sc.VariablesReference})
	}
	return out, nil
}

// Variables devolve os filhos de uma referência (escopo ou variável composta), paginados.
func (m *Manager) Variables(id string, ref, start, count int) ([]Variable, error) {
	s, err := m.live(id)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	resp, err := s.c.do(ctx, &dap.VariablesRequest{Request: req("variables"), Arguments: dap.VariablesArguments{
		VariablesReference: ref, Start: start, Count: count,
	}})
	if err != nil {
		return nil, err
	}
	out := []Variable{}
	for _, v := range resp.(*dap.VariablesResponse).Body.Variables {
		out = append(out, Variable{Name: v.Name, Value: v.Value, Type: v.Type, Ref: v.VariablesReference})
	}
	return out, nil
}

// Evaluate avalia uma expressão Go no quadro.
func (m *Manager) Evaluate(id string, frameID int, expr string) (Variable, error) {
	s, err := m.live(id)
	if err != nil {
		return Variable{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	resp, err := s.c.do(ctx, &dap.EvaluateRequest{Request: req("evaluate"), Arguments: dap.EvaluateArguments{
		Expression: expr, FrameId: frameID, Context: "watch",
	}})
	if err != nil {
		return Variable{}, err
	}
	b := resp.(*dap.EvaluateResponse).Body
	return Variable{Name: expr, Value: b.Result, Type: b.Type, Ref: b.VariablesReference}, nil
}

// List devolve as sessões do projeto, mais recentes primeiro.
func (m *Manager) List(projectID string) []Info {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []Info{}
	for _, s := range m.sessions {
		s.mu.Lock()
		if s.info.ProjectID == projectID {
			out = append(out, s.info)
		}
		s.mu.Unlock()
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID > out[j].ID }) // UUID v7: ordem de criação
	return out
}

func (m *Manager) stopProject(projectID string) {
	for _, s := range m.active(projectID) {
		_ = m.Stop(s.info.ID)
	}
}

// StopAll encerra todas as sessões (fechamento do app).
func (m *Manager) StopAll() {
	m.mu.Lock()
	ids := make([]string, 0, len(m.sessions))
	for id := range m.sessions {
		ids = append(ids, id)
	}
	m.mu.Unlock()
	for _, id := range ids {
		_ = m.Stop(id)
	}
}

type outWriter struct {
	o *run.Output
	t string
}

func (w outWriter) Write(p []byte) (int, error) {
	w.o.Write(w.t, string(p))
	return len(p), nil
}
