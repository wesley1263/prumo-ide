// Package windows deixa várias janelas do Prumo abertas ao mesmo tempo, uma por projeto, como no GoLand.
//
// O Wails v2 tem uma janela por processo, então cada janela é um processo do Prumo. Cada uma escreve um
// arquivo na pasta de dados (windows/<pid>.json, só do usuário) com a porta e o token da sua ponte local e
// os projetos abertos nela. Antes de abrir um projeto, a janela olha esses arquivos: se outra já tem o
// projeto, pede pela ponte que ela venha para a frente, em vez de abrir o mesmo projeto duas vezes.
package windows

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// FocusPath é a rota da ponte que traz a janela para a frente.
const FocusPath = "/window/focus"

// TokenHeader é o cabeçalho do token da ponte (o mesmo de internal/bridge).
const TokenHeader = "X-Prumo-Token"

// Entry é uma janela aberta.
type Entry struct {
	PID      int      `json:"pid"`
	Port     int      `json:"port"`
	Token    string   `json:"token"`
	Projects []string `json:"projects"` // caminhos absolutos das pastas abertas
}

// Registry é a janela deste processo e a leitura das outras.
type Registry struct {
	dir  string
	mu   sync.Mutex
	self Entry
	// focusTimeout: quanto esperar a outra janela responder (uma janela travada conta como fechada).
	focusTimeout time.Duration
}

// New registra esta janela em dir (a pasta é criada só para o usuário).
func New(dir string, port int, token string) (*Registry, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	r := &Registry{dir: dir, self: Entry{PID: os.Getpid(), Port: port, Token: token, Projects: []string{}}, focusTimeout: 2 * time.Second}
	return r, r.write()
}

func (r *Registry) file(pid int) string { return filepath.Join(r.dir, strconv.Itoa(pid)+".json") }

func (r *Registry) write() error {
	b, err := json.Marshal(r.self)
	if err != nil {
		return err
	}
	tmp := r.file(r.self.PID) + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, r.file(r.self.PID))
}

// Opened marca o projeto como aberto nesta janela.
func (r *Registry) Opened(path string) error {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !slices.Contains(r.self.Projects, path) {
		r.self.Projects = append(r.self.Projects, path)
	}
	return r.write()
}

// Closed tira o projeto desta janela.
func (r *Registry) Closed(path string) error {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.self.Projects = slices.DeleteFunc(r.self.Projects, func(p string) bool { return p == path })
	return r.write()
}

// Close apaga o registro desta janela (o processo vai sair).
func (r *Registry) Close() {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	_ = os.Remove(r.file(r.self.PID))
}

// others lê as outras janelas registradas.
func (r *Registry) others() []Entry {
	ents, err := os.ReadDir(r.dir)
	if err != nil {
		return nil
	}
	var out []Entry
	for _, e := range ents {
		name := e.Name()
		if !strings.HasSuffix(name, ".json") || name == strconv.Itoa(r.self.PID)+".json" {
			continue
		}
		b, err := os.ReadFile(filepath.Join(r.dir, name))
		if err != nil {
			continue
		}
		var w Entry
		if json.Unmarshal(b, &w) != nil || w.PID == 0 || w.Port == 0 {
			continue
		}
		out = append(out, w)
	}
	return out
}

// FocusOther procura outra janela com o projeto em path e pede que ela venha para a frente. Devolve true se
// alguma janela tinha o projeto e respondeu. Janela que não responde é dada como fechada (o arquivo dela é
// apagado: o processo caiu sem limpar).
func (r *Registry) FocusOther(path string) bool {
	if r == nil {
		return false
	}
	for _, w := range r.others() {
		if !slices.Contains(w.Projects, path) {
			continue
		}
		if err := r.focus(w); err != nil {
			_ = os.Remove(r.file(w.PID))
			continue
		}
		return true
	}
	return false
}

func (r *Registry) focus(w Entry) error {
	ctx, cancel := context.WithTimeout(context.Background(), r.focusTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("http://127.0.0.1:%d%s", w.Port, FocusPath), nil)
	if err != nil {
		return err
	}
	req.Header.Set(TokenHeader, w.Token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("a janela %d respondeu %d", w.PID, resp.StatusCode)
	}
	return nil
}

// ErrNoExecutable: não deu para achar o próprio executável para abrir outra janela.
var ErrNoExecutable = errors.New("não foi possível achar o executável do Prumo para abrir outra janela")

// Launch abre uma janela nova (outro processo do Prumo), já no projeto em path ("" = tela inicial).
func Launch(path string) error {
	exe, err := os.Executable()
	if err != nil {
		return ErrNoExecutable
	}
	if real, err := filepath.EvalSymlinks(exe); err == nil {
		exe = real
	}
	args := []string{}
	if path != "" {
		args = append(args, "--project", path)
	}
	cmd := exec.Command(exe, args...)
	cmd.Env = os.Environ()
	detach(cmd) // a janela nova não morre junto com esta
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("não foi possível abrir outra janela: %w", err)
	}
	go func() { _ = cmd.Wait() }() // sem processo zumbi enquanto esta janela vive
	return nil
}

// ProjectArg lê "--project <pasta>" (ou "--project=<pasta>") dos argumentos do programa.
func ProjectArg(args []string) string {
	for i, a := range args {
		if a == "--project" && i+1 < len(args) {
			return args[i+1]
		}
		if v, ok := strings.CutPrefix(a, "--project="); ok {
			return v
		}
	}
	return ""
}
