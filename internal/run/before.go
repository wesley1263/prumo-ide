package run

import (
	"context"
	"fmt"
	"os/exec"
	"strings"

	"goide/internal/proc"
	"goide/internal/store"
	"goide/internal/workspace"
)

// beforeLaunch roda as tarefas da config, na ordem, com a saída no console desta execução.
// A primeira que falhar (ou um Stop) encerra a execução sem compilar. Devolve se pode seguir.
func (m *Manager) beforeLaunch(ctx context.Context, o *workspace.Open, cfg store.RunConfig, plan buildPlan, goExe string, env []string, e *execution) bool {
	for i, t := range cfg.BeforeLaunch {
		if ctx.Err() != nil {
			m.finishStopped(e)
			return false
		}
		var code int
		var err error
		switch t.Kind {
		case "go_generate":
			code, err = m.task(ctx, e, plan.dir, env, goExe, append([]string{"generate"}, plan.target...)...)
		case "external_tool":
			args, perr := SplitArgs(deref(t.Command))
			if perr != nil || len(args) == 0 {
				m.fail(e, fmt.Sprintf("tarefa %d: comando inválido", i+1))
				return false
			}
			code, err = m.task(ctx, e, o.RootPath, env, args[0], args[1:]...)
		case "run_config":
			code, err = m.runConfigTask(ctx, o.ID, deref(t.Ref), e)
		default:
			err = fmt.Errorf("tipo de tarefa desconhecido: %s", t.Kind)
		}
		if ctx.Err() != nil {
			m.finishStopped(e)
			return false
		}
		if err != nil {
			m.fail(e, fmt.Sprintf("tarefa %d antes de rodar: %v", i+1, err))
			return false
		}
		if code != 0 {
			e.out.Write("sys", fmt.Sprintf("\nA tarefa %d antes de rodar falhou (código %d): nada foi compilado.\n", i+1, code))
			m.setState(e, StateFailed, &code)
			return false
		}
	}
	return true
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// task roda um comando e devolve o código de saída.
func (m *Manager) task(ctx context.Context, e *execution, dir string, env []string, exe string, args ...string) (int, error) {
	e.out.Write("sys", fmt.Sprintf("$ %s %s\n", strings.TrimSuffix(exeBase(exe), ".exe"), strings.Join(args, " ")))
	cmd := exec.CommandContext(ctx, exe, args...)
	cmd.Dir, cmd.Env = dir, env
	cmd.Stdout, cmd.Stderr = writerFor(e.out, "out"), writerFor(e.out, "err")
	cmd.SysProcAttr = proc.Attr(false)
	err := cmd.Run()
	if err != nil {
		if _, ok := err.(*exec.ExitError); ok {
			return exitCode(err), nil
		}
		return -1, err
	}
	return 0, nil
}

func exeBase(p string) string {
	if i := strings.LastIndexAny(p, `/\\`); i >= 0 {
		return p[i+1:]
	}
	return p
}

// runConfigTask roda outra config (ela aparece na própria aba) e espera ela terminar.
func (m *Manager) runConfigTask(ctx context.Context, projectID, ref string, e *execution) (int, error) {
	info, err := m.start(projectID, ref, false)
	if err != nil {
		return -1, err
	}
	e.out.Write("sys", fmt.Sprintf("▶ rodando antes: %s (a saída fica na aba dela)\n", info.Name))
	m.mu.Lock()
	child := m.runs[info.ID]
	m.mu.Unlock()
	select {
	case <-child.done:
	case <-ctx.Done():
		_ = m.Stop(info.ID)
		<-child.done
		return -1, nil
	}
	child.mu.Lock()
	defer child.mu.Unlock()
	if child.info.ExitCode == nil {
		return -1, nil // parada ou falha sem código
	}
	return *child.info.ExitCode, nil
}
