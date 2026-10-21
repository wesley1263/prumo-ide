// Package search é a busca do projeto: arquivos por nome (fuzzy), texto nos arquivos e substituição.
//
// A lista de arquivos vem do git (respeita o .gitignore) quando o projeto é confiável; sem confiança,
// ou fora de um repositório, vem de uma varredura da pasta. Busca de símbolos é do gopls e fica no
// frontend (workspace/symbol pela conexão LSP que ele já tem).
package search

import (
	"bytes"
	"context"
	"errors"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"goide/internal/events"
	"goide/internal/files"
	"goide/internal/proc"
	"goide/internal/workspace"
)

// MaxFileBytes: arquivos maiores ficam de fora da busca de texto.
const MaxFileBytes = files.MaxEditableBytes

// MaxMatches: a busca de texto para aqui e marca o resultado como truncado.
const MaxMatches = 10_000

// indexTTL: por quanto tempo a lista de arquivos é reaproveitada entre buscas.
const indexTTL = 2 * time.Second

// skipDirs nunca entram na varredura (sem git).
var skipDirs = map[string]bool{".git": true, ".hg": true, ".svn": true, ".idea": true, "node_modules": true}

// Service é o serviço exposto à UI.
type Service struct {
	reg    *workspace.Registry
	bus    *events.Bus
	files  *files.Files
	gitExe func() string

	mu     sync.Mutex
	index  map[string]*fileIndex // projectID
	runs   map[string]*textRun   // searchID
	latest map[string]string     // projectID → searchID da busca de texto atual
}

type fileIndex struct {
	at    time.Time
	paths []string // relativos, com '/', em ordem
}

// New cria o serviço. gitExe devolve o caminho do git ("" = não instalado).
func New(reg *workspace.Registry, bus *events.Bus, fl *files.Files, gitExe func() string) *Service {
	s := &Service{reg: reg, bus: bus, files: fl, gitExe: gitExe, index: map[string]*fileIndex{}, runs: map[string]*textRun{}, latest: map[string]string{}}
	reg.OnClose(s.forget)
	return s
}

func (s *Service) forget(projectID string) {
	s.mu.Lock()
	delete(s.index, projectID)
	r := s.runs[s.latest[projectID]]
	delete(s.runs, s.latest[projectID])
	delete(s.latest, projectID)
	s.mu.Unlock()
	if r != nil {
		r.cancel()
	}
}

// paths devolve os arquivos do projeto (cache curto: digitar no popup não relista a cada tecla).
func (s *Service) paths(ctx context.Context, o *workspace.Open) ([]string, error) {
	s.mu.Lock()
	ix := s.index[o.ID]
	s.mu.Unlock()
	if ix != nil && time.Since(ix.at) < indexTTL {
		return ix.paths, nil
	}
	var list []string
	var err error
	if o.Trusted {
		list, err = s.gitFiles(ctx, o.RootPath)
	}
	if !o.Trusted || err != nil {
		// Sem confiança o git não roda: a config do repositório pode executar comandos (core.fsmonitor).
		list, err = walkFiles(ctx, o.RootPath)
	}
	if err != nil {
		return nil, err
	}
	sort.Strings(list)
	s.mu.Lock()
	s.index[o.ID] = &fileIndex{at: time.Now(), paths: list}
	s.mu.Unlock()
	return list, nil
}

// gitFiles lista os arquivos versionados e os novos que o .gitignore não exclui.
func (s *Service) gitFiles(ctx context.Context, root string) ([]string, error) {
	exe := s.gitExe()
	if exe == "" {
		return nil, errors.New("git não encontrado")
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, exe, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--deduplicate")
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "LC_ALL=C", "GIT_OPTIONAL_LOCKS=0")
	cmd.SysProcAttr = proc.Attr(false)
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	var list []string
	for _, p := range bytes.Split(out, []byte{0}) {
		if len(p) == 0 {
			continue
		}
		rel := string(p)
		// Apagado no disco mas ainda no index: não é um arquivo para abrir.
		if st, err := os.Lstat(filepath.Join(root, filepath.FromSlash(rel))); err != nil || !st.Mode().IsRegular() {
			continue
		}
		list = append(list, rel)
	}
	return list, nil
}

func walkFiles(ctx context.Context, root string) ([]string, error) {
	var list []string
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // pasta sem permissão: segue
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if d.IsDir() {
			if p != root && skipDirs[d.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if !d.Type().IsRegular() {
			return nil // links simbólicos podem apontar para fora do projeto
		}
		rel, err := filepath.Rel(root, p)
		if err == nil {
			list = append(list, filepath.ToSlash(rel))
		}
		return nil
	})
	return list, err
}

// ---------------------------------------------------------------- arquivos

// FileHit é um arquivo achado pelo nome.
type FileHit struct {
	Path      string `json:"path"`
	Score     int    `json:"score"`
	Positions []int  `json:"positions"` // índices (UTF-16, como no JS) dos caracteres casados em Path
}

// Files acha arquivos pelo nome: "usrsvc" acha user_service.go, "hand/ord" acha handlers/orders.go.
func (s *Service) Files(projectID, query string, limit int) ([]FileHit, error) {
	o, err := s.reg.Get(projectID)
	if err != nil {
		return nil, err
	}
	list, err := s.paths(context.Background(), o)
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	query = strings.TrimSpace(query)
	hits := make([]FileHit, 0, limit)
	for _, p := range list {
		if query == "" {
			hits = append(hits, FileHit{Path: p, Positions: []int{}})
			continue
		}
		if score, pos, ok := matchPath(query, p); ok {
			hits = append(hits, FileHit{Path: p, Score: score, Positions: utf16Positions(p, pos)})
		}
	}
	if query == "" {
		if len(hits) > limit {
			hits = hits[:limit]
		}
		return hits, nil // ordem alfabética
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].Score != hits[j].Score {
			return hits[i].Score > hits[j].Score
		}
		return len(hits[i].Path) < len(hits[j].Path)
	})
	if len(hits) > limit {
		hits = hits[:limit]
	}
	return hits, nil
}
