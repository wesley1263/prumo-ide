package debug

import (
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/go-dap"

	"goide/internal/run"
	"goide/internal/store"
	"goide/internal/workspace"
)

// Attach: depurar um processo que já está rodando nesta máquina (pelo pid) ou um "dlv --headless" em outra
// (ou nesta) máquina, pelo endereço. Parar só desconecta: o processo continua.

// Process é um processo do usuário que dá para anexar.
type Process struct {
	PID     int    `json:"pid"`
	Name    string `json:"name"`
	Command string `json:"command"`
}

// Processes lista os processos do usuário atual (Linux: /proc), mais novos primeiro.
func (m *Manager) Processes() ([]Process, error) {
	if runtime.GOOS != "linux" {
		return nil, errors.New("a lista de processos só existe no Linux por enquanto; informe o pid")
	}
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil, err
	}
	uid := os.Getuid()
	self := os.Getpid()
	out := []Process{}
	for _, e := range entries {
		pid, err := strconv.Atoi(e.Name())
		if err != nil || pid == self {
			continue
		}
		info, err := os.Stat(filepath.Join("/proc", e.Name()))
		if err != nil || !ownedBy(info, uid) {
			continue
		}
		cmd, _ := os.ReadFile(filepath.Join("/proc", e.Name(), "cmdline"))
		comm, _ := os.ReadFile(filepath.Join("/proc", e.Name(), "comm"))
		line := strings.TrimSpace(strings.ReplaceAll(string(cmd), "\x00", " "))
		if line == "" {
			continue // thread do kernel ou zumbi
		}
		out = append(out, Process{PID: pid, Name: strings.TrimSpace(string(comm)), Command: line})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].PID > out[j].PID })
	return out, nil
}

// AttachLocal anexa o Delve ao processo pid.
func (m *Manager) AttachLocal(projectID string, pid int) (Info, error) {
	o, err := m.reg.RequireTrusted(projectID)
	if err != nil {
		return Info{}, err
	}
	if pid <= 1 {
		return Info{}, errors.New("pid inválido")
	}
	if _, err := os.FindProcess(pid); err != nil {
		return Info{}, fmt.Errorf("processo %d não encontrado", pid)
	}
	dlv := m.dlvExe()
	if dlv == "" {
		return Info{}, errors.New("o Delve (dlv) não está instalado: instale pelas ferramentas da IDE")
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return Info{}, err
	}
	cmd := exec.Command(dlv, "dap", "--client-addr", ln.Addr().String())
	cmd.Dir = o.RootPath
	cmd.Env = o.GoEnv(nil)
	s := m.newAttachSession(projectID, o, fmt.Sprintf("Processo %d", pid), cmd)
	cmd.Stdout = outWriter{s.out, "sys"}
	cmd.Stderr = outWriter{s.out, "err"}
	setProcessGroup(cmd)
	if err := cmd.Start(); err != nil {
		ln.Close()
		return Info{}, fmt.Errorf("iniciar o Delve: %w", err)
	}
	info := m.register(s, fmt.Sprintf("Anexando ao processo %d…\n", pid))
	go m.run(s, acceptOnce(ln), &dap.AttachRequest{Request: req("attach"), Arguments: raw(map[string]any{"mode": "local", "processId": pid})})
	return info, nil
}

// AttachRemote conecta num "dlv --headless --listen=host:porta" que já está rodando.
func (m *Manager) AttachRemote(projectID, addr string) (Info, error) {
	o, err := m.reg.RequireTrusted(projectID)
	if err != nil {
		return Info{}, err
	}
	addr = strings.TrimSpace(addr)
	if _, port, err := net.SplitHostPort(addr); err != nil || port == "" {
		return Info{}, errors.New("informe host:porta (ex.: localhost:2345)")
	}
	s := m.newAttachSession(projectID, o, "Remoto "+addr, nil)
	info := m.register(s, fmt.Sprintf("Conectando ao Delve em %s…\n", addr))
	dial := func() (net.Conn, error) { return net.DialTimeout("tcp", addr, 10*time.Second) }
	go m.run(s, dial, &dap.AttachRequest{Request: req("attach"), Arguments: raw(map[string]any{"mode": "remote"})})
	return info, nil
}

func (m *Manager) newAttachSession(projectID string, o *workspace.Open, name string, cmd *exec.Cmd) *session {
	return &session{
		info:    Info{ID: store.NewID(), ProjectID: projectID, Name: name, State: StateStarting},
		project: o,
		cmd:     cmd,
		out:     run.NewOutput(run.OutputLimit),
		inited:  make(chan struct{}),
		done:    make(chan struct{}),
		attach:  true,
	}
}

func (m *Manager) register(s *session, msg string) Info {
	m.mu.Lock()
	m.sessions[s.info.ID] = s
	m.mu.Unlock()
	info := s.info
	m.emit(s)
	s.out.Write("sys", msg)
	return info
}
