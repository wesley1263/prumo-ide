package gitx

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Rebase interativo (S24): a lista vem pronta da UI; o git recebe pelo GIT_SEQUENCE_EDITOR (copia o arquivo
// que escrevemos). Reword: a mensagem nova vai num arquivo e um "exec git commit --amend -F" usa depois do pick.
// Nada digitado pelo usuário passa pelo shell: só caminhos que nós criamos, entre aspas simples.

// RebaseStep é uma linha da lista, do commit mais antigo para o mais novo.
type RebaseStep struct {
	Action  string `json:"action"` // pick | reword | edit | squash | fixup | drop
	Hash    string `json:"hash"`
	Message string `json:"message,omitempty"` // reword
}

var rebaseActions = map[string]bool{"pick": true, "reword": true, "edit": true, "squash": true, "fixup": true, "drop": true}

func shQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

// RebaseCommits lista os commits depois de base até o HEAD (do mais antigo para o mais novo), para montar a lista.
func (g *Git) RebaseCommits(projectID, base string) ([]LogCommit, error) {
	ctx := context.Background()
	if err := validRev(base); err != nil {
		return nil, err
	}
	top, err := g.repoOf(ctx, projectID, false)
	if err != nil {
		return nil, err
	}
	out, err := g.run(ctx, top, true, "log", "-z", "--reverse", "--format="+logFormat, "--max-count=200", base+"..HEAD", "--")
	if err != nil {
		return nil, err
	}
	return parseLog(out, map[string]bool{}), nil
}

// InteractiveRebase reescreve os commits depois de base conforme a lista.
func (g *Git) InteractiveRebase(projectID, base string, steps []RebaseStep) (OpResult, error) {
	ctx := context.Background()
	if err := validRev(base); err != nil {
		return OpResult{}, err
	}
	top, err := g.repoOf(ctx, projectID, true)
	if err != nil {
		return OpResult{}, err
	}
	lock := g.repoLock(top)
	lock.Lock()
	defer lock.Unlock()
	defer g.changed(projectID)
	if cur := g.operation(ctx, top); cur != "" {
		return OpResult{Operation: cur, Message: "termine ou cancele o " + cur + " em andamento antes"}, nil
	}
	if out, err := g.run(ctx, top, true, "status", "--porcelain", "--untracked-files=no"); err == nil && strings.TrimSpace(string(out)) != "" {
		return OpResult{Message: "há mudanças não commitadas: commite ou guarde (stash) antes do rebase"}, nil
	}

	// A lista precisa ter exatamente os commits de base..HEAD, cada um uma vez, sem merges.
	out, err := g.run(ctx, top, true, "rev-list", "--reverse", "--parents", base+"..HEAD")
	if err != nil {
		return OpResult{}, err
	}
	want := map[string]bool{}
	for _, l := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		f := strings.Fields(l)
		if len(f) == 0 {
			continue
		}
		if len(f) > 2 {
			return OpResult{Message: "há commits de merge no trecho: o rebase interativo aqui só reescreve histórico linear"}, nil
		}
		want[f[0]] = true
	}
	if len(steps) != len(want) {
		return OpResult{}, fmt.Errorf("a lista tem %d commits, o trecho tem %d", len(steps), len(want))
	}
	seen := map[string]bool{}
	for i, s := range steps {
		if !rebaseActions[s.Action] {
			return OpResult{}, fmt.Errorf("ação desconhecida: %s", s.Action)
		}
		if !want[s.Hash] || seen[s.Hash] {
			return OpResult{}, fmt.Errorf("commit fora do trecho ou repetido: %s", s.Hash)
		}
		seen[s.Hash] = true
		if (s.Action == "squash" || s.Action == "fixup") && firstKept(steps[:i]) < 0 {
			return OpResult{Message: "o primeiro commit mantido não pode ser squash nem fixup: não há onde juntar"}, nil
		}
		if s.Action == "reword" && strings.TrimSpace(s.Message) == "" {
			return OpResult{Message: "reword precisa da mensagem nova"}, nil
		}
	}

	gitDirOut, err := g.run(ctx, top, true, "rev-parse", "--absolute-git-dir")
	if err != nil {
		return OpResult{}, err
	}
	gitDir := strings.TrimSpace(string(gitDirOut))
	if old, _ := filepath.Glob(filepath.Join(gitDir, "goide-rebase-*")); len(old) > 0 {
		for _, d := range old {
			_ = os.RemoveAll(d) // sobra de um rebase anterior que parou e já terminou
		}
	}
	work := filepath.Join(gitDir, "goide-rebase-"+strconv.FormatInt(time.Now().UnixNano(), 36))
	if err := os.MkdirAll(work, 0o700); err != nil {
		return OpResult{}, err
	}
	var todo strings.Builder
	for i, s := range steps {
		if s.Action == "reword" {
			msg := filepath.Join(work, fmt.Sprintf("msg-%d.txt", i))
			if err := os.WriteFile(msg, []byte(strings.TrimSpace(s.Message)+"\n"), 0o600); err != nil {
				return OpResult{}, err
			}
			fmt.Fprintf(&todo, "pick %s\nexec git commit --amend --only --no-verify -F %s\n", s.Hash, shQuote(msg))
			continue
		}
		fmt.Fprintf(&todo, "%s %s\n", s.Action, s.Hash)
	}
	todoPath := filepath.Join(work, "todo")
	if err := os.WriteFile(todoPath, []byte(todo.String()), 0o600); err != nil {
		return OpResult{}, err
	}
	env := []string{"GIT_SEQUENCE_EDITOR=cp " + shQuote(todoPath), "GIT_EDITOR=true"}
	_, err = g.runWith(ctx, top, false, env, nil, "rebase", "-i", base)
	if err != nil {
		var ge *gitError
		if errors.As(err, &ge) && g.operation(ctx, top) == "rebase" {
			out, _ := g.run(ctx, top, true, "diff", "--name-only", "--diff-filter=U")
			if files := strings.Fields(string(out)); len(files) > 0 {
				return OpResult{Conflicts: files, Operation: "rebase", Message: "o rebase parou em conflito"}, nil
			}
			return OpResult{Operation: "rebase", Message: "o rebase parou: " + strings.TrimSpace(ge.stderr)}, nil
		}
		_ = os.RemoveAll(work)
		return OpResult{}, err
	}
	if g.operation(ctx, top) == "rebase" { // "edit": parou para você mexer no commit
		return OpResult{Operation: "rebase", Message: "parado no commit para editar: mude, commite (amend) e continue o rebase"}, nil
	}
	_ = os.RemoveAll(work)
	return OpResult{OK: true, Message: "Rebase interativo concluído."}, nil
}

func firstKept(prev []RebaseStep) int {
	for i, s := range prev {
		if s.Action != "drop" {
			return i
		}
	}
	return -1
}
