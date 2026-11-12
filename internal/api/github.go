package api

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"prumo/internal/forge"
	"prumo/internal/gitx"
)

// ---------------------------------------------------------------- GitHub (pull requests)

// GitHub: pull requests do projeto no GitHub, como no VS Code: listas por seção, a visão geral, os arquivos
// e o diff com os comentários de revisão, revisar (aprovar, pedir mudanças, comentar), merge, checkout e criar.
type GitHub struct{ c *Core }

// GitHubContext diz se o projeto está no GitHub e com que conta a IDE fala com ele.
type GitHubContext struct {
	Remote        string             `json:"remote"`
	RemoteURL     string             `json:"remoteUrl"`
	Host          string             `json:"host"`
	Path          string             `json:"path"` // dono/repo
	IsGitHub      bool               `json:"isGitHub"`
	Server        string             `json:"server"`
	AuthSource    string             `json:"authSource"` // account | gh | env | "" (sem token)
	User          *forge.GhUser      `json:"user"`
	Repo          *forge.Repo        `json:"repo"`
	CurrentBranch string             `json:"currentBranch"`
	CurrentPull   *forge.PullRequest `json:"currentPull"` // o pull request aberto da branch atual
	Template      string             `json:"template"`    // .github/pull_request_template.md
	Error         string             `json:"error"`
}

type ghConn struct {
	remote gitx.Remote
	repo   string
	client *forge.GitHubClient
}

func (g *GitHub) connect(ctx context.Context, projectID string) (ghConn, error) {
	rm, err := g.c.Git.MainRemote(projectID)
	if err != nil {
		return ghConn{}, err
	}
	r, ok := forge.ParseRemote(rm.URL)
	if !ok {
		return ghConn{}, fmt.Errorf("o remoto %s (%s) não aponta para um servidor", rm.Name, rm.URL)
	}
	auth, err := g.c.GitHubAccounts.For(ctx, r)
	if err != nil {
		return ghConn{}, err
	}
	if auth.Token == "" {
		return ghConn{}, fmt.Errorf("nenhuma conta do GitHub para %s: cadastre um token em Configurações → Controle de versão ou faça login no gh", r.Host)
	}
	return ghConn{remote: rm, repo: r.Path, client: forge.NewGitHubClient(auth.Server, auth.Token)}, nil
}

// Context lê o remoto, a conta, o repositório e o pull request da branch atual. Problemas de servidor vêm em
// Error (a janela mostra o que fazer).
func (g *GitHub) Context(projectID string) (GitHubContext, error) {
	ctx := context.Background()
	out := GitHubContext{}
	out.CurrentBranch, _ = g.c.Git.CurrentBranch(projectID)
	rm, err := g.c.Git.MainRemote(projectID)
	if err != nil {
		out.Error = err.Error()
		return out, nil
	}
	out.Remote, out.RemoteURL = rm.Name, rm.URL
	r, ok := forge.ParseRemote(rm.URL)
	if !ok {
		return out, nil
	}
	out.Host, out.Path = r.HostKey(), r.Path
	auth, err := g.c.GitHubAccounts.For(ctx, r)
	if err != nil {
		out.Error = err.Error()
		return out, nil
	}
	out.IsGitHub = forge.LooksLikeGitHub(r.Host, auth)
	out.Server, out.AuthSource = auth.Server, auth.Source
	out.Template = g.template(projectID)
	if !out.IsGitHub || auth.Token == "" {
		return out, nil
	}
	cl := forge.NewGitHubClient(auth.Server, auth.Token)
	u, err := cl.User(ctx)
	if err != nil {
		out.Error = err.Error()
		return out, nil
	}
	out.User = &u
	repo, err := cl.Repo(ctx, r.Path)
	if err != nil {
		out.Error = err.Error()
		return out, nil
	}
	out.Repo = &repo
	if out.CurrentBranch != "" && out.CurrentBranch != repo.DefaultBranch {
		out.CurrentPull, _ = cl.PullForBranch(ctx, repo.FullName, out.CurrentBranch)
	}
	return out, nil
}

// template é o modelo de descrição do repositório, nos lugares que o GitHub procura.
func (g *GitHub) template(projectID string) string {
	o, err := g.c.Reg.Get(projectID)
	if err != nil {
		return ""
	}
	for _, rel := range []string{
		".github/pull_request_template.md", ".github/PULL_REQUEST_TEMPLATE.md",
		"pull_request_template.md", "PULL_REQUEST_TEMPLATE.md",
		"docs/pull_request_template.md", "docs/PULL_REQUEST_TEMPLATE.md",
	} {
		if b, err := os.ReadFile(filepath.Join(o.RootPath, filepath.FromSlash(rel))); err == nil && len(b) <= 64<<10 {
			return string(b)
		}
	}
	return ""
}

// List lista os pull requests de uma seção.
func (g *GitHub) List(projectID string, q forge.PullQuery) ([]forge.PullRequest, error) {
	ctx := context.Background()
	cn, err := g.connect(ctx, projectID)
	if err != nil {
		return nil, err
	}
	return cn.client.ListPulls(ctx, cn.repo, q)
}

// Get abre um pull request: descrição, checks, revisões, linha do tempo e comentários no código. Os caminhos
// dos comentários viram caminhos do projeto (num monorepo o projeto é uma subpasta); os de fora ficam com "".
func (g *GitHub) Get(projectID string, n int) (forge.PullDetail, error) {
	ctx := context.Background()
	cn, err := g.connect(ctx, projectID)
	if err != nil {
		return forge.PullDetail{}, err
	}
	d, err := cn.client.Pull(ctx, cn.repo, n)
	if err != nil {
		return forge.PullDetail{}, err
	}
	for i, rc := range d.ReviewComments {
		p, _ := g.c.Git.ProjectPath(projectID, rc.Path)
		d.ReviewComments[i].Path = p
	}
	return d, nil
}

// PullFiles são os arquivos do pull request e as duas revisões locais para abrir o diff de cada um.
type PullFiles struct {
	Base  string            `json:"base"`
	Head  string            `json:"head"`
	Files []gitx.CommitFile `json:"files"`
}

// Files busca o pull request no repositório local (git fetch) e lista os arquivos que ele muda, contra o
// ancestral comum com o destino (o mesmo diff que o GitHub mostra).
func (g *GitHub) Files(projectID string, n int) (PullFiles, error) {
	ctx := context.Background()
	cn, err := g.connect(ctx, projectID)
	if err != nil {
		return PullFiles{}, err
	}
	d, err := cn.client.Pull(ctx, cn.repo, n)
	if err != nil {
		return PullFiles{}, err
	}
	head, err := g.c.Git.FetchPullRequest(projectID, cn.remote.Name, n, d.Base)
	if err != nil {
		return PullFiles{}, err
	}
	if d.HeadSHA != "" && g.c.Git.HasCommit(projectID, d.HeadSHA) {
		head = d.HeadSHA
	}
	base, err := g.c.Git.MergeBase(projectID, cn.remote.Name+"/"+d.Base, head)
	if err != nil {
		return PullFiles{}, err
	}
	files, err := g.c.Git.RangeFiles(projectID, base, head)
	if err != nil {
		return PullFiles{}, err
	}
	return PullFiles{Base: base, Head: head, Files: files}, nil
}

// PrepareCheckout busca a branch do pull request e devolve a ref para a troca de branch.
func (g *GitHub) PrepareCheckout(projectID string, n int) (string, error) {
	ctx := context.Background()
	cn, err := g.connect(ctx, projectID)
	if err != nil {
		return "", err
	}
	d, err := cn.client.Pull(ctx, cn.repo, n)
	if err != nil {
		return "", err
	}
	return g.c.Git.PreparePullRequestCheckout(projectID, cn.remote.Name, n, d.Head, d.SameRepo)
}

// CreatePRRequest é o formulário de novo pull request. Push: enviar a branch atual antes de criar.
type CreatePRRequest struct {
	forge.CreatePullRequest
	Push bool `json:"push"`
}

// Create abre o pull request da branch atual (enviando-a antes, se pedido).
func (g *GitHub) Create(projectID string, req CreatePRRequest) (forge.PullRequest, error) {
	ctx := context.Background()
	cn, err := g.connect(ctx, projectID)
	if err != nil {
		return forge.PullRequest{}, err
	}
	if req.Push {
		out, err := g.c.Git.Outgoing(projectID)
		if err != nil {
			return forge.PullRequest{}, err
		}
		res, err := g.c.Git.Push(projectID, gitx.PushRequest{Remote: cn.remote.Name, Target: req.Head, SetUpstream: !out.HasUpstream})
		if err != nil {
			return forge.PullRequest{}, err
		}
		if res.Rejected {
			return forge.PullRequest{}, errors.New(res.Message)
		}
	}
	var me forge.GhUser
	if req.AssignToMe {
		if me, err = cn.client.User(ctx); err != nil {
			return forge.PullRequest{}, err
		}
	}
	return cn.client.CreatePull(ctx, cn.repo, req.CreatePullRequest, me)
}

// Comment publica um comentário geral na conversa.
func (g *GitHub) Comment(projectID string, n int, body string) error {
	ctx := context.Background()
	cn, err := g.connect(ctx, projectID)
	if err != nil {
		return err
	}
	return cn.client.Comment(ctx, cn.repo, n, body)
}

// repoDraft converte o caminho do projeto do comentário no caminho do repositório.
func (g *GitHub) repoDraft(projectID string, d forge.DraftComment) (forge.DraftComment, error) {
	p, err := g.c.Git.RepoPath(projectID, d.Path)
	if err != nil {
		return d, err
	}
	d.Path = p
	return d, nil
}

// Review envia a revisão (aprovar, pedir mudanças ou comentar) com os comentários pendentes no código.
// commit é o último commit que a pessoa viu.
func (g *GitHub) Review(projectID string, n int, commit string, r forge.ReviewRequest) error {
	ctx := context.Background()
	cn, err := g.connect(ctx, projectID)
	if err != nil {
		return err
	}
	for i, d := range r.Comments {
		if r.Comments[i], err = g.repoDraft(projectID, d); err != nil {
			return err
		}
	}
	return cn.client.SubmitReview(ctx, cn.repo, n, commit, r)
}

// AddComment publica um comentário avulso numa linha do diff (sem revisão pendente).
func (g *GitHub) AddComment(projectID string, n int, commit string, d forge.DraftComment) error {
	ctx := context.Background()
	cn, err := g.connect(ctx, projectID)
	if err != nil {
		return err
	}
	if d, err = g.repoDraft(projectID, d); err != nil {
		return err
	}
	_, err = cn.client.AddReviewComment(ctx, cn.repo, n, commit, d)
	return err
}

// Reply responde a uma conversa no código.
func (g *GitHub) Reply(projectID string, n int, to int64, body string) error {
	ctx := context.Background()
	cn, err := g.connect(ctx, projectID)
	if err != nil {
		return err
	}
	_, err = cn.client.Reply(ctx, cn.repo, n, to, body)
	return err
}

// Merge junta o pull request (merge, squash ou rebase). sha: o último commit que a pessoa viu.
func (g *GitHub) Merge(projectID string, n int, method, sha string) error {
	ctx := context.Background()
	cn, err := g.connect(ctx, projectID)
	if err != nil {
		return err
	}
	return cn.client.Merge(ctx, cn.repo, n, method, sha)
}

// Assignable busca pessoas para revisar.
func (g *GitHub) Assignable(projectID, query string) ([]forge.GhUser, error) {
	ctx := context.Background()
	cn, err := g.connect(ctx, projectID)
	if err != nil {
		return nil, err
	}
	return cn.client.Assignable(ctx, cn.repo, query)
}

// Accounts lista as contas do GitHub cadastradas (sem os tokens).
func (g *GitHub) Accounts() ([]forge.AccountInfo, error) { return g.c.GitHubAccounts.List() }

// SaveAccount confere o token no servidor e guarda a conta.
func (g *GitHub) SaveAccount(server, token string) (forge.AccountInfo, error) {
	return g.c.GitHubAccounts.Save(context.Background(), server, token)
}

// RemoveAccount apaga a conta do servidor.
func (g *GitHub) RemoveAccount(server string) error { return g.c.GitHubAccounts.Remove(server) }

// SuggestDescription pede ao agente de IA o título e a descrição do pull request da branch atual para base.
func (g *GitHub) SuggestDescription(projectID, base, uiLang string) (MRSuggestion, error) {
	return suggestDescription(g.c, projectID, base, uiLang, g.template(projectID), projectID+":pr")
}

// CancelSuggest interrompe a geração do título e da descrição.
func (g *GitHub) CancelSuggest(projectID string) { g.c.Agent.Cancel(projectID + ":pr") }
