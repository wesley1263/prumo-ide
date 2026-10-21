package gitx

import (
	"context"
	"errors"
	"regexp"
	"strconv"
	"strings"
)

// ---------------------------------------------------------------- stash

// StashEntry é um item da pilha de stash.
type StashEntry struct {
	Index   int    `json:"index"` // stash@{N}
	Message string `json:"message"`
	Branch  string `json:"branch"` // onde foi guardado
	Date    int64  `json:"date"`   // Unix ms
	Files   int    `json:"files"`
}

var stashSubject = regexp.MustCompile(`^(?:WIP on|On) ([^:]+): (.*)$`)

// StashList devolve a pilha, o mais recente primeiro.
func (g *Git) StashList(projectID string) ([]StashEntry, error) {
	ctx := context.Background()
	top, err := g.repoOf(ctx, projectID, false)
	if err != nil {
		return nil, err
	}
	out, err := g.run(ctx, top, true, "stash", "list", "-z", "--format=%gd%x00%ct%x00%gs")
	if err != nil {
		return nil, err
	}
	list := []StashEntry{}
	f := strings.Split(strings.TrimRight(string(out), "\x00"), "\x00")
	for i := 0; i+2 < len(f); i += 3 {
		var e StashEntry
		ref := f[i] // stash@{N}
		if a, b := strings.IndexByte(ref, '{'), strings.IndexByte(ref, '}'); a >= 0 && b > a {
			e.Index, _ = strconv.Atoi(ref[a+1 : b])
		}
		if s, err := strconv.ParseInt(f[i+1], 10, 64); err == nil {
			e.Date = s * 1000
		}
		e.Message = f[i+2]
		if m := stashSubject.FindStringSubmatch(e.Message); m != nil {
			e.Branch, e.Message = m[1], m[2]
		}
		if names, err := g.run(ctx, top, true, "stash", "show", "--name-only", "--include-untracked", "stash@{"+strconv.Itoa(e.Index)+"}"); err == nil {
			e.Files = len(strings.Fields(string(names)))
		}
		list = append(list, e)
	}
	return list, nil
}

// StashSave guarda as mudanças (e, se pedido, os arquivos novos) e limpa a árvore de trabalho.
func (g *Git) StashSave(projectID, message string, untracked bool) error {
	ctx := context.Background()
	top, err := g.repoOf(ctx, projectID, true)
	if err != nil {
		return err
	}
	lock := g.repoLock(top)
	lock.Lock()
	defer lock.Unlock()
	defer g.changed(projectID)
	args := []string{"stash", "push"}
	if untracked {
		args = append(args, "--include-untracked")
	}
	if m := strings.TrimSpace(message); m != "" {
		args = append(args, "-m", m)
	}
	out, err := g.run(ctx, top, false, args...)
	if err != nil {
		return err
	}
	if strings.Contains(string(out), "No local changes to save") {
		return errors.New("não há mudanças para guardar")
	}
	return nil
}

// StashApply aplica um stash; pop também tira ele da pilha (se aplicar sem conflito).
func (g *Git) StashApply(projectID string, index int, pop bool) (OpResult, error) {
	ctx := context.Background()
	top, err := g.repoOf(ctx, projectID, true)
	if err != nil {
		return OpResult{}, err
	}
	lock := g.repoLock(top)
	lock.Lock()
	defer lock.Unlock()
	defer g.changed(projectID)
	verb := "apply"
	if pop {
		verb = "pop"
	}
	_, err = g.run(ctx, top, false, "stash", verb, "--index", "stash@{"+strconv.Itoa(index)+"}")
	if err != nil {
		var ge *gitError
		if errors.As(err, &ge) && strings.Contains(ge.stderr, "CONFLICT") {
			out, _ := g.run(ctx, top, true, "diff", "--name-only", "--diff-filter=U")
			return OpResult{Conflicts: strings.Fields(string(out)), Message: "o stash conflitou com as mudanças atuais (ele continua na pilha)"}, nil
		}
		if errors.As(err, &ge) && (strings.Contains(ge.stderr, "would be overwritten") || strings.Contains(ge.stderr, "already exists")) {
			return OpResult{Message: "há mudanças locais nos mesmos arquivos: guarde ou commite antes de aplicar"}, nil
		}
		return OpResult{}, err
	}
	return OpResult{OK: true, Message: map[bool]string{true: "Stash aplicado e removido da pilha.", false: "Stash aplicado."}[pop]}, nil
}

// StashDrop apaga um stash da pilha.
func (g *Git) StashDrop(projectID string, index int) error {
	ctx := context.Background()
	top, err := g.repoOf(ctx, projectID, true)
	if err != nil {
		return err
	}
	lock := g.repoLock(top)
	lock.Lock()
	defer lock.Unlock()
	defer g.changed(projectID)
	_, err = g.run(ctx, top, false, "stash", "drop", "stash@{"+strconv.Itoa(index)+"}")
	return err
}
