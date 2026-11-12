package forge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

var errInvalidServer = errors.New("endereço do servidor inválido: use algo como https://gitlab.com ou https://github.com")

// Account é uma conta (GitLab ou GitHub) cadastrada na IDE: o servidor e o token de acesso pessoal.
type Account struct {
	Server   string `json:"server"`   // https://gitlab.com ou https://github.com (sem /api/v4 ou /api/v3)
	Token    string `json:"token"`    // nunca vai para a UI
	Username string `json:"username"` // de quem é o token (lido ao salvar)
}

// AccountInfo é a conta para a UI, sem o token.
type AccountInfo struct {
	Server   string `json:"server"`
	Username string `json:"username"`
}

// Accounts guarda as contas de um tipo de servidor (GitLab ou GitHub) num arquivo só do usuário (0600) na pasta
// de dados da IDE.
type Accounts struct {
	path string
	mu   sync.Mutex
	kind provider
}

// provider é o que muda entre GitLab e GitHub: como conferir o token, o CLI oficial e a variável
// de ambiente que servem de alternativa à conta cadastrada.
type provider struct {
	source string                                                          // nome da fonte quando o token vem do CLI ("glab", "gh")
	cli    func() string                                                   // onde está o CLI ("" = não instalado). Trocável nos testes
	cliArg func(host string) []string                                      // argumentos para o CLI imprimir o token do host
	env    func(host string) string                                        // token de variável de ambiente para o host ("" = nenhum)
	verify func(ctx context.Context, server, token string) (string, error) // dono do token
}

// NewAccounts abre (ou cria na primeira gravação) o arquivo de contas do GitLab em dir.
func NewAccounts(dir string, glab func() string) *Accounts {
	return &Accounts{path: filepath.Join(dir, "gitlab-accounts.json"), kind: provider{
		source: "glab",
		cli:    glab,
		cliArg: func(host string) []string { return []string{"config", "get", "token", "--host", host} },
		env: func(host string) string {
			if host == "gitlab.com" || strings.EqualFold(os.Getenv("GITLAB_HOST"), host) {
				return os.Getenv("GITLAB_TOKEN")
			}
			return ""
		},
		verify: func(ctx context.Context, server, token string) (string, error) {
			u, err := NewClient(server, token).User(ctx)
			return u.Username, err
		},
	}}
}

// NewGitHubAccounts abre o arquivo de contas do GitHub (github.com ou GitHub Enterprise) em dir. Sem conta,
// o token vem do gh (o CLI do GitHub, "gh auth token") ou de GH_TOKEN/GITHUB_TOKEN para github.com.
func NewGitHubAccounts(dir string, gh func() string) *Accounts {
	return &Accounts{path: filepath.Join(dir, "github-accounts.json"), kind: provider{
		source: "gh",
		cli:    gh,
		cliArg: func(host string) []string { return []string{"auth", "token", "--hostname", host} },
		env: func(host string) string {
			if host == "github.com" {
				for _, k := range []string{"GH_TOKEN", "GITHUB_TOKEN"} {
					if v := os.Getenv(k); v != "" {
						return v
					}
				}
			}
			if v := os.Getenv("GH_ENTERPRISE_TOKEN"); v != "" && strings.EqualFold(os.Getenv("GH_HOST"), host) {
				return v
			}
			return ""
		},
		verify: func(ctx context.Context, server, token string) (string, error) {
			u, err := NewGitHubClient(server, token).User(ctx)
			return u.Login, err
		},
	}}
}

func (a *Accounts) load() ([]Account, error) {
	b, err := os.ReadFile(a.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var list []Account
	if err := json.Unmarshal(b, &list); err != nil {
		return nil, fmt.Errorf("arquivo de contas corrompido (%s): %w", a.path, err)
	}
	return list, nil
}

func (a *Accounts) store(list []Account) error {
	sort.Slice(list, func(i, j int) bool { return list[i].Server < list[j].Server })
	b, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(a.path), 0o700); err != nil {
		return err
	}
	tmp := a.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, a.path)
}

// List devolve as contas sem os tokens.
func (a *Accounts) List() ([]AccountInfo, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	list, err := a.load()
	if err != nil {
		return nil, err
	}
	out := make([]AccountInfo, 0, len(list))
	for _, c := range list {
		out = append(out, AccountInfo{Server: c.Server, Username: c.Username})
	}
	return out, nil
}

// Save confere o token no servidor (GET /user) e grava a conta, trocando a do mesmo servidor.
func (a *Accounts) Save(ctx context.Context, server, token string) (AccountInfo, error) {
	server, err := normServer(server)
	if err != nil {
		return AccountInfo{}, err
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return AccountInfo{}, errors.New("cole o token de acesso pessoal")
	}
	username, err := a.kind.verify(ctx, server, token)
	if err != nil {
		return AccountInfo{}, err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	list, err := a.load()
	if err != nil {
		return AccountInfo{}, err
	}
	out := list[:0]
	for _, c := range list {
		if c.Server != server {
			out = append(out, c)
		}
	}
	out = append(out, Account{Server: server, Token: token, Username: username})
	if err := a.store(out); err != nil {
		return AccountInfo{}, err
	}
	return AccountInfo{Server: server, Username: username}, nil
}

// Remove apaga a conta do servidor.
func (a *Accounts) Remove(server string) error {
	server, err := normServer(server)
	if err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	list, err := a.load()
	if err != nil {
		return err
	}
	out := list[:0]
	for _, c := range list {
		if c.Server != server {
			out = append(out, c)
		}
	}
	return a.store(out)
}

// Auth é como a IDE vai falar com o servidor de um remoto.
type Auth struct {
	Server string // URL base do servidor
	Token  string
	Source string // "account" | "glab" | "gh" | "env" | "" (sem token)
}

// For escolhe servidor e token para o remoto: a conta cadastrada para o host; senão o token do CLI oficial
// (glab ou gh, se estiver logado); senão a variável de ambiente. Sem token, Source fica "".
func (a *Accounts) For(ctx context.Context, r Remote) (Auth, error) {
	a.mu.Lock()
	list, err := a.load()
	a.mu.Unlock()
	if err != nil {
		return Auth{}, err
	}
	// Primeiro o host com a porta do http (https://host:8443), depois só o host (remoto por SSH).
	for _, key := range []string{r.HostKey(), r.Host} {
		for _, c := range list {
			if serverHost(c.Server) == key {
				return Auth{Server: c.Server, Token: c.Token, Source: "account"}, nil
			}
		}
	}
	for _, c := range list {
		if h := serverHost(c.Server); strings.SplitN(h, ":", 2)[0] == r.Host {
			return Auth{Server: c.Server, Token: c.Token, Source: "account"}, nil
		}
	}
	server := "https://" + r.HostKey()
	if tok := a.cliToken(ctx, r.Host); tok != "" {
		return Auth{Server: server, Token: tok, Source: a.kind.source}, nil
	}
	if tok := a.kind.env(r.Host); tok != "" {
		return Auth{Server: server, Token: tok, Source: "env"}, nil
	}
	return Auth{Server: server}, nil
}

// cliToken pede ao CLI oficial o token do host (ele resolve o chaveiro e o arquivo de configuração dele).
func (a *Accounts) cliToken(ctx context.Context, host string) string {
	exe := ""
	if a.kind.cli != nil {
		exe = a.kind.cli()
	}
	if exe == "" {
		return ""
	}
	cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cctx, exe, a.kind.cliArg(host)...)
	cmd.Env = append(os.Environ(), "NO_COLOR=1", "GLAB_NO_PROMPT=1", "GH_PROMPT_DISABLED=1")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// LooksLikeGitLab diz se vale tratar o host como GitLab: gitlab.com, um nome com "gitlab" ou um
// servidor que o usuário cadastrou (GitLab próprio com outro nome).
func LooksLikeGitLab(host string, auth Auth) bool {
	return host == "gitlab.com" || strings.Contains(host, "gitlab") || auth.Source == "account" || auth.Source == "glab"
}

// LooksLikeGitHub é o mesmo para o GitHub: github.com, um nome com "github" (GitHub Enterprise) ou um servidor
// cadastrado.
func LooksLikeGitHub(host string, auth Auth) bool {
	return host == "github.com" || strings.Contains(host, "github") || auth.Source == "account" || auth.Source == "gh"
}
