package gitx

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// Remote é um remoto do repositório e a URL como está na configuração (sem as trocas de insteadOf).
type Remote struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// MainRemote devolve o remoto que a IDE usa para merge requests: origin, ou o primeiro que houver.
func (g *Git) MainRemote(projectID string) (Remote, error) {
	ctx := context.Background()
	top, err := g.repoOf(ctx, projectID, false)
	if err != nil {
		return Remote{}, err
	}
	out, err := g.run(ctx, top, true, "remote")
	if err != nil {
		return Remote{}, err
	}
	names := strings.Fields(string(out))
	if len(names) == 0 {
		return Remote{}, errors.New("o repositório não tem remoto")
	}
	name := names[0]
	for _, n := range names {
		if n == "origin" {
			name = n
		}
	}
	u, err := g.run(ctx, top, true, "config", "--get", "remote."+name+".url")
	if err != nil {
		return Remote{}, fmt.Errorf("o remoto %s não tem URL", name)
	}
	return Remote{Name: name, URL: strings.TrimSpace(string(u))}, nil
}

// CurrentBranch é a branch atual ("" com HEAD solto).
func (g *Git) CurrentBranch(projectID string) (string, error) {
	ctx := context.Background()
	top, err := g.repoOf(ctx, projectID, false)
	if err != nil {
		return "", err
	}
	out, err := g.run(ctx, top, true, "symbolic-ref", "--short", "-q", "HEAD")
	if err != nil {
		return "", nil
	}
	return strings.TrimSpace(string(out)), nil
}

// mrRef é onde a IDE guarda o último commit de um merge request (fora de refs/heads e refs/remotes,
// para não aparecer como branch).
func mrRef(iid int) string { return "refs/prumo/merge-requests/" + strconv.Itoa(iid) }

func validBranch(ctx context.Context, g *Git, top, name string) error {
	if _, err := g.run(ctx, top, true, "check-ref-format", "--branch", name); err != nil || strings.HasPrefix(name, "-") {
		return fmt.Errorf("nome de branch inválido: %q", name)
	}
	return nil
}

// FetchMergeRequest traz o último commit do merge request (refs/merge-requests/N/head, que o GitLab publica
// também para forks) e a branch de destino. Devolve a revisão local do merge request.
func (g *Git) FetchMergeRequest(projectID, remote string, iid int, target string) (string, error) {
	ctx := context.Background()
	top, err := g.repoOf(ctx, projectID, true)
	if err != nil {
		return "", err
	}
	if err := validBranch(ctx, g, top, target); err != nil {
		return "", err
	}
	lock := g.repoLock(top)
	lock.Lock()
	defer lock.Unlock()
	if _, err := g.run(ctx, top, false, "fetch", "--no-tags", "--", remote,
		fmt.Sprintf("+refs/merge-requests/%d/head:%s", iid, mrRef(iid)),
		fmt.Sprintf("+refs/heads/%s:refs/remotes/%s/%s", target, remote, target)); err != nil {
		return "", err
	}
	return mrRef(iid), nil
}

// HasCommit diz se a revisão existe no repositório local.
func (g *Git) HasCommit(projectID, rev string) bool {
	ctx := context.Background()
	if validRev(rev) != nil {
		return false
	}
	top, err := g.repoOf(ctx, projectID, false)
	if err != nil {
		return false
	}
	_, err = g.run(ctx, top, true, "rev-parse", "--verify", "--quiet", rev+"^{commit}")
	return err == nil
}

// MergeBase é o ancestral comum de a e b.
func (g *Git) MergeBase(projectID, a, b string) (string, error) {
	ctx := context.Background()
	for _, r := range []string{a, b} {
		if err := validRev(r); err != nil {
			return "", err
		}
	}
	top, err := g.repoOf(ctx, projectID, false)
	if err != nil {
		return "", err
	}
	out, err := g.run(ctx, top, true, "merge-base", a, b)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// RangeFiles lista os arquivos que mudam de base para head (caminhos relativos ao projeto).
func (g *Git) RangeFiles(projectID, base, head string) ([]CommitFile, error) {
	ctx := context.Background()
	for _, r := range []string{base, head} {
		if err := validRev(r); err != nil {
			return nil, err
		}
	}
	o, err := g.reg.Get(projectID)
	if err != nil {
		return nil, err
	}
	top, err := g.toplevel(ctx, o)
	if err != nil {
		return nil, err
	}
	out, err := g.run(ctx, top, true, "diff", "-z", "-M", "--name-status", base, head, "--")
	if err != nil {
		return nil, err
	}
	files := parseNameStatus(out, func(repoRel string) (string, bool) { return projectPath(o, top, repoRel) })
	if files == nil {
		files = []CommitFile{}
	}
	return files, nil
}

// PrepareMergeRequestCheckout deixa a branch do merge request pronta para a troca e devolve a ref para o
// Checkout. Do mesmo projeto: busca a branch de origem e devolve "<remoto>/<origem>" (o Checkout cria a local
// que acompanha a remota, ou troca para a local que já existe). De um fork: cria a branch local
// mr/<n>-<origem> a partir do commit do merge request.
func (g *Git) PrepareMergeRequestCheckout(projectID, remote string, iid int, source string, sameProject bool) (string, error) {
	ctx := context.Background()
	top, err := g.repoOf(ctx, projectID, true)
	if err != nil {
		return "", err
	}
	if err := validBranch(ctx, g, top, source); err != nil {
		return "", err
	}
	if sameProject {
		lock := g.repoLock(top)
		lock.Lock()
		defer lock.Unlock()
		if _, err := g.run(ctx, top, false, "fetch", "--no-tags", "--", remote, fmt.Sprintf("+refs/heads/%s:refs/remotes/%s/%s", source, remote, source)); err != nil {
			return "", err
		}
		return remote + "/" + source, nil
	}
	if _, err := g.fetchMRHead(ctx, top, remote, iid); err != nil {
		return "", err
	}
	local := fmt.Sprintf("mr/%d-%s", iid, source)
	if _, err := g.run(ctx, top, true, "rev-parse", "--verify", "--quiet", "refs/heads/"+local); err != nil {
		if _, err := g.run(ctx, top, false, "branch", "--", local, mrRef(iid)); err != nil {
			return "", err
		}
	}
	return local, nil
}

// fetchMRHead busca só o commit do merge request.
func (g *Git) fetchMRHead(ctx context.Context, top, remote string, iid int) (string, error) {
	lock := g.repoLock(top)
	lock.Lock()
	defer lock.Unlock()
	if _, err := g.run(ctx, top, false, "fetch", "--no-tags", "--", remote, fmt.Sprintf("+refs/merge-requests/%d/head:%s", iid, mrRef(iid))); err != nil {
		return "", err
	}
	return mrRef(iid), nil
}

// BranchSummary é o que vai para o agente de IA escrever o título e a descrição do merge request.
type BranchSummary struct {
	Commits   []string // mensagens completas, da mais antiga para a mais nova
	Stat      string   // git diff --stat
	Diff      string
	Truncated bool
}

const (
	summaryDiffMax    = 60 << 10
	summaryCommitsMax = 100
)

// BranchSummary resume o que a branch atual tem e target (remote/target) não tem.
func (g *Git) BranchSummary(projectID, target string) (BranchSummary, error) {
	ctx := context.Background()
	if err := validRev(target); err != nil {
		return BranchSummary{}, err
	}
	top, err := g.repoOf(ctx, projectID, true)
	if err != nil {
		return BranchSummary{}, err
	}
	var s BranchSummary
	out, err := g.run(ctx, top, true, "log", "--reverse", "-z", "--format=%B", "--max-count="+strconv.Itoa(summaryCommitsMax), target+"..HEAD", "--")
	if err != nil {
		return BranchSummary{}, err
	}
	for _, m := range strings.Split(string(out), "\x00") {
		if m = strings.TrimSpace(m); m != "" {
			s.Commits = append(s.Commits, m)
		}
	}
	if len(s.Commits) == 0 {
		return BranchSummary{}, fmt.Errorf("a branch atual não tem commits que %s não tenha", target)
	}
	if b, err := g.run(ctx, top, true, "diff", "--stat=100", target+"...HEAD", "--"); err == nil {
		s.Stat = string(b)
	}
	if b, err := g.run(ctx, top, true, "diff", "--no-color", "--no-ext-diff", "-M", target+"...HEAD", "--"); err == nil {
		s.Diff = string(b)
		if len(s.Diff) > summaryDiffMax {
			s.Diff, s.Truncated = s.Diff[:summaryDiffMax], true
		}
	}
	return s, nil
}
