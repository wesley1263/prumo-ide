// Package sdk detecta e gerencia os Go SDKs (GOROOTs).
package sdk

import (
	"bufio"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"goide/internal/store"
	"goide/internal/tools"
)

// Sdks é o serviço exposto à UI.
type Sdks struct {
	db    *store.DB
	tools *tools.Finder

	once      sync.Once
	downloads *downloads
}

// New cria o serviço.
func New(db *store.DB, t *tools.Finder) *Sdks { return &Sdks{db: db, tools: t} }

// List devolve os SDKs conhecidos, o padrão primeiro.
func (s *Sdks) List() ([]store.GoSdk, error) { return s.db.ListSdks(context.Background()) }

// SetDefault troca o SDK padrão.
func (s *Sdks) SetDefault(id string) error { return s.db.SetDefaultSdk(context.Background(), id) }

// Detect procura GOROOTs nos lugares comuns, registra os novos e garante um padrão.
// O padrão inicial é o do go que está no PATH.
func (s *Sdks) Detect() ([]store.GoSdk, error) {
	ctx := context.Background()
	pathRoot := s.gorootFromPath(ctx)
	candidates := []string{pathRoot, "/usr/local/go", "/usr/lib/go", "/opt/go"}
	if home, err := os.UserHomeDir(); err == nil {
		if dirs, err := filepath.Glob(filepath.Join(home, "sdk", "go*")); err == nil {
			candidates = append(candidates, dirs...)
		}
		if dirs, err := filepath.Glob(filepath.Join(home, "go", "pkg", "mod", "golang.org", "toolchain@*")); err == nil {
			candidates = append(candidates, dirs...)
		}
	}
	seen := map[string]bool{}
	var defaultID string
	for _, c := range candidates {
		if c == "" {
			continue
		}
		real, err := filepath.EvalSymlinks(c)
		if err != nil || seen[real] {
			continue
		}
		seen[real] = true
		v := Version(real)
		if v == "" {
			continue
		}
		row, err := s.db.UpsertSdk(ctx, real, v, "detected")
		if err != nil {
			return nil, err
		}
		if c == pathRoot && defaultID == "" {
			defaultID = row.ID
		}
	}
	list, err := s.db.ListSdks(ctx)
	if err != nil {
		return nil, err
	}
	hasDefault := len(list) > 0 && list[0].IsDefault
	if !hasDefault && len(list) > 0 {
		if defaultID == "" {
			defaultID = list[0].ID
		}
		if err := s.db.SetDefaultSdk(ctx, defaultID); err != nil {
			return nil, err
		}
		return s.db.ListSdks(ctx)
	}
	return list, nil
}

func (s *Sdks) gorootFromPath(ctx context.Context) string {
	goExe := s.tools.Find("go")
	if goExe == "" {
		return ""
	}
	cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	// Fora de qualquer módulo e sem troca automática de toolchain: queremos o go instalado,
	// não o que um go.mod do diretório atual baixaria.
	cmd := exec.CommandContext(cctx, goExe, "env", "GOROOT")
	cmd.Dir = os.TempDir()
	cmd.Env = append(os.Environ(), "GOTOOLCHAIN=local")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// Version lê "goX.Y.Z" da primeira linha de $GOROOT/VERSION, ou "" se não for um GOROOT.
func Version(goroot string) string {
	if _, err := os.Stat(filepath.Join(goroot, "bin", exe("go"))); err != nil {
		return ""
	}
	f, err := os.Open(filepath.Join(goroot, "VERSION"))
	if err != nil {
		return ""
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	if sc.Scan() && strings.HasPrefix(sc.Text(), "go") {
		return strings.TrimSpace(sc.Text())
	}
	return ""
}

func exe(name string) string {
	if os.PathSeparator == '\\' {
		return name + ".exe"
	}
	return name
}
