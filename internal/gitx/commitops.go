package gitx

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// Ações sobre um commit do Log: cherry-pick, revert e reset do branch atual até ele.

var hashRe = regexp.MustCompile(`^[0-9a-f]{4,64}$`)

// commitOp roda cherry-pick ou revert; conflito vira OpResult com a operação em andamento (a tela de conflitos assume).
func (g *Git) commitOp(projectID, hash, op string) (OpResult, error) {
	if !hashRe.MatchString(hash) {
		return OpResult{}, errors.New("hash inválido")
	}
	ctx := context.Background()
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
	if out, err := g.run(ctx, top, true, "rev-list", "--parents", "-n", "1", hash); err == nil && len(strings.Fields(string(out))) > 2 {
		return OpResult{Message: "é um commit de merge: escolha um commit comum"}, nil
	}
	_, err = g.run(ctx, top, false, "-c", "core.editor=true", op, "--no-edit", hash)
	if err != nil {
		var ge *gitError
		if errors.As(err, &ge) {
			switch {
			case strings.Contains(ge.stderr, "CONFLICT") || strings.Contains(ge.stderr, "could not apply") || strings.Contains(ge.stderr, "could not revert"):
				out, _ := g.run(ctx, top, true, "diff", "--name-only", "--diff-filter=U")
				return OpResult{Conflicts: strings.Fields(string(out)), Operation: op, Message: "o " + op + " parou em conflito"}, nil
			case strings.Contains(ge.stderr, "would be overwritten"):
				return OpResult{Message: "há mudanças locais nos mesmos arquivos: guarde ou commite antes"}, nil
			case strings.Contains(ge.stderr, "nothing to commit") || strings.Contains(ge.stderr, "empty"):
				_, _ = g.run(ctx, top, false, op, "--abort")
				return OpResult{Message: "nada mudou: as mudanças desse commit já estão aqui"}, nil
			}
		}
		return OpResult{}, err
	}
	return OpResult{OK: true, Message: map[string]string{"cherry-pick": "Cherry-pick feito.", "revert": "Revert feito: um commit novo desfaz o escolhido."}[op]}, nil
}

// CherryPick aplica o commit no branch atual.
func (g *Git) CherryPick(projectID, hash string) (OpResult, error) {
	return g.commitOp(projectID, hash, "cherry-pick")
}

// Revert cria um commit que desfaz o escolhido.
func (g *Git) Revert(projectID, hash string) (OpResult, error) {
	return g.commitOp(projectID, hash, "revert")
}

// Reset move o branch atual para o commit. soft: as mudanças ficam preparadas; mixed: ficam no disco;
// hard: descarta tudo (a UI confirma antes).
func (g *Git) Reset(projectID, hash, mode string) (OpResult, error) {
	if !hashRe.MatchString(hash) {
		return OpResult{}, errors.New("hash inválido")
	}
	if mode != "soft" && mode != "mixed" && mode != "hard" {
		return OpResult{}, fmt.Errorf("modo de reset desconhecido: %s", mode)
	}
	ctx := context.Background()
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
	if _, err := g.run(ctx, top, false, "reset", "--"+mode, hash, "--"); err != nil {
		return OpResult{}, err
	}
	return OpResult{OK: true, Message: "Branch movido para " + hash[:min(7, len(hash))] + "."}, nil
}
