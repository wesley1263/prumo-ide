// Package agent chama o agente de IA de linha de comando que o usuário já tem instalado (Claude Code, Codex,
// Gemini CLI ou um comando próprio) para escrever a mensagem de commit.
//
// O agente só escreve texto: roda sem ferramentas (no Claude Code, --tools ""), numa pasta temporária fora do
// projeto, recebendo o pedido e o diff pela entrada padrão. Nada roda sem o usuário clicar: é ele quem manda o
// diff para o provedor do agente.
package agent

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// Spec é um agente conhecido: o executável e os argumentos do modo não interativo.
// O pedido inteiro (instruções + diff) vai sempre pela entrada padrão.
type Spec struct {
	ID     string
	Name   string
	Vendor string
	Exe    string
	Args   []string
}

// Known são os agentes que a IDE sabe chamar, na ordem da detecção automática.
var Known = []Spec{
	{ID: "claude", Name: "Claude Code", Vendor: "Anthropic", Exe: "claude",
		Args: []string{"-p", "--tools", "", "--no-session-persistence", "--output-format", "text"}},
	{ID: "codex", Name: "Codex CLI", Vendor: "OpenAI", Exe: "codex",
		Args: []string{"exec", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never", "-"}},
	{ID: "gemini", Name: "Gemini CLI", Vendor: "Google", Exe: "gemini",
		Args: []string{"-p", "Follow the instructions above and reply with the commit message only."}},
}

// Info é um agente para a UI (Configurações): onde está, se foi achado.
type Info struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Vendor    string `json:"vendor"`
	Path      string `json:"path"`
	Available bool   `json:"available"`
}

// Command é o que vai rodar: executável resolvido, argumentos e nome para mostrar.
type Command struct {
	Name   string `json:"name"`
	Vendor string `json:"vendor"`
	Path   string `json:"path"`
	Args   []string
}

// extraDirs: onde esses CLIs costumam ficar e que um app aberto pelo menu (sem o PATH do shell) não enxerga.
func extraDirs() []string {
	home, _ := os.UserHomeDir()
	dirs := []string{
		filepath.Join(home, ".local", "bin"),
		filepath.Join(home, ".claude", "local"),
		filepath.Join(home, ".npm-global", "bin"),
		filepath.Join(home, ".bun", "bin"),
		filepath.Join(home, ".volta", "bin"),
		"/usr/local/bin", "/opt/homebrew/bin",
	}
	// nvm: a versão de node mais nova instalada.
	if m, _ := filepath.Glob(filepath.Join(home, ".nvm", "versions", "node", "*", "bin")); len(m) > 0 {
		sort.Strings(m)
		dirs = append(dirs, m[len(m)-1])
	}
	return dirs
}

// find procura o executável no PATH e nos lugares de costume.
func find(exe string) string {
	if filepath.IsAbs(exe) {
		if st, err := os.Stat(exe); err == nil && !st.IsDir() {
			return exe
		}
		return ""
	}
	if p, err := exec.LookPath(exe); err == nil {
		return p
	}
	for _, d := range extraDirs() {
		p := filepath.Join(d, exe)
		if st, err := os.Stat(p); err == nil && !st.IsDir() && st.Mode()&0o111 != 0 {
			return p
		}
	}
	return ""
}

// Detect lista os agentes conhecidos e onde cada um está.
func Detect() []Info {
	out := make([]Info, 0, len(Known))
	for _, s := range Known {
		p := find(s.Exe)
		out = append(out, Info{ID: s.ID, Name: s.Name, Vendor: s.Vendor, Path: p, Available: p != ""})
	}
	return out
}

// ErrNoAgent: nenhum agente configurado ou encontrado.
var ErrNoAgent = errors.New("nenhum agente de IA encontrado: instale o Claude Code, o Codex ou o Gemini CLI, ou configure um comando em Configurações → Ferramentas")

// Resolve escolhe o comando pela configuração: "auto" (o primeiro instalado), o id de um conhecido, ou
// "custom" com a linha de comando do usuário (programa e argumentos; o pedido vai pela entrada padrão).
func Resolve(choice, custom string, split func(string) ([]string, error)) (Command, error) {
	switch choice {
	case "", "auto":
		for _, s := range Known {
			if p := find(s.Exe); p != "" {
				return Command{Name: s.Name, Vendor: s.Vendor, Path: p, Args: s.Args}, nil
			}
		}
		return Command{}, ErrNoAgent
	case "off":
		return Command{}, errors.New("a geração de mensagens com IA está desligada (Configurações → Ferramentas)")
	case "custom":
		parts, err := split(custom)
		if err != nil || len(parts) == 0 {
			return Command{}, errors.New("configure o comando do agente em Configurações → Ferramentas")
		}
		p := find(parts[0])
		if p == "" {
			return Command{}, fmt.Errorf("comando do agente não encontrado: %s", parts[0])
		}
		return Command{Name: filepath.Base(parts[0]), Vendor: "", Path: p, Args: parts[1:]}, nil
	}
	for _, s := range Known {
		if s.ID == choice {
			p := find(s.Exe)
			if p == "" {
				return Command{}, fmt.Errorf("%s não está instalado (ou não está no PATH)", s.Name)
			}
			return Command{Name: s.Name, Vendor: s.Vendor, Path: p, Args: s.Args}, nil
		}
	}
	return Command{}, fmt.Errorf("agente desconhecido: %s", choice)
}

// Timeout de uma geração (esses agentes levam de segundos a dezenas de segundos).
const Timeout = 3 * time.Minute

// Runner roda um pedido por vez por chave (o projeto) e deixa cancelar.
type Runner struct {
	mu      sync.Mutex
	running map[string]context.CancelFunc
}

func NewRunner() *Runner { return &Runner{running: map[string]context.CancelFunc{}} }

// ErrCanceled: o usuário cancelou.
var ErrCanceled = errors.New("geração cancelada")

// Run manda o pedido para o agente e devolve a resposta já limpa.
func (r *Runner) Run(key string, cmd Command, prompt string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), Timeout)
	r.mu.Lock()
	if prev, ok := r.running[key]; ok {
		prev() // um pedido novo substitui o anterior do mesmo projeto
	}
	r.running[key] = cancel
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		delete(r.running, key)
		r.mu.Unlock()
		cancel()
	}()

	dir, err := os.MkdirTemp("", "prumo-agent-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(dir)
	c := exec.CommandContext(ctx, cmd.Path, cmd.Args...)
	c.Dir = dir // fora do projeto: o agente não tem o que ler nem onde mexer
	c.Env = append(os.Environ(), "NO_COLOR=1", "TERM=dumb")
	c.Stdin = strings.NewReader(prompt)
	var stdout, stderr bytes.Buffer
	c.Stdout, c.Stderr = &stdout, &stderr
	setGroup(c)
	err = c.Run()
	if ctx.Err() == context.Canceled {
		return "", ErrCanceled
	}
	if ctx.Err() == context.DeadlineExceeded {
		return "", fmt.Errorf("%s não respondeu em %s", cmd.Name, Timeout)
	}
	if err != nil {
		return "", fmt.Errorf("%s falhou: %s", cmd.Name, lastLines(stderr.String(), stdout.String()))
	}
	msg := Clean(stdout.String())
	if msg == "" {
		return "", fmt.Errorf("%s não devolveu nenhuma mensagem", cmd.Name)
	}
	return msg, nil
}

// Cancel interrompe o pedido em andamento do projeto (se houver).
func (r *Runner) Cancel(key string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if c, ok := r.running[key]; ok {
		c()
	}
}

func lastLines(parts ...string) string {
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		lines := strings.Split(p, "\n")
		if len(lines) > 3 {
			lines = lines[len(lines)-3:]
		}
		s := strings.Join(lines, " ")
		if len(s) > 300 {
			s = s[:300] + "…"
		}
		return s
	}
	return "sem detalhes"
}

var (
	fence  = regexp.MustCompile("(?s)^```[a-zA-Z]*\\n(.*?)\\n?```$")
	label  = regexp.MustCompile(`(?i)^(commit message|mensagem( de commit)?|message)\s*:\s*`)
	blanks = regexp.MustCompile(`\n{3,}`)
)

// Clean tira o que os agentes às vezes põem em volta da mensagem: cerca de código, rótulo, aspas.
func Clean(s string) string {
	s = strings.TrimSpace(strings.ReplaceAll(s, "\r\n", "\n"))
	if m := fence.FindStringSubmatch(s); m != nil {
		s = strings.TrimSpace(m[1])
	}
	s = label.ReplaceAllString(s, "")
	if len(s) >= 2 && (s[0] == '"' && s[len(s)-1] == '"' || s[0] == '\'' && s[len(s)-1] == '\'') && !strings.Contains(s[1:len(s)-1], "\n") {
		s = s[1 : len(s)-1]
	}
	s = blanks.ReplaceAllString(s, "\n\n")
	lines := strings.Split(s, "\n")
	for i := range lines {
		lines[i] = strings.TrimRight(lines[i], " \t")
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}
