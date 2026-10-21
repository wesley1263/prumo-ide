package gitx

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"prumo/internal/events"
	"prumo/internal/proc"
	"prumo/internal/store"
)

// ---------------------------------------------------------------- clonar (S29)

// CloneProgress é o que o evento clone:progress leva.
type CloneProgress struct {
	ID      string `json:"id"`
	Phase   string `json:"phase"`   // em português ("Recebendo objetos")
	Percent int    `json:"percent"` // 0–100 do clone inteiro
	Line    string `json:"line"`    // a última linha do git, como veio
	Done    bool   `json:"done"`
	OK      bool   `json:"ok"`
	Error   string `json:"error,omitempty"`
	Path    string `json:"path"`
}

// CloneStart é a resposta de Clone: o id para acompanhar e onde o repositório vai ficar.
type CloneStart struct {
	ID   string `json:"id"`
	Path string `json:"path"`
}

type cloneRun struct {
	cancel   context.CancelFunc
	canceled bool
	last     CloneProgress // o último estado (o evento pode se perder; a UI também consulta)
	ended    time.Time
}

var (
	clonesMu sync.Mutex
	clones   = map[string]*cloneRun{}
)

// scpLike é o formato git@host:caminho (ssh sem esquema).
var scpLike = regexp.MustCompile(`^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^/].*$`)

// checkCloneURL aceita https, ssh, git, file, git@host:caminho e caminho local absoluto.
func checkCloneURL(url string) error {
	switch {
	case url == "":
		return errors.New("cole a URL do repositório")
	case strings.HasPrefix(url, "-") || strings.ContainsAny(url, " \t\n\x00"):
		return errors.New("URL inválida")
	case strings.Contains(url, "::"):
		// Transportes "ext::", "fd::": executam comandos. Nunca.
		return errors.New("esse tipo de endereço não é aceito")
	}
	for _, p := range []string{"https://", "http://", "ssh://", "git://", "file://"} {
		if strings.HasPrefix(url, p) {
			return nil
		}
	}
	if scpLike.MatchString(url) || filepath.IsAbs(url) {
		return nil
	}
	return errors.New("use uma URL https://, ssh:// ou git@servidor:caminho")
}

// RepoName sugere o nome da pasta a partir da URL ("https://x/org/app.git" → "app").
func RepoName(url string) string {
	u := strings.TrimRight(url, "/")
	if i := strings.LastIndexAny(u, "/:"); i >= 0 {
		u = u[i+1:]
	}
	u = strings.TrimSuffix(u, ".git")
	if u == "" || u == "." || u == ".." {
		return "repositorio"
	}
	return u
}

func expandHome(p string) string {
	if p == "~" || strings.HasPrefix(p, "~/") {
		if h, err := os.UserHomeDir(); err == nil {
			return filepath.Join(h, strings.TrimPrefix(p, "~"))
		}
	}
	return p
}

// Clone começa a clonar url em parent/name. O progresso vem pelo evento clone:progress; o último evento tem
// Done (e OK ou Error). Não precisa de projeto aberto: é a tela inicial que clona.
func (g *Git) Clone(url, parent, name string) (CloneStart, error) {
	url = strings.TrimSpace(url)
	if err := checkCloneURL(url); err != nil {
		return CloneStart{}, err
	}
	parent = expandHome(strings.TrimSpace(parent))
	if !filepath.IsAbs(parent) {
		return CloneStart{}, errors.New("a pasta de destino precisa ser um caminho absoluto")
	}
	if st, err := os.Stat(parent); err != nil || !st.IsDir() {
		return CloneStart{}, fmt.Errorf("pasta não encontrada: %s", parent)
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = RepoName(url)
	}
	if strings.ContainsAny(name, `/\`) || name == "." || name == ".." {
		return CloneStart{}, errors.New("nome de pasta inválido")
	}
	target := filepath.Join(parent, name)
	created := true
	if entries, err := os.ReadDir(target); err == nil {
		if len(entries) > 0 {
			return CloneStart{}, fmt.Errorf("a pasta %s já existe e não está vazia", target)
		}
		created = false
	}
	exe := g.gitExe()
	if exe == "" {
		return CloneStart{}, errors.New("git não encontrado no PATH")
	}

	ctx, cancel := context.WithCancel(context.Background())
	run := &cloneRun{cancel: cancel}
	id := store.NewID()
	clonesMu.Lock()
	clones[id] = run
	clonesMu.Unlock()

	cmd := exec.CommandContext(ctx, exe, "-c", "protocol.ext.allow=never", "clone", "--progress", "--", url, target)
	cmd.Env = append(append(os.Environ(), "LC_ALL=C", "GIT_TERMINAL_PROMPT=0"), sshBatch()...)
	cmd.SysProcAttr = proc.Attr(false)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		return CloneStart{}, err
	}
	if err := cmd.Start(); err != nil {
		cancel()
		return CloneStart{}, err
	}
	go func() {
		defer cancel()
		var tail bytes.Buffer // o fim do stderr, para a mensagem de erro
		last := time.Time{}
		sc := bufio.NewScanner(stderr)
		sc.Buffer(make([]byte, 64<<10), 1<<20)
		// O git reescreve a mesma linha com \r enquanto avança.
		sc.Split(func(data []byte, atEOF bool) (int, []byte, error) {
			if i := bytes.IndexAny(data, "\r\n"); i >= 0 {
				return i + 1, data[:i], nil
			}
			if atEOF && len(data) > 0 {
				return len(data), data, nil
			}
			return 0, nil, nil
		})
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" {
				continue
			}
			if !strings.Contains(line, "%") || tail.Len() < 4096 {
				tail.WriteString(line + "\n")
			}
			phase, pct, ok := parseCloneLine(line)
			if !ok || time.Since(last) < 100*time.Millisecond {
				continue
			}
			last = time.Now()
			p := CloneProgress{ID: id, Phase: phase, Percent: pct, Line: line, Path: target}
			clonesMu.Lock()
			run.last = p
			clonesMu.Unlock()
			g.bus.Emit(events.CloneProgress, p)
		}
		err := cmd.Wait()
		clonesMu.Lock()
		canceled := run.canceled
		clonesMu.Unlock()
		res := CloneProgress{ID: id, Done: true, Path: target, Percent: 100}
		switch {
		case err == nil:
			res.OK, res.Phase = true, "Pronto"
		case canceled:
			res.Error = "Clonagem cancelada."
		default:
			res.Error = cloneError(tail.String())
		}
		if !res.OK && created {
			_ = os.RemoveAll(target) // não deixa um repositório pela metade
		} else if !res.OK {
			// A pasta já existia vazia: esvazia de novo.
			if entries, err := os.ReadDir(target); err == nil {
				for _, e := range entries {
					_ = os.RemoveAll(filepath.Join(target, e.Name()))
				}
			}
		}
		clonesMu.Lock()
		run.last, run.ended = res, time.Now()
		// Clones terminados ficam um tempo para quem perguntar; depois somem.
		for k, r := range clones {
			if !r.ended.IsZero() && time.Since(r.ended) > 10*time.Minute {
				delete(clones, k)
			}
		}
		clonesMu.Unlock()
		g.bus.Emit(events.CloneProgress, res)
	}()
	return CloneStart{ID: id, Path: target}, nil
}

// CloneStatus devolve o último estado de um clone (o mesmo do evento clone:progress).
func (g *Git) CloneStatus(id string) (CloneProgress, error) {
	clonesMu.Lock()
	defer clonesMu.Unlock()
	r := clones[id]
	if r == nil {
		return CloneProgress{}, errors.New("clone desconhecido")
	}
	p := r.last
	p.ID = id
	return p, nil
}

// CancelClone interrompe uma clonagem em andamento.
func (g *Git) CancelClone(id string) {
	clonesMu.Lock()
	defer clonesMu.Unlock()
	if r := clones[id]; r != nil && r.ended.IsZero() {
		r.canceled = true
		r.cancel()
	}
}

var progressRe = regexp.MustCompile(`^(?:remote: )?([A-Za-z ]+):\s+(\d+)%`)

// Fases do clone e quanto cada uma vale no percentual total.
var clonePhases = map[string]struct {
	label    string
	from, to int
}{
	"Enumerating objects":  {"Contando objetos", 0, 2},
	"Counting objects":     {"Contando objetos", 2, 5},
	"Compressing objects":  {"Comprimindo objetos", 5, 10},
	"Receiving objects":    {"Recebendo objetos", 10, 80},
	"Resolving deltas":     {"Resolvendo diferenças", 80, 95},
	"Updating files":       {"Criando os arquivos", 95, 100},
	"Checking out files":   {"Criando os arquivos", 95, 100},
	"Filtering content":    {"Baixando arquivos grandes", 95, 100},
	"Updating index flags": {"Criando os arquivos", 95, 100},
}

func parseCloneLine(line string) (string, int, bool) {
	m := progressRe.FindStringSubmatch(line)
	if m == nil {
		return "", 0, false
	}
	ph, ok := clonePhases[strings.TrimSpace(m[1])]
	if !ok {
		return "", 0, false
	}
	p, _ := strconv.Atoi(m[2])
	return ph.label, ph.from + (ph.to-ph.from)*p/100, true
}

// cloneError traduz os erros mais comuns do git clone; o resto vai como o git disse.
func cloneError(stderr string) string {
	low := strings.ToLower(stderr)
	switch {
	case strings.Contains(low, "authentication failed") || strings.Contains(low, "permission denied (publickey") ||
		strings.Contains(low, "could not read username") || strings.Contains(low, "terminal prompts disabled"):
		return "Falha de autenticação. Para ssh, carregue a chave no ssh-agent; para https, configure um credential helper do git."
	case strings.Contains(low, "repository not found") || strings.Contains(low, "does not appear to be a git repository") ||
		strings.Contains(low, "not found") || (strings.Contains(low, "repository '") && strings.Contains(low, "does not exist")):
		return "Repositório não encontrado (ou sem permissão para ver)."
	case strings.Contains(low, "could not resolve host"):
		return "Servidor não encontrado: confira a URL e a conexão."
	}
	lines := strings.Split(strings.TrimSpace(stderr), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if l := strings.TrimSpace(lines[i]); strings.HasPrefix(l, "fatal:") || strings.HasPrefix(l, "error:") {
			return l
		}
	}
	if len(lines) > 0 {
		return lines[len(lines)-1]
	}
	return "o git clone falhou"
}
