// Package workspace mantém os projetos abertos nesta sessão e o que é derivado deles:
// caminhos seguros, ambiente Go e a regra de confiança.
package workspace

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"prumo/internal/store"
)

var (
	// ErrNotOpen: o projeto não está aberto nesta sessão.
	ErrNotOpen = errors.New("projeto não está aberto")
	// ErrUntrusted: a ação executaria código de um projeto ainda não marcado como confiável.
	ErrUntrusted = errors.New("projeto não confiável: confirme a confiança antes de executar código dele")
	// ErrOutsideProject: o caminho escapa da raiz do projeto.
	ErrOutsideProject = errors.New("caminho fora do projeto")
)

// Open é um projeto aberto.
type Open struct {
	store.Project
	HasGoMod  bool   `json:"hasGoMod"`
	HasGoWork bool   `json:"hasGoWork"`
	GoRoot    string `json:"goRoot"` // "" = o go do PATH
}

// Registry é o conjunto de projetos abertos.
type Registry struct {
	db      *store.DB
	mu      sync.RWMutex
	open    map[string]*Open
	onClose []func(projectID string)
}

// NewRegistry cria um registro vazio.
func NewRegistry(db *store.DB) *Registry {
	return &Registry{db: db, open: map[string]*Open{}}
}

// OnClose registra um gancho chamado quando um projeto fecha (parar gopls, processos...).
func (r *Registry) OnClose(fn func(projectID string)) {
	r.mu.Lock()
	r.onClose = append(r.onClose, fn)
	r.mu.Unlock()
}

// Add abre (ou reabre) o projeto na sessão.
func (r *Registry) Add(ctx context.Context, p store.Project) (*Open, error) {
	o := &Open{Project: p}
	o.HasGoMod = exists(filepath.Join(p.RootPath, "go.mod"))
	o.HasGoWork = exists(filepath.Join(p.RootPath, "go.work"))
	if err := r.resolveGoRoot(ctx, o); err != nil {
		return nil, err
	}
	r.mu.Lock()
	r.open[p.ID] = o
	r.mu.Unlock()
	return o, nil
}

func (r *Registry) resolveGoRoot(ctx context.Context, o *Open) error {
	if o.GoSdkID != nil {
		sdk, err := r.db.SdkByID(ctx, *o.GoSdkID)
		if err == nil {
			o.GoRoot = sdk.Goroot
			return nil
		}
		if !errors.Is(err, store.ErrNotFound) {
			return err
		}
	}
	sdks, err := r.db.ListSdks(ctx)
	if err != nil {
		return err
	}
	if len(sdks) > 0 && sdks[0].IsDefault {
		o.GoRoot = sdks[0].Goroot
	}
	return nil
}

// Get devolve um projeto aberto.
func (r *Registry) Get(projectID string) (*Open, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	o, ok := r.open[projectID]
	if !ok {
		return nil, ErrNotOpen
	}
	return o, nil
}

// RequireTrusted devolve o projeto só se ele for confiável.
func (r *Registry) RequireTrusted(projectID string) (*Open, error) {
	o, err := r.Get(projectID)
	if err != nil {
		return nil, err
	}
	if !o.Trusted {
		return nil, ErrUntrusted
	}
	return o, nil
}

// SetTrusted atualiza a confiança em memória (o banco é responsabilidade de quem chama).
func (r *Registry) SetTrusted(projectID string, trusted bool) {
	r.mu.Lock()
	if o, ok := r.open[projectID]; ok {
		o.Trusted = trusted
	}
	r.mu.Unlock()
}

// Remove fecha o projeto e dispara os ganchos.
func (r *Registry) Remove(projectID string) {
	r.mu.Lock()
	_, ok := r.open[projectID]
	delete(r.open, projectID)
	hooks := append([]func(string){}, r.onClose...)
	r.mu.Unlock()
	if ok {
		for _, fn := range hooks {
			fn(projectID)
		}
	}
}

// All lista os projetos abertos.
func (r *Registry) All() []*Open {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]*Open, 0, len(r.open))
	for _, o := range r.open {
		out = append(out, o)
	}
	return out
}

// Abs converte um caminho relativo do projeto (com '/') em absoluto, recusando escapes.
func (o *Open) Abs(rel string) (string, error) {
	return SafeJoin(o.RootPath, rel)
}

// Rel converte um caminho absoluto em relativo ao projeto, com '/'.
func (o *Open) Rel(abs string) (string, error) {
	rel, err := filepath.Rel(o.RootPath, abs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", ErrOutsideProject
	}
	if rel == "." {
		return "", nil
	}
	return filepath.ToSlash(rel), nil
}

// GoEnv monta o ambiente para gopls, go build e o programa do usuário:
// o ambiente do processo + GOROOT/bin na frente do PATH + o env do projeto.
func (o *Open) GoEnv(extra map[string]string) []string {
	env := os.Environ()
	set := func(k, v string) {
		prefix := k + "="
		for i, kv := range env {
			if strings.HasPrefix(kv, prefix) {
				env[i] = prefix + v
				return
			}
		}
		env = append(env, prefix+v)
	}
	if o.GoRoot != "" {
		set("GOROOT", o.GoRoot)
		set("PATH", filepath.Join(o.GoRoot, "bin")+string(os.PathListSeparator)+os.Getenv("PATH"))
	}
	for k, v := range o.Project.Env {
		set(k, v)
	}
	for k, v := range extra {
		set(k, v)
	}
	return env
}

// SafeJoin junta root e rel ('/' ou separador do SO) e garante que o resultado fica dentro de root.
func SafeJoin(root, rel string) (string, error) {
	if filepath.IsAbs(rel) || strings.Contains(rel, "\x00") {
		return "", fmt.Errorf("%w: %q", ErrOutsideProject, rel)
	}
	abs := filepath.Join(root, filepath.FromSlash(rel))
	back, err := filepath.Rel(root, abs)
	if err != nil || back == ".." || strings.HasPrefix(back, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%w: %q", ErrOutsideProject, rel)
	}
	return abs, nil
}

func exists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}
