package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"prumo/internal/agent"
	"prumo/internal/forge"
	"prumo/internal/gitx"
	"prumo/internal/run"
)

// ---------------------------------------------------------------- GitLab (merge requests)

// GitLab: merge requests do projeto no GitLab (listar, abrir, ver o diff, fazer checkout, criar e comentar)
// e as contas do GitLab cadastradas na IDE.
type GitLab struct{ c *Core }

// GitLabContext diz se o projeto está no GitLab e com que conta a IDE fala com ele.
type GitLabContext struct {
	Remote        string         `json:"remote"`    // nome do remoto (origin)
	RemoteURL     string         `json:"remoteUrl"` // como está no .git/config
	Host          string         `json:"host"`
	Path          string         `json:"path"` // grupo/projeto
	IsGitLab      bool           `json:"isGitLab"`
	Server        string         `json:"server"`
	AuthSource    string         `json:"authSource"` // account | glab | env | "" (sem token)
	User          *forge.User    `json:"user"`
	Project       *forge.Project `json:"project"`
	CurrentBranch string         `json:"currentBranch"`
	Template      string         `json:"template"` // .gitlab/merge_request_templates/Default.md
	Error         string         `json:"error"`    // problema ao falar com o servidor (token recusado, sem rede...)
}

// conn é o que as chamadas precisam: o remoto, o projeto no servidor e o cliente com o token.
type conn struct {
	remote gitx.Remote
	path   string
	client *forge.Client
	auth   forge.Auth
}

func (g *GitLab) connect(ctx context.Context, projectID string) (conn, error) {
	rm, err := g.c.Git.MainRemote(projectID)
	if err != nil {
		return conn{}, err
	}
	r, ok := forge.ParseRemote(rm.URL)
	if !ok {
		return conn{}, fmt.Errorf("o remoto %s (%s) não aponta para um servidor", rm.Name, rm.URL)
	}
	auth, err := g.c.Forge.For(ctx, r)
	if err != nil {
		return conn{}, err
	}
	if auth.Token == "" {
		return conn{}, fmt.Errorf("nenhuma conta do GitLab para %s: cadastre um token em Configurações → Controle de versão", r.Host)
	}
	return conn{remote: rm, path: r.Path, client: forge.NewClient(auth.Server, auth.Token), auth: auth}, nil
}

// Context lê o remoto, a conta e o projeto no servidor. Problemas de servidor vêm em Error (a janela mostra
// o que fazer); só falha de verdade quando o projeto não existe.
func (g *GitLab) Context(projectID string) (GitLabContext, error) {
	ctx := context.Background()
	out := GitLabContext{}
	out.CurrentBranch, _ = g.c.Git.CurrentBranch(projectID)
	rm, err := g.c.Git.MainRemote(projectID)
	if err != nil { // sem git ou sem remoto: a janela explica
		out.Error = err.Error()
		return out, nil
	}
	out.Remote, out.RemoteURL = rm.Name, rm.URL
	r, ok := forge.ParseRemote(rm.URL)
	if !ok {
		return out, nil
	}
	out.Host, out.Path = r.HostKey(), r.Path
	auth, err := g.c.Forge.For(ctx, r)
	if err != nil {
		out.Error = err.Error()
		return out, nil
	}
	out.IsGitLab = forge.LooksLikeGitLab(r.Host, auth)
	out.Server, out.AuthSource = auth.Server, auth.Source
	out.Template = g.template(projectID)
	if !out.IsGitLab || auth.Token == "" {
		return out, nil
	}
	cl := forge.NewClient(auth.Server, auth.Token)
	u, err := cl.User(ctx)
	if err != nil {
		out.Error = err.Error()
		return out, nil
	}
	out.User = &u
	p, err := cl.Project(ctx, r.Path)
	if err != nil {
		out.Error = err.Error()
		return out, nil
	}
	out.Project = &p
	return out, nil
}

// template é o modelo de descrição do repositório (.gitlab/merge_request_templates/Default.md), se houver.
func (g *GitLab) template(projectID string) string {
	o, err := g.c.Reg.Get(projectID)
	if err != nil {
		return ""
	}
	b, err := os.ReadFile(filepath.Join(o.RootPath, ".gitlab", "merge_request_templates", "Default.md"))
	if err != nil || len(b) > 64<<10 {
		return ""
	}
	return string(b)
}

// List lista os merge requests do projeto.
func (g *GitLab) List(projectID string, f forge.ListFilter) ([]forge.MergeRequest, error) {
	ctx := context.Background()
	cn, err := g.connect(ctx, projectID)
	if err != nil {
		return nil, err
	}
	var me forge.User
	if f.Scope != "" && f.Scope != "all" {
		if me, err = cn.client.User(ctx); err != nil {
			return nil, err
		}
	}
	return cn.client.ListMergeRequests(ctx, cn.path, f, me)
}

// Get abre um merge request: descrição, CI, aprovações e comentários.
func (g *GitLab) Get(projectID string, iid int) (forge.MergeRequestDetail, error) {
	ctx := context.Background()
	cn, err := g.connect(ctx, projectID)
	if err != nil {
		return forge.MergeRequestDetail{}, err
	}
	return cn.client.MergeRequest(ctx, cn.path, iid)
}

// MRFiles são os arquivos do merge request e as duas revisões locais para abrir o diff de cada um.
type MRFiles struct {
	Base  string            `json:"base"`
	Head  string            `json:"head"`
	Files []gitx.CommitFile `json:"files"`
}

// Files busca o merge request no repositório local (git fetch) e lista os arquivos que ele muda.
func (g *GitLab) Files(projectID string, iid int) (MRFiles, error) {
	ctx := context.Background()
	cn, err := g.connect(ctx, projectID)
	if err != nil {
		return MRFiles{}, err
	}
	d, err := cn.client.MergeRequest(ctx, cn.path, iid)
	if err != nil {
		return MRFiles{}, err
	}
	head, err := g.c.Git.FetchMergeRequest(projectID, cn.remote.Name, iid, d.TargetBranch)
	if err != nil {
		return MRFiles{}, err
	}
	if d.HeadSHA != "" && g.c.Git.HasCommit(projectID, d.HeadSHA) {
		head = d.HeadSHA
	}
	// A base do diff é a do GitLab (o ponto onde a branch saiu do destino); se ela não veio no fetch, o
	// ancestral comum com o destino atual dá o mesmo resultado na maioria dos casos.
	base := d.BaseSHA
	if base == "" || !g.c.Git.HasCommit(projectID, base) {
		if base, err = g.c.Git.MergeBase(projectID, cn.remote.Name+"/"+d.TargetBranch, head); err != nil {
			return MRFiles{}, err
		}
	}
	files, err := g.c.Git.RangeFiles(projectID, base, head)
	if err != nil {
		return MRFiles{}, err
	}
	return MRFiles{Base: base, Head: head, Files: files}, nil
}

// PrepareCheckout busca a branch do merge request e devolve a ref para a troca de branch (a UI troca pelo
// mesmo caminho da troca de branch comum, que cuida das mudanças locais).
func (g *GitLab) PrepareCheckout(projectID string, iid int) (string, error) {
	ctx := context.Background()
	cn, err := g.connect(ctx, projectID)
	if err != nil {
		return "", err
	}
	d, err := cn.client.MergeRequest(ctx, cn.path, iid)
	if err != nil {
		return "", err
	}
	same := d.SourceProjectID == 0 || d.SourceProjectID == d.TargetProjectID
	return g.c.Git.PrepareMergeRequestCheckout(projectID, cn.remote.Name, iid, d.SourceBranch, same)
}

// CreateMRRequest é o formulário de novo merge request. Push: enviar a branch atual antes de criar.
type CreateMRRequest struct {
	forge.CreateRequest
	Push bool `json:"push"`
}

// Create abre o merge request da branch atual (enviando-a antes, se pedido).
func (g *GitLab) Create(projectID string, req CreateMRRequest) (forge.MergeRequest, error) {
	ctx := context.Background()
	cn, err := g.connect(ctx, projectID)
	if err != nil {
		return forge.MergeRequest{}, err
	}
	if req.Push {
		out, err := g.c.Git.Outgoing(projectID)
		if err != nil {
			return forge.MergeRequest{}, err
		}
		res, err := g.c.Git.Push(projectID, gitx.PushRequest{Remote: cn.remote.Name, Target: req.SourceBranch, SetUpstream: !out.HasUpstream})
		if err != nil {
			return forge.MergeRequest{}, err
		}
		if res.Rejected {
			return forge.MergeRequest{}, errors.New(res.Message)
		}
	}
	me, err := cn.client.User(ctx)
	if err != nil {
		return forge.MergeRequest{}, err
	}
	return cn.client.CreateMergeRequest(ctx, cn.path, req.CreateRequest, me)
}

// Comment publica um comentário geral no merge request.
func (g *GitLab) Comment(projectID string, iid int, body string) (forge.Note, error) {
	ctx := context.Background()
	cn, err := g.connect(ctx, projectID)
	if err != nil {
		return forge.Note{}, err
	}
	return cn.client.Comment(ctx, cn.path, iid, body)
}

// Members busca pessoas do projeto para revisar.
func (g *GitLab) Members(projectID, query string) ([]forge.User, error) {
	ctx := context.Background()
	cn, err := g.connect(ctx, projectID)
	if err != nil {
		return nil, err
	}
	return cn.client.Members(ctx, cn.path, query)
}

// Accounts lista as contas cadastradas (sem os tokens).
func (g *GitLab) Accounts() ([]forge.AccountInfo, error) { return g.c.Forge.List() }

// SaveAccount confere o token no servidor e guarda a conta.
func (g *GitLab) SaveAccount(server, token string) (forge.AccountInfo, error) {
	return g.c.Forge.Save(context.Background(), server, token)
}

// RemoveAccount apaga a conta do servidor.
func (g *GitLab) RemoveAccount(server string) error { return g.c.Forge.Remove(server) }

// MRSuggestion é o título e a descrição escritos pelo agente de IA.
type MRSuggestion struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Agent       string `json:"agent"`
}

// SuggestDescription pede ao agente de IA (o mesmo das mensagens de commit) o título e a descrição do merge
// request da branch atual para target. Só roda quando o usuário clica; o diff vai para o provedor do agente.
func (g *GitLab) SuggestDescription(projectID, target, uiLang string) (MRSuggestion, error) {
	ctx := context.Background()
	rm, err := g.c.Git.MainRemote(projectID)
	if err != nil {
		return MRSuggestion{}, err
	}
	vals, _ := g.c.DB.GetSettings(ctx, []string{"commit.agent", "commit.agentCommand", "commit.agentLanguage", "commit.agentInstructions"})
	str := func(k, def string) string {
		var v string
		if raw, ok := vals[k]; ok && json.Unmarshal(raw, &v) == nil && v != "" {
			return v
		}
		return def
	}
	cmd, err := agent.Resolve(str("commit.agent", "auto"), str("commit.agentCommand", ""), run.SplitArgs)
	if err != nil {
		return MRSuggestion{}, err
	}
	ref := rm.Name + "/" + target
	if !g.c.Git.HasCommit(projectID, ref) {
		ref = target
	}
	s, err := g.c.Git.BranchSummary(projectID, ref)
	if err != nil {
		return MRSuggestion{}, err
	}
	src, _ := g.c.Git.CurrentBranch(projectID)
	prompt := agent.BuildMergeRequestPrompt(agent.MergeRequestContext{
		Source: src, Target: target, Commits: s.Commits, Stat: s.Stat, Diff: s.Diff, Truncated: s.Truncated, Template: g.template(projectID),
	}, str("commit.agentLanguage", "auto"), uiLang, str("commit.agentInstructions", ""))
	reply, err := g.c.Agent.RunWith(projectID+":mr", cmd, prompt, agent.CleanMarkdown)
	if err != nil {
		return MRSuggestion{}, err
	}
	title, desc := agent.SplitTitle(reply)
	if title == "" {
		return MRSuggestion{}, fmt.Errorf("%s não devolveu um título", cmd.Name)
	}
	return MRSuggestion{Title: strings.TrimSpace(title), Description: desc, Agent: cmd.Name}, nil
}

// CancelSuggest interrompe a geração do título e da descrição.
func (g *GitLab) CancelSuggest(projectID string) { g.c.Agent.Cancel(projectID + ":mr") }
