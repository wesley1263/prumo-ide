package forge

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseRemote(t *testing.T) {
	cases := []struct {
		in   string
		want Remote
		ok   bool
	}{
		{"git@gitlab.com:grupo/app.git", Remote{Host: "gitlab.com", Path: "grupo/app"}, true},
		{"git@gitlab.com:grupo/sub/app", Remote{Host: "gitlab.com", Path: "grupo/sub/app"}, true},
		{"https://gitlab.com/grupo/app.git", Remote{Host: "gitlab.com", Path: "grupo/app"}, true},
		{"https://user:tok@GitLab.Empresa.com:8443/a/b.git/", Remote{Host: "gitlab.empresa.com", Port: "8443", Path: "a/b"}, true},
		{"ssh://git@gitlab.empresa.com:2222/a/b.git", Remote{Host: "gitlab.empresa.com", Path: "a/b"}, true},
		{"/home/eu/repos/app.git", Remote{}, false},
		{"C:/repos/a/b", Remote{}, false},
		{"file:///tmp/a/b", Remote{}, false},
		{"https://gitlab.com/so-um", Remote{}, false},
	}
	for _, c := range cases {
		got, ok := ParseRemote(c.in)
		if ok != c.ok || got != c.want {
			t.Errorf("ParseRemote(%q) = %+v %v; quero %+v %v", c.in, got, ok, c.want, c.ok)
		}
	}
}

func TestNormServer(t *testing.T) {
	for in, want := range map[string]string{
		"gitlab.com":                     "https://gitlab.com",
		"https://GitLab.com/":            "https://gitlab.com",
		"https://git.empresa.com/api/v4": "https://git.empresa.com",
		"http://127.0.0.1:9999":          "http://127.0.0.1:9999",
		"https://empresa.com/gitlab/":    "https://empresa.com/gitlab",
	} {
		if got, err := normServer(in); err != nil || got != want {
			t.Errorf("normServer(%q) = %q %v; quero %q", in, got, err, want)
		}
	}
	for _, bad := range []string{"", "ftp://x", "https://u:p@x.com", "https://x.com/?a=1"} {
		if _, err := normServer(bad); err == nil {
			t.Errorf("normServer(%q) deveria falhar", bad)
		}
	}
}

func TestDraftTitle(t *testing.T) {
	if got := DraftTitle(" Corrige X ", true); got != "Draft: Corrige X" {
		t.Fatal(got)
	}
	if got := DraftTitle("Draft: já é", true); got != "Draft: já é" {
		t.Fatal(got)
	}
	if got := DraftTitle("normal", false); got != "normal" {
		t.Fatal(got)
	}
}

// fakeGitLab responde o mínimo da API v4 e guarda o que recebeu.
type fakeGitLab struct {
	srv     *httptest.Server
	token   string
	created map[string]any
	notes   []string
	auths   []string
}

func newFake(t *testing.T) *fakeGitLab {
	f := &fakeGitLab{token: "segredo"}
	mux := http.NewServeMux()
	send := func(w http.ResponseWriter, v any) { _ = json.NewEncoder(w).Encode(v) }
	auth := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			f.auths = append(f.auths, r.Header.Get("Authorization"))
			if r.Header.Get("Authorization") != "Bearer "+f.token {
				w.WriteHeader(http.StatusUnauthorized)
				send(w, map[string]string{"message": "401 Unauthorized"})
				return
			}
			h(w, r)
		}
	}
	mux.HandleFunc("GET /api/v4/user", auth(func(w http.ResponseWriter, r *http.Request) {
		send(w, map[string]any{"id": 7, "username": "eu", "name": "Eu Mesmo"})
	}))
	mux.HandleFunc("GET /api/v4/projects/{id}", auth(func(w http.ResponseWriter, r *http.Request) {
		if r.PathValue("id") != "grupo/app" {
			w.WriteHeader(http.StatusNotFound)
			send(w, map[string]string{"message": "404 Project Not Found"})
			return
		}
		send(w, map[string]any{"id": 1, "path_with_namespace": "grupo/app", "web_url": "https://x/grupo/app", "default_branch": "main"})
	}))
	mux.HandleFunc("GET /api/v4/projects/{id}/merge_requests", auth(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		list := []map[string]any{
			{"iid": 2, "title": "Draft: outra", "state": "opened", "draft": true, "author": map[string]any{"id": 8, "username": "ana", "name": "Ana"}, "source_branch": "b", "target_branch": "main", "user_notes_count": 3},
			{"iid": 1, "title": "minha", "state": "opened", "author": map[string]any{"id": 7, "username": "eu", "name": "Eu"}, "source_branch": "a", "target_branch": "main"},
		}
		if q.Get("author_id") == "7" {
			list = list[1:]
		}
		if q.Get("state") != "opened" || q.Get("order_by") != "updated_at" {
			t.Errorf("query: %v", q)
		}
		send(w, list)
	}))
	mux.HandleFunc("GET /api/v4/projects/{id}/merge_requests/{iid}", auth(func(w http.ResponseWriter, r *http.Request) {
		send(w, map[string]any{
			"iid": 1, "title": "minha", "description": "## Por quê\nporque sim", "state": "opened",
			"author": map[string]any{"id": 7, "username": "eu", "name": "Eu"}, "source_branch": "a", "target_branch": "main",
			"source_project_id": 1, "target_project_id": 1, "detailed_merge_status": "not_approved",
			"head_pipeline": map[string]any{"id": 99, "status": "failed", "web_url": "https://x/p/99"},
			"diff_refs":     map[string]any{"base_sha": "aaa", "head_sha": "bbb", "start_sha": "aaa"},
		})
	}))
	mux.HandleFunc("GET /api/v4/projects/{id}/merge_requests/{iid}/approvals", auth(func(w http.ResponseWriter, r *http.Request) {
		send(w, map[string]any{"approvals_left": 1, "approved_by": []any{map[string]any{"user": map[string]any{"id": 8, "username": "ana", "name": "Ana"}}}})
	}))
	mux.HandleFunc("GET /api/v4/projects/{id}/merge_requests/{iid}/notes", auth(func(w http.ResponseWriter, r *http.Request) {
		send(w, []any{
			map[string]any{"id": 1, "body": "aprovou", "system": true, "author": map[string]any{"username": "ana", "name": "Ana"}},
			map[string]any{"id": 2, "body": "olha isso", "author": map[string]any{"username": "ana", "name": "Ana"}, "position": map[string]any{"new_path": "a.go", "new_line": 3}},
		})
	}))
	mux.HandleFunc("POST /api/v4/projects/{id}/merge_requests", auth(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&f.created)
		if f.created["source_branch"] == "dup" {
			w.WriteHeader(http.StatusConflict)
			send(w, map[string]any{"message": []string{"Another open merge request already exists for this source branch: !4"}})
			return
		}
		w.WriteHeader(http.StatusCreated)
		send(w, map[string]any{"iid": 5, "title": f.created["title"], "state": "opened", "source_branch": f.created["source_branch"], "target_branch": f.created["target_branch"]})
	}))
	mux.HandleFunc("POST /api/v4/projects/{id}/merge_requests/{iid}/notes", auth(func(w http.ResponseWriter, r *http.Request) {
		var b map[string]string
		_ = json.NewDecoder(r.Body).Decode(&b)
		f.notes = append(f.notes, b["body"])
		send(w, map[string]any{"id": 3, "body": b["body"], "author": map[string]any{"username": "eu", "name": "Eu"}})
	}))
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func TestClientFlow(t *testing.T) {
	f := newFake(t)
	ctx := context.Background()
	c := NewClient(f.srv.URL, "segredo")
	me, err := c.User(ctx)
	if err != nil || me.ID != 7 || me.Username != "eu" {
		t.Fatalf("user: %+v %v", me, err)
	}
	p, err := c.Project(ctx, "grupo/app")
	if err != nil || p.DefaultBranch != "main" {
		t.Fatalf("project: %+v %v", p, err)
	}
	all, err := c.ListMergeRequests(ctx, "grupo/app", ListFilter{}, me)
	if err != nil || len(all) != 2 || !all[0].Draft || all[0].Comments != 3 || all[0].Author.Name != "Ana" {
		t.Fatalf("lista: %+v %v", all, err)
	}
	mine, _ := c.ListMergeRequests(ctx, "grupo/app", ListFilter{Scope: "mine"}, me)
	if len(mine) != 1 || mine[0].IID != 1 {
		t.Fatalf("meus: %+v", mine)
	}
	if _, err := c.ListMergeRequests(ctx, "grupo/app", ListFilter{Scope: "x"}, me); err == nil {
		t.Fatal("filtro inválido deveria falhar")
	}
	d, err := c.MergeRequest(ctx, "grupo/app", 1)
	if err != nil {
		t.Fatal(err)
	}
	if d.Pipeline == nil || d.Pipeline.Status != "failed" || d.BaseSHA != "aaa" || d.HeadSHA != "bbb" || d.ApprovalsLeft != 1 ||
		len(d.ApprovedBy) != 1 || len(d.Notes) != 2 || !d.Notes[0].System || d.Notes[1].Path != "a.go" || d.Notes[1].Line != 3 || d.MergeStatus != "not_approved" {
		t.Fatalf("detalhe: %+v", d)
	}
	mr, err := c.CreateMergeRequest(ctx, "grupo/app", CreateRequest{SourceBranch: "a", TargetBranch: "main", Title: "x", Draft: true, ReviewerIDs: []int{8}, AssignToMe: true}, me)
	if err != nil || mr.IID != 5 {
		t.Fatalf("criar: %+v %v", mr, err)
	}
	if f.created["title"] != "Draft: x" || f.created["assignee_id"] != float64(7) || f.created["reviewer_ids"] == nil {
		t.Fatalf("corpo do POST: %+v", f.created)
	}
	if _, err := c.CreateMergeRequest(ctx, "grupo/app", CreateRequest{SourceBranch: "dup", TargetBranch: "main", Title: "x"}, me); err == nil || !strings.Contains(err.Error(), "já existe um merge request aberto") || !strings.Contains(err.Error(), "!4") {
		t.Fatalf("duplicado: %v", err)
	}
	if _, err := c.CreateMergeRequest(ctx, "grupo/app", CreateRequest{SourceBranch: "a", TargetBranch: "a", Title: "x"}, me); err == nil {
		t.Fatal("origem = destino deveria falhar")
	}
	if _, err := c.Comment(ctx, "grupo/app", 1, "valeu"); err != nil || len(f.notes) != 1 {
		t.Fatalf("comentar: %v", err)
	}
	// Token errado: a mensagem explica o que fazer.
	_, err = NewClient(f.srv.URL, "errado").User(ctx)
	var ae *APIError
	if !errors.As(err, &ae) || ae.Status != 401 || !strings.Contains(err.Error(), "escopo api") {
		t.Fatalf("401: %v", err)
	}
	if _, err := c.Project(ctx, "outro/app"); err == nil || !strings.Contains(err.Error(), "404") {
		t.Fatalf("404: %v", err)
	}
}

func TestAccountsSaveForAndFilePermissions(t *testing.T) {
	f := newFake(t)
	ctx := context.Background()
	dir := t.TempDir()
	a := NewAccounts(dir, func() string { return "" })
	t.Setenv("GITLAB_TOKEN", "")
	if _, err := a.Save(ctx, f.srv.URL, "errado"); err == nil {
		t.Fatal("token recusado não deveria ser salvo")
	}
	info, err := a.Save(ctx, f.srv.URL+"/", " segredo ")
	if err != nil || info.Username != "eu" {
		t.Fatalf("salvar: %+v %v", info, err)
	}
	st, err := os.Stat(filepath.Join(dir, "gitlab-accounts.json"))
	if err != nil || st.Mode().Perm() != 0o600 {
		t.Fatalf("o arquivo de contas deveria ser 0600: %v %v", st.Mode(), err)
	}
	list, _ := a.List()
	if len(list) != 1 || list[0].Server != strings.ToLower(f.srv.URL) {
		t.Fatalf("lista: %+v", list)
	}
	// O remoto do mesmo host:porta usa a conta; outro host não ganha o token dela.
	host := strings.TrimPrefix(f.srv.URL, "http://")
	h, port, _ := strings.Cut(host, ":")
	auth, err := a.For(ctx, Remote{Host: h, Port: port, Path: "grupo/app"})
	if err != nil || auth.Token != "segredo" || auth.Source != "account" || auth.Server != strings.ToLower(f.srv.URL) {
		t.Fatalf("conta para o remoto: %+v %v", auth, err)
	}
	other, _ := a.For(ctx, Remote{Host: "gitlab.com", Path: "x/y"})
	if other.Token != "" || other.Source != "" {
		t.Fatalf("token vazou para outro host: %+v", other)
	}
	// GITLAB_TOKEN vale só para gitlab.com (ou para GITLAB_HOST).
	t.Setenv("GITLAB_TOKEN", "do-ambiente")
	if e, _ := a.For(ctx, Remote{Host: "gitlab.com", Path: "x/y"}); e.Token != "do-ambiente" || e.Source != "env" {
		t.Fatalf("env: %+v", e)
	}
	if e, _ := a.For(ctx, Remote{Host: "git.empresa.com", Path: "x/y"}); e.Token != "" {
		t.Fatalf("env não deveria ir para outro host: %+v", e)
	}
	if err := a.Remove(f.srv.URL); err != nil {
		t.Fatal(err)
	}
	if list, _ := a.List(); len(list) != 0 {
		t.Fatalf("depois de remover: %+v", list)
	}
}

func TestGlabToken(t *testing.T) {
	dir := t.TempDir()
	fake := filepath.Join(dir, "glab")
	script := "#!/bin/sh\n[ \"$1 $2 $3 $4 $5\" = \"config get token --host gitlab.com\" ] && echo glab-token\n"
	if err := os.WriteFile(fake, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GITLAB_TOKEN", "")
	a := NewAccounts(dir, func() string { return fake })
	auth, err := a.For(context.Background(), Remote{Host: "gitlab.com", Path: "x/y"})
	if err != nil || auth.Token != "glab-token" || auth.Source != "glab" || auth.Server != "https://gitlab.com" {
		t.Fatalf("glab: %+v %v", auth, err)
	}
	if !LooksLikeGitLab("git.empresa.com", Auth{Source: "glab"}) || LooksLikeGitLab("github.com", Auth{}) {
		t.Fatal("LooksLikeGitLab")
	}
}
