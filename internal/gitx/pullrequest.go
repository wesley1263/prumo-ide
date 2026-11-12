package gitx

import (
	"context"
	"fmt"
	"path/filepath"
	"strconv"
)

// prRef é onde a IDE guarda o último commit de um pull request do GitHub (fora de refs/heads e refs/remotes,
// para não aparecer como branch).
func prRef(n int) string { return "refs/prumo/pull-requests/" + strconv.Itoa(n) }

// FetchPullRequest traz o último commit do pull request (refs/pull/N/head, que o GitHub publica também para
// forks) e a branch de destino. Devolve a revisão local do pull request.
func (g *Git) FetchPullRequest(projectID, remote string, n int, base string) (string, error) {
	ctx := context.Background()
	top, err := g.repoOf(ctx, projectID, true)
	if err != nil {
		return "", err
	}
	if err := validBranch(ctx, g, top, base); err != nil {
		return "", err
	}
	lock := g.repoLock(top)
	lock.Lock()
	defer lock.Unlock()
	if _, err := g.run(ctx, top, false, "fetch", "--no-tags", "--", remote,
		fmt.Sprintf("+refs/pull/%d/head:%s", n, prRef(n)),
		fmt.Sprintf("+refs/heads/%s:refs/remotes/%s/%s", base, remote, base)); err != nil {
		return "", err
	}
	return prRef(n), nil
}

// PreparePullRequestCheckout deixa a branch do pull request pronta para a troca e devolve a ref para o
// Checkout, como no merge request do GitLab: do mesmo repositório, "<remoto>/<head>"; de um fork, a branch
// local pr/<n>-<head> criada a partir do commit do pull request.
func (g *Git) PreparePullRequestCheckout(projectID, remote string, n int, head string, sameRepo bool) (string, error) {
	ctx := context.Background()
	top, err := g.repoOf(ctx, projectID, true)
	if err != nil {
		return "", err
	}
	if err := validBranch(ctx, g, top, head); err != nil {
		return "", err
	}
	lock := g.repoLock(top)
	lock.Lock()
	defer lock.Unlock()
	if sameRepo {
		if _, err := g.run(ctx, top, false, "fetch", "--no-tags", "--", remote, fmt.Sprintf("+refs/heads/%s:refs/remotes/%s/%s", head, remote, head)); err != nil {
			return "", err
		}
		return remote + "/" + head, nil
	}
	if _, err := g.run(ctx, top, false, "fetch", "--no-tags", "--", remote, fmt.Sprintf("+refs/pull/%d/head:%s", n, prRef(n))); err != nil {
		return "", err
	}
	local := fmt.Sprintf("pr/%d-%s", n, head)
	if _, err := g.run(ctx, top, true, "rev-parse", "--verify", "--quiet", "refs/heads/"+local); err != nil {
		if _, err := g.run(ctx, top, false, "branch", "--", local, prRef(n)); err != nil {
			return "", err
		}
	}
	return local, nil
}

// RepoPath converte um caminho do projeto no caminho relativo ao topo do repositório (o que o GitHub usa nos
// comentários de revisão). Num monorepo o projeto pode ser uma subpasta.
func (g *Git) RepoPath(projectID, rel string) (string, error) {
	ctx := context.Background()
	o, err := g.reg.Get(projectID)
	if err != nil {
		return "", err
	}
	top, err := g.toplevel(ctx, o)
	if err != nil {
		return "", err
	}
	abs, err := o.Abs(rel)
	if err != nil {
		return "", err
	}
	r, err := filepath.Rel(top, abs)
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(r), nil
}

// ProjectPath faz o contrário: caminho do repositório para caminho do projeto ("" se ficar fora do projeto).
func (g *Git) ProjectPath(projectID, repoRel string) (string, error) {
	ctx := context.Background()
	o, err := g.reg.Get(projectID)
	if err != nil {
		return "", err
	}
	top, err := g.toplevel(ctx, o)
	if err != nil {
		return "", err
	}
	p, ok := projectPath(o, top, repoRel)
	if !ok {
		return "", nil
	}
	return p, nil
}
