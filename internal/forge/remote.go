// Package forge fala com o servidor onde o repositório mora (por enquanto, o GitLab): merge requests,
// contas e a ligação entre o remoto do git e o projeto no servidor.
//
// O token nunca sai para outro servidor: ele é escolhido pelo host do remoto e só vai para a URL da
// conta daquele host (ou para https://<host> quando vem do glab).
package forge

import (
	"net/url"
	"strings"
)

// Remote é o remoto do git decomposto: o host (sem porta de SSH) e o caminho do projeto ("grupo/sub/projeto").
type Remote struct {
	Host string `json:"host"`
	Port string `json:"port"` // porta do http(s), quando a URL tem; a do SSH não serve para a API
	Path string `json:"path"`
}

// ParseRemote entende as formas de URL do git: https://host/grupo/proj.git, ssh://git@host:2222/grupo/proj.git
// e git@host:grupo/proj.git. Devolve false para caminhos locais e URLs sem projeto.
func ParseRemote(raw string) (Remote, bool) {
	raw = strings.TrimSpace(raw)
	var r Remote
	if strings.Contains(raw, "://") {
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" {
			return Remote{}, false
		}
		switch u.Scheme {
		case "http", "https":
			r.Port = u.Port()
		case "ssh", "git", "git+ssh", "ssh+git":
		default:
			return Remote{}, false
		}
		r.Host = strings.ToLower(u.Hostname())
		r.Path = u.Path
	} else {
		// scp: [user@]host:caminho (sem barra antes dos dois-pontos, para não confundir com caminho local).
		colon := strings.Index(raw, ":")
		if colon <= 1 || strings.Contains(raw[:colon], "/") { // colon 1 = "C:/..." no Windows

			return Remote{}, false
		}
		host := raw[:colon]
		if at := strings.LastIndex(host, "@"); at >= 0 {
			host = host[at+1:]
		}
		r.Host = strings.ToLower(host)
		r.Path = raw[colon+1:]
	}
	r.Path = strings.Trim(strings.TrimSuffix(strings.Trim(r.Path, "/"), ".git"), "/")
	if r.Host == "" || !strings.Contains(r.Path, "/") {
		return Remote{}, false
	}
	return r, true
}

// HostKey é como o host aparece na conta: com a porta do http, se houver.
func (r Remote) HostKey() string {
	if r.Port != "" {
		return r.Host + ":" + r.Port
	}
	return r.Host
}

// normServer limpa a URL do servidor digitada pelo usuário: esquema, sem barra no fim, sem /api/v4.
func normServer(s string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", errInvalidServer
	}
	if !strings.Contains(s, "://") {
		s = "https://" + s
	}
	u, err := url.Parse(s)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.RawQuery != "" {
		return "", errInvalidServer
	}
	p := strings.TrimSuffix(strings.TrimRight(u.Path, "/"), "/api/v4")
	return strings.ToLower(u.Scheme+"://"+u.Host) + strings.TrimRight(p, "/"), nil
}

// serverHost é o host:porta (porta só se a URL tiver) de uma URL de servidor já normalizada.
func serverHost(server string) string {
	u, err := url.Parse(server)
	if err != nil {
		return ""
	}
	return strings.ToLower(u.Host)
}
