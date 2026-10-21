// Package term são os terminais integrados: um shell do usuário num pseudo-terminal, na pasta do projeto.
//
// A sessão vive no backend, não na UI: esconder a janela, recarregar a página ou trocar de aba não mata o
// shell. A saída fica num buffer com teto (o mesmo modelo de cursor das execuções) e é reenviada a quem
// conectar. Entrada e redimensionamento chegam pelo WebSocket /term/{id} da ponte.
package term

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/creack/pty"

	"goide/internal/events"
	"goide/internal/run"
	"goide/internal/store"
	"goide/internal/workspace"
)

// HistoryBytes é quanto da saída de cada terminal fica guardado para reconexões.
const HistoryBytes = 2 << 20

// MaxPerProject limita quantos terminais um projeto pode ter abertos.
const MaxPerProject = 20

// ErrNotFound: terminal fechado ou id errado.
var ErrNotFound = errors.New("terminal não encontrado")

// Info é o que a UI mostra de um terminal.
type Info struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	Title     string `json:"title"`
	Shell     string `json:"shell"`
	Exited    bool   `json:"exited"`
	ExitCode  int    `json:"exitCode"`
	Created   int64  `json:"created"` // Unix ms (ordem das abas)
}

type session struct {
	mu   sync.Mutex
	info Info
	pty  *os.File
	cmd  *exec.Cmd
	out  *run.Output
}

// Manager guarda os terminais abertos.
type Manager struct {
	reg *workspace.Registry
	bus *events.Bus

	mu       sync.Mutex
	sessions map[string]*session
	seq      map[string]int // projectID → último número usado no título ("Local (2)")
}

// NewManager cria o gerenciador. Terminais de um projeto fecham junto com ele.
func NewManager(reg *workspace.Registry, bus *events.Bus) *Manager {
	m := &Manager{reg: reg, bus: bus, sessions: map[string]*session{}, seq: map[string]int{}}
	reg.OnClose(m.closeProject)
	return m
}

// userShell é o shell configurado ou, sem configuração, o de login do usuário.
func userShell(configured string) (string, error) {
	if configured != "" {
		p, err := exec.LookPath(configured)
		if err != nil {
			return "", fmt.Errorf("shell configurado não encontrado: %s (Configurações → Terminal)", configured)
		}
		return p, nil
	}
	return defaultShell(), nil
}

// defaultShell é o $SHELL, com alternativas comuns.
func defaultShell() string {
	if s := os.Getenv("SHELL"); s != "" {
		if _, err := exec.LookPath(s); err == nil {
			return s
		}
	}
	for _, s := range []string{"/bin/bash", "/bin/zsh", "/bin/sh"} {
		if _, err := os.Stat(s); err == nil {
			return s
		}
	}
	return "sh"
}

// Create abre um shell na pasta do projeto. Exige confiança: o shell pode carregar arquivos do projeto
// (.envrc com direnv, hooks de prompt) sem o usuário perceber.
// shell: o configurado pelo usuário ("" = $SHELL).
func (m *Manager) Create(projectID, shell string, cols, rows int) (Info, error) {
	o, err := m.reg.RequireTrusted(projectID)
	if err != nil {
		return Info{}, err
	}
	shell, err = userShell(shell)
	if err != nil {
		return Info{}, err
	}
	m.mu.Lock()
	n := 0
	for _, s := range m.sessions {
		if s.info.ProjectID == projectID {
			n++
		}
	}
	if n >= MaxPerProject {
		m.mu.Unlock()
		return Info{}, fmt.Errorf("limite de %d terminais abertos neste projeto", MaxPerProject)
	}
	m.seq[projectID]++
	num := m.seq[projectID]
	m.mu.Unlock()

	cmd := exec.Command(shell)
	cmd.Dir = o.RootPath
	cmd.Env = o.GoEnv(map[string]string{
		"TERM":         "xterm-256color",
		"COLORTERM":    "truecolor",
		"TERM_PROGRAM": "goide",
	})
	cmd.SysProcAttr = sysProcAttr()
	f, err := pty.StartWithAttrs(cmd, size(cols, rows), cmd.SysProcAttr)
	if err != nil {
		if errors.Is(err, pty.ErrUnsupported) {
			return Info{}, errors.New("terminal integrado ainda não suportado neste sistema")
		}
		return Info{}, fmt.Errorf("abrir o shell %s: %w", shell, err)
	}
	title := "Local"
	if num > 1 {
		title = fmt.Sprintf("Local (%d)", num)
	}
	s := &session{
		info: Info{ID: store.NewID(), ProjectID: projectID, Title: title, Shell: filepath.Base(shell), Created: time.Now().UnixMilli()},
		pty:  f,
		cmd:  cmd,
		out:  run.NewOutput(HistoryBytes),
	}
	m.mu.Lock()
	m.sessions[s.info.ID] = s
	m.mu.Unlock()
	go m.pump(s)
	return s.info, nil
}

func size(cols, rows int) *pty.Winsize {
	if cols <= 0 || cols > 1000 {
		cols = 80
	}
	if rows <= 0 || rows > 1000 {
		rows = 24
	}
	return &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)}
}

// pump copia a saída do shell para o buffer até ele sair.
func (m *Manager) pump(s *session) {
	buf := make([]byte, 32<<10)
	for {
		n, err := s.pty.Read(buf)
		if n > 0 {
			s.out.Write("out", string(buf[:n]))
		}
		if err != nil {
			break // EIO quando o shell sai (Linux)
		}
	}
	code := 0
	if err := s.cmd.Wait(); err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			code = ee.ExitCode()
		} else {
			code = -1
		}
	}
	s.pty.Close()
	s.mu.Lock()
	s.info.Exited, s.info.ExitCode = true, code
	info := s.info
	s.mu.Unlock()
	s.out.Write("sys", fmt.Sprintf("\r\n\x1b[2m[processo encerrado com código %d]\x1b[0m\r\n", code))
	s.out.Close()
	m.bus.Emit(events.TermState, info)
}

func (m *Manager) get(id string) (*session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.sessions[id]
	if s == nil {
		return nil, ErrNotFound
	}
	return s, nil
}

// List devolve os terminais do projeto na ordem em que foram abertos.
func (m *Manager) List(projectID string) []Info {
	m.mu.Lock()
	out := []Info{}
	for _, s := range m.sessions {
		if s.info.ProjectID == projectID {
			s.mu.Lock()
			out = append(out, s.info)
			s.mu.Unlock()
		}
	}
	m.mu.Unlock()
	sort.Slice(out, func(i, j int) bool { return out[i].Created < out[j].Created })
	return out
}

// Rename troca o título da aba.
func (m *Manager) Rename(id, title string) error {
	s, err := m.get(id)
	if err != nil {
		return err
	}
	if title == "" || len(title) > 60 {
		return errors.New("título vazio ou longo demais")
	}
	s.mu.Lock()
	s.info.Title = title
	s.mu.Unlock()
	return nil
}

// Output é o histórico + saída ao vivo (para a ponte).
func (m *Manager) Output(id string) (*run.Output, error) {
	s, err := m.get(id)
	if err != nil {
		return nil, err
	}
	return s.out, nil
}

// Input escreve o que o usuário digitou.
func (m *Manager) Input(id string, p []byte) error {
	s, err := m.get(id)
	if err != nil {
		return err
	}
	s.mu.Lock()
	exited := s.info.Exited
	s.mu.Unlock()
	if exited {
		return nil
	}
	_, err = s.pty.Write(p)
	return err
}

// Resize ajusta o tamanho do terminal (o shell recebe SIGWINCH).
func (m *Manager) Resize(id string, cols, rows int) error {
	s, err := m.get(id)
	if err != nil {
		return err
	}
	s.mu.Lock()
	exited := s.info.Exited
	s.mu.Unlock()
	if exited {
		return nil
	}
	return pty.Setsize(s.pty, size(cols, rows))
}

// Close encerra o shell (e o que estiver rodando nele) e esquece o terminal.
func (m *Manager) Close(id string) error {
	m.mu.Lock()
	s := m.sessions[id]
	delete(m.sessions, id)
	m.mu.Unlock()
	if s == nil {
		return ErrNotFound
	}
	s.mu.Lock()
	exited := s.info.Exited
	s.mu.Unlock()
	if s.cmd.Process != nil {
		if !exited {
			hangup(s.cmd.Process)
		}
		// Jobs em segundo plano têm grupo próprio e podem ignorar o SIGHUP: depois de um tempo para
		// saírem por conta própria, tudo o que ainda estiver na sessão do terminal morre.
		pid := s.cmd.Process.Pid
		go func() {
			time.Sleep(time.Second)
			killSession(pid)
		}()
	}
	return nil
}

func (m *Manager) closeProject(projectID string) {
	for _, i := range m.List(projectID) {
		_ = m.Close(i.ID)
	}
}

// StopAll encerra todos os terminais (fechamento do app).
func (m *Manager) StopAll() {
	m.mu.Lock()
	ids := make([]string, 0, len(m.sessions))
	for id := range m.sessions {
		ids = append(ids, id)
	}
	m.mu.Unlock()
	for _, id := range ids {
		_ = m.Close(id)
	}
}
