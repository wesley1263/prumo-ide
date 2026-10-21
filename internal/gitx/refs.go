package gitx

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Tags e worktrees (S24/S23): criar e apagar tags pelo Log; listar, criar e remover worktrees.

// CreateTag cria uma tag no commit. Com mensagem, anotada; sem, leve.
func (g *Git) CreateTag(projectID, name, hash, message string) error {
	ctx := context.Background()
	if err := validRev(hash); err != nil {
		return err
	}
	top, err := g.repoOf(ctx, projectID, true)
	if err != nil {
		return err
	}
	if strings.HasPrefix(name, "-") {
		return fmt.Errorf("nome de tag inválido: %q", name)
	}
	if _, err := g.run(ctx, top, true, "check-ref-format", "refs/tags/"+name); err != nil {
		return fmt.Errorf("nome de tag inválido: %q", name)
	}
	if _, err := g.run(ctx, top, true, "rev-parse", "--verify", "--quiet", "refs/tags/"+name); err == nil {
		return fmt.Errorf("a tag %s já existe", name)
	}
	lock := g.repoLock(top)
	lock.Lock()
	defer lock.Unlock()
	defer g.changed(projectID)
	args := []string{"tag", name, hash}
	if strings.TrimSpace(message) != "" {
		args = []string{"tag", "-a", "-m", message, name, hash}
	}
	_, err = g.run(ctx, top, false, args...)
	return err
}

// DeleteTag apaga a tag local (a do remoto fica).
func (g *Git) DeleteTag(projectID, name string) error {
	ctx := context.Background()
	top, err := g.repoOf(ctx, projectID, true)
	if err != nil {
		return err
	}
	if strings.HasPrefix(name, "-") {
		return fmt.Errorf("nome de tag inválido: %q", name)
	}
	lock := g.repoLock(top)
	lock.Lock()
	defer lock.Unlock()
	defer g.changed(projectID)
	_, err = g.run(ctx, top, false, "tag", "-d", "--", name)
	return err
}

// Worktree é uma cópia de trabalho do mesmo repositório.
type Worktree struct {
	Path    string `json:"path"`
	Branch  string `json:"branch"` // "" = HEAD solto
	Head    string `json:"head"`
	Current bool   `json:"current"` // é a do projeto aberto
	Main    bool   `json:"main"`
}

// Worktrees lista as cópias de trabalho do repositório.
func (g *Git) Worktrees(projectID string) ([]Worktree, error) {
	ctx := context.Background()
	top, err := g.repoOf(ctx, projectID, false)
	if err != nil {
		return nil, err
	}
	out, err := g.run(ctx, top, true, "worktree", "list", "--porcelain")
	if err != nil {
		return nil, err
	}
	list := []Worktree{}
	for i, block := range strings.Split(strings.TrimSpace(string(out)), "\n\n") {
		w := Worktree{Main: i == 0}
		for _, l := range strings.Split(block, "\n") {
			switch {
			case strings.HasPrefix(l, "worktree "):
				w.Path = strings.TrimPrefix(l, "worktree ")
			case strings.HasPrefix(l, "HEAD "):
				w.Head = strings.TrimPrefix(l, "HEAD ")
			case strings.HasPrefix(l, "branch "):
				w.Branch = strings.TrimPrefix(strings.TrimPrefix(l, "branch "), "refs/heads/")
			}
		}
		if w.Path == "" {
			continue
		}
		if real, err := filepath.EvalSymlinks(w.Path); err == nil {
			w.Current = real == top
		}
		list = append(list, w)
	}
	return list, nil
}

// AddWorktree cria uma cópia de trabalho em path com a branch (newBranch: cria a branch a partir do HEAD).
func (g *Git) AddWorktree(projectID, path, branch string, newBranch bool) (Worktree, error) {
	ctx := context.Background()
	top, err := g.repoOf(ctx, projectID, true)
	if err != nil {
		return Worktree{}, err
	}
	path = expandHome(strings.TrimSpace(path))
	if !filepath.IsAbs(path) {
		return Worktree{}, errors.New("a pasta do worktree precisa ser um caminho absoluto")
	}
	if entries, err := os.ReadDir(path); err == nil && len(entries) > 0 {
		return Worktree{}, fmt.Errorf("a pasta %s já existe e não está vazia", path)
	}
	if _, err := g.run(ctx, top, true, "check-ref-format", "--branch", branch); err != nil || strings.HasPrefix(branch, "-") {
		return Worktree{}, fmt.Errorf("nome de branch inválido: %q", branch)
	}
	lock := g.repoLock(top)
	lock.Lock()
	defer lock.Unlock()
	defer g.changed(projectID)
	args := []string{"worktree", "add", "--", path, branch}
	if newBranch {
		args = []string{"worktree", "add", "-b", branch, "--", path}
	}
	if _, err := g.run(ctx, top, false, args...); err != nil {
		var ge *gitError
		if errors.As(err, &ge) && strings.Contains(ge.stderr, "already checked out") || errors.As(err, &ge) && strings.Contains(ge.stderr, "is already used by worktree") {
			return Worktree{}, fmt.Errorf("a branch %s já está aberta em outro worktree", branch)
		}
		return Worktree{}, err
	}
	abs := path
	if real, err := filepath.EvalSymlinks(path); err == nil {
		abs = real
	}
	return Worktree{Path: abs, Branch: branch}, nil
}

// RemoveWorktree tira a cópia de trabalho (com mudanças não commitadas, só com force).
func (g *Git) RemoveWorktree(projectID, path string, force bool) error {
	ctx := context.Background()
	top, err := g.repoOf(ctx, projectID, true)
	if err != nil {
		return err
	}
	list, err := g.Worktrees(projectID)
	if err != nil {
		return err
	}
	var target *Worktree
	for i := range list {
		if list[i].Path == path {
			target = &list[i]
		}
	}
	if target == nil {
		return errors.New("worktree não encontrado")
	}
	if target.Main || target.Current {
		return errors.New("não dá para remover o worktree principal nem o do projeto aberto")
	}
	lock := g.repoLock(top)
	lock.Lock()
	defer lock.Unlock()
	defer g.changed(projectID)
	args := []string{"worktree", "remove"}
	if force {
		args = append(args, "--force")
	}
	if _, err := g.run(ctx, top, false, append(args, "--", path)...); err != nil {
		var ge *gitError
		if errors.As(err, &ge) && strings.Contains(ge.stderr, "contains modified or untracked files") {
			return errors.New("o worktree tem mudanças não commitadas")
		}
		return err
	}
	return nil
}
