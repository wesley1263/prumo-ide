package run

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"prumo/internal/events"
	"prumo/internal/proc"
	"prumo/internal/store"
)

// GoTools são os comandos do menu Ferramentas do Go (S03). Só estes: o resto é pelo terminal.
var GoTools = map[string][]string{
	"mod-tidy":     {"mod", "tidy"},
	"mod-download": {"mod", "download"},
	"generate":     {"generate", "./..."},
	"vet":          {"vet", "./..."},
	"get":          {"get"}, // + o pacote (validado)
}

// pacote@versão do go get: caminho de módulo e, opcional, @versão/@latest.
var getArg = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._~/-]*(@[A-Za-z0-9._+-]+)?$`)

// StartGoTool roda um comando do go na raiz do módulo do projeto e mostra a saída na janela Executar.
// Muda go.mod/go.sum ou gera arquivos: no fim, avisa o git e a árvore.
func (m *Manager) StartGoTool(projectID, tool, arg string) (Info, error) {
	o, err := m.reg.RequireTrusted(projectID)
	if err != nil {
		return Info{}, err
	}
	base, ok := GoTools[tool]
	if !ok {
		return Info{}, fmt.Errorf("ferramenta desconhecida: %s", tool)
	}
	args := append([]string(nil), base...)
	if tool == "get" {
		arg = strings.TrimSpace(arg)
		if !getArg.MatchString(arg) {
			return Info{}, errors.New("informe o pacote (ex.: github.com/google/uuid ou github.com/google/uuid@v1.6.0)")
		}
		args = append(args, arg)
	}
	goExe := m.goExe()
	if o.GoRoot != "" {
		goExe = filepath.Join(o.GoRoot, "bin", exeName("go"))
	}
	if goExe == "" {
		return Info{}, errors.New("go não encontrado: configure um Go SDK")
	}
	ctx, cancel := context.WithCancel(context.Background())
	e := &execution{
		info:   Info{ID: store.NewID(), ProjectID: projectID, Name: "go " + strings.Join(args, " "), State: StateRunning, StartedAt: store.NowMs()},
		out:    NewOutput(OutputLimit),
		cancel: cancel,
		done:   make(chan struct{}),
	}
	m.mu.Lock()
	m.runs[e.info.ID] = e
	m.mu.Unlock()
	info := e.info
	m.bus.Emit(events.RunState, info)
	go func() {
		defer close(e.done)
		defer e.out.Close()
		defer cancel()
		dir := moduleRoot(o.RootPath, o.RootPath)
		e.out.Write("sys", fmt.Sprintf("$ go %s\n", strings.Join(args, " ")))
		cmd := exec.CommandContext(ctx, goExe, args...)
		cmd.Dir, cmd.Env = dir, o.GoEnv(nil)
		cmd.Stdout, cmd.Stderr = writerFor(e.out, "out"), writerFor(e.out, "err")
		cmd.SysProcAttr = proc.Attr(false)
		err := cmd.Run()
		if ctx.Err() != nil {
			m.finishStopped(e)
			return
		}
		code := exitCode(err)
		if err == nil {
			e.out.Write("sys", "\nPronto.\n")
		} else {
			e.out.Write("sys", fmt.Sprintf("\nTerminou com código %d.\n", code))
		}
		m.setState(e, StateExited, &code)
		m.bus.Emit(events.GitStatus, map[string]string{"projectId": projectID})
		m.bus.Emit(events.FsChanged, map[string]any{"projectId": projectID, "paths": []string{}})
	}()
	return info, nil
}

// VetResult é o que o go vet achou nos pacotes do commit.
type VetResult struct {
	OK     bool   `json:"ok"`
	Output string `json:"output"`
}

// Vet roda go vet nos pacotes dos arquivos dados (verificação antes do commit). Espera terminar.
func (m *Manager) Vet(projectID string, files []string) (VetResult, error) {
	return m.check(projectID, files, "vet", 2*time.Minute)
}

// TestPackages roda go test nos pacotes dos arquivos dados (verificação antes do commit). Espera terminar.
func (m *Manager) TestPackages(projectID string, files []string) (VetResult, error) {
	return m.check(projectID, files, "test", 5*time.Minute)
}

func (m *Manager) check(projectID string, files []string, verb string, timeout time.Duration) (VetResult, error) {
	o, err := m.reg.RequireTrusted(projectID)
	if err != nil {
		return VetResult{}, err
	}
	dirs := map[string]bool{}
	for _, f := range files {
		if !strings.HasSuffix(f, ".go") {
			continue
		}
		abs, err := o.Abs(f)
		if err != nil {
			return VetResult{}, err
		}
		dirs[filepath.Dir(abs)] = true
	}
	if len(dirs) == 0 {
		return VetResult{OK: true}, nil
	}
	goExe := m.goExe()
	if o.GoRoot != "" {
		goExe = filepath.Join(o.GoRoot, "bin", exeName("go"))
	}
	if goExe == "" {
		return VetResult{}, errors.New("go não encontrado: configure um Go SDK")
	}
	mod := moduleRoot(o.RootPath, o.RootPath)
	args := []string{verb}
	for d := range dirs {
		rel, err := filepath.Rel(mod, d)
		if err != nil || strings.HasPrefix(rel, "..") {
			continue
		}
		args = append(args, "./"+filepath.ToSlash(rel))
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, goExe, args...)
	cmd.Dir, cmd.Env = mod, o.GoEnv(nil)
	cmd.SysProcAttr = proc.Attr(false)
	out, err := cmd.CombinedOutput()
	if ctx.Err() != nil {
		return VetResult{}, fmt.Errorf("go %s demorou demais", verb)
	}
	return VetResult{OK: err == nil, Output: strings.TrimSpace(string(out))}, nil
}
