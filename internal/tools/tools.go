// Package tools localiza e instala as ferramentas externas: go, git, gopls, dlv, rg.
package tools

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Versões fixadas que a IDE instala quando a ferramenta não existe.
const (
	GoplsModule = "golang.org/x/tools/gopls@v0.22.0"
	DlvModule   = "github.com/go-delve/delve/cmd/dlv@v1.27.2"
)

// Tool é o resultado da busca por uma ferramenta.
type Tool struct {
	Name    string `json:"name"`
	Path    string `json:"path"`    // "" = não encontrada
	Version string `json:"version"` // primeira linha de "<tool> version"
}

// Status reúne as ferramentas que a IDE usa.
type Status struct {
	Go    Tool `json:"go"`
	Git   Tool `json:"git"`
	Gopls Tool `json:"gopls"`
	Dlv   Tool `json:"dlv"`
	Rg    Tool `json:"rg"`
}

// Finder procura binários no PATH, em $GOPATH/bin e no diretório de ferramentas do app.
type Finder struct {
	AppToolsDir string

	once   sync.Once
	gopath string
}

func (f *Finder) goBin() string {
	f.once.Do(func() {
		if p := os.Getenv("GOPATH"); p != "" {
			f.gopath = p
			return
		}
		if goExe, err := exec.LookPath("go"); err == nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if out, err := exec.CommandContext(ctx, goExe, "env", "GOPATH").Output(); err == nil {
				f.gopath = strings.TrimSpace(string(out))
				return
			}
		}
		if home, err := os.UserHomeDir(); err == nil {
			f.gopath = filepath.Join(home, "go")
		}
	})
	if f.gopath == "" {
		return ""
	}
	return filepath.Join(strings.Split(f.gopath, string(os.PathListSeparator))[0], "bin")
}

// Find devolve o caminho do binário ou "".
func (f *Finder) Find(name string) string {
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	for _, dir := range []string{f.AppToolsDir, f.goBin()} {
		if dir == "" {
			continue
		}
		p := filepath.Join(dir, exe(name))
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

// Status localiza todas as ferramentas e lê as versões.
func (f *Finder) Status(ctx context.Context) Status {
	get := func(name string, args ...string) Tool {
		t := Tool{Name: name, Path: f.Find(name)}
		if t.Path == "" {
			return t
		}
		cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		out, err := exec.CommandContext(cctx, t.Path, args...).Output()
		if err == nil {
			t.Version = strings.TrimSpace(strings.SplitN(string(out), "\n", 2)[0])
		}
		return t
	}
	return Status{
		Go:    get("go", "version"),
		Git:   get("git", "--version"),
		Gopls: get("gopls", "version"),
		Dlv:   get("dlv", "version"),
		Rg:    get("rg", "--version"),
	}
}

// GoRoots devolve GOROOT e GOMODCACHE do ambiente dado (as raízes de código de fora do projeto).
func (f *Finder) GoRoots(env []string) []string {
	goExe := f.Find("go")
	if goExe == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, goExe, "env", "GOROOT", "GOMODCACHE")
	cmd.Env = env
	cmd.Dir = os.TempDir()
	out, err := cmd.Output()
	if err != nil {
		return nil
	}
	var roots []string
	for _, l := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if l = strings.TrimSpace(l); l != "" {
			roots = append(roots, l)
		}
	}
	return roots
}

// Install roda "go install module" com GOBIN apontando para o diretório de ferramentas do app.
func (f *Finder) Install(ctx context.Context, module string) ([]byte, error) {
	goExe := f.Find("go")
	if goExe == "" {
		return nil, exec.ErrNotFound
	}
	if err := os.MkdirAll(f.AppToolsDir, 0o755); err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, goExe, "install", module)
	cmd.Env = append(os.Environ(), "GOBIN="+f.AppToolsDir)
	return cmd.CombinedOutput()
}

func exe(name string) string {
	if os.PathSeparator == '\\' {
		return name + ".exe"
	}
	return name
}
