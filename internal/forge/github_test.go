package forge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// fakeGitHub é um GitHub Enterprise falso (a API fica em /api/v3) com o repositório dono/app.
type fakeGitHub struct {
	srv  *httptest.Server
	mu   sync.Mutex
	got  []string         // "MÉTODO caminho?query" de cada chamada
	sent map[string][]any // corpo de cada POST/PUT por caminho
}

func newFakeGitHub(t *testing.T) *fakeGitHub {
	f := &fakeGitHub{sent: map[string][]any{}}
	ana := map[string]any{"login": "ana"}
	bia := map[string]any{"login": "bia"}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.got = append(f.got, r.Method+" "+r.URL.Path+"?"+r.URL.RawQuery)
		var body any
		if r.Body != nil {
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body != nil {
				f.sent[r.URL.Path] = append(f.sent[r.URL.Path], body)
			}
		}
		f.mu.Unlock()
		send := func(code int, v any) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(code)
			_ = json.NewEncoder(w).Encode(v)
		}
		if r.Header.Get("Authorization") != "Bearer segredo" {
			send(401, map[string]any{"message": "Bad credentials"})
			return
		}
		p := strings.TrimPrefix(r.URL.Path, "/api/v3")
		pull := map[string]any{
			"number": 3, "title": "Frete grátis", "body": "## Por quê", "state": "open", "user": ana,
			"head": map[string]any{"ref": "frete", "sha": "abc123", "repo": map[string]any{"full_name": "dono/app"}},
			"base": map[string]any{"ref": "main", "sha": "def456"}, "comments": 1, "review_comments": 2,
			"requested_reviewers": []any{bia}, "labels": []any{map[string]any{"name": "bug"}}, "mergeable": true, "mergeable_state": "clean",
		}
		switch {
		case p == "/user":
			send(200, map[string]any{"login": "eu"})
		case p == "/repos/dono/app":
			send(200, map[string]any{"full_name": "dono/app", "html_url": "https://gh/dono/app", "default_branch": "main", "permissions": map[string]any{"push": true}})
		case p == "/repos/dono/app/pulls" && r.Method == http.MethodGet:
			send(200, []any{pull})
		case p == "/repos/dono/app/pulls" && r.Method == http.MethodPost:
			if b, _ := body.(map[string]any); b["head"] == "repetida" {
				send(422, map[string]any{"message": "Validation Failed", "errors": []any{map[string]any{"message": "A pull request already exists for dono:repetida."}}})
				return
			}
			send(201, map[string]any{"number": 9, "title": "novo", "state": "open", "user": map[string]any{"login": "eu"}, "head": map[string]any{"ref": "x"}, "base": map[string]any{"ref": "main"}})
		case p == "/search/issues":
			send(200, map[string]any{"items": []any{map[string]any{"number": 4, "title": "Revisar", "state": "closed", "user": bia, "pull_request": map[string]any{"merged_at": "2026-11-01T00:00:00Z"}}}})
		case p == "/repos/dono/app/pulls/3":
			send(200, pull)
		case p == "/repos/dono/app/issues/3/comments" && r.Method == http.MethodGet:
			send(200, []any{map[string]any{"id": 1, "user": bia, "body": "Ficou bom", "created_at": "2026-11-02T10:00:00Z"}})
		case p == "/repos/dono/app/pulls/3/reviews" && r.Method == http.MethodGet:
			send(200, []any{
				map[string]any{"id": 10, "user": ana, "body": "", "state": "COMMENTED", "submitted_at": "2026-11-01T09:00:00Z"},
				map[string]any{"id": 11, "user": map[string]any{"login": "caio"}, "body": "Falta teste", "state": "CHANGES_REQUESTED", "submitted_at": "2026-11-01T10:00:00Z"},
				map[string]any{"id": 12, "user": map[string]any{"login": "caio"}, "body": "", "state": "COMMENTED", "submitted_at": "2026-11-01T11:00:00Z"},
				map[string]any{"id": 13, "user": map[string]any{"login": "duda"}, "body": "", "state": "APPROVED", "submitted_at": "2026-11-03T08:00:00Z"},
				map[string]any{"id": 14, "user": map[string]any{"login": "eu"}, "body": "", "state": "PENDING"},
			})
		case p == "/repos/dono/app/pulls/3/comments" && r.Method == http.MethodGet:
			send(200, []any{
				map[string]any{"id": 20, "path": "main.go", "line": 7, "side": "RIGHT", "body": "Por que 100?", "user": ana, "pull_request_review_id": 10},
				map[string]any{"id": 21, "in_reply_to_id": 20, "path": "main.go", "line": 7, "side": "RIGHT", "body": "Regra do comercial", "user": map[string]any{"login": "eu"}},
				map[string]any{"id": 22, "path": "old.go", "line": nil, "original_line": 3, "body": "Desatualizado", "user": ana},
			})
		case strings.HasSuffix(p, "/check-runs"):
			send(200, map[string]any{"check_runs": []any{
				map[string]any{"name": "test", "status": "completed", "conclusion": "success"},
				map[string]any{"name": "lint", "status": "completed", "conclusion": "failure", "html_url": "https://gh/run/2"},
				map[string]any{"name": "e2e", "status": "in_progress"},
			}})
		case strings.HasSuffix(p, "/status"):
			send(200, map[string]any{"statuses": []any{map[string]any{"context": "ci/antigo", "state": "pending"}}})
		case p == "/repos/dono/app/pulls/9/requested_reviewers", p == "/repos/dono/app/issues/9/assignees":
			send(201, map[string]any{})
		case p == "/repos/dono/app/pulls/3/reviews" && r.Method == http.MethodPost:
			send(200, map[string]any{"id": 30})
		case p == "/repos/dono/app/pulls/3/comments" && r.Method == http.MethodPost:
			send(201, map[string]any{"id": 31, "path": "main.go", "line": 2, "side": "RIGHT", "body": "ok", "user": map[string]any{"login": "eu"}})
		case p == "/repos/dono/app/pulls/3/comments/20/replies":
			send(201, map[string]any{"id": 32, "in_reply_to_id": 20, "path": "main.go", "line": 7, "body": "certo", "user": map[string]any{"login": "eu"}})
		case p == "/repos/dono/app/pulls/3/merge":
			if b, _ := body.(map[string]any); b["sha"] == "velho" {
				send(409, map[string]any{"message": "Head branch was modified. Review and try the merge again."})
				return
			}
			send(200, map[string]any{"merged": true})
		case p == "/repos/dono/app/assignees":
			send(200, []any{ana, bia, map[string]any{"login": "anabela"}})
		default:
			send(404, map[string]any{"message": "Not Found"})
		}
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeGitHub) calls() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.got...)
}

func TestGitHubAPI(t *testing.T) {
	for in, want := range map[string]string{
		"https://github.com":          "https://api.github.com",
		"https://GitHub.com/":         "https://api.github.com",
		"https://git.empresa.com":     "https://git.empresa.com/api/v3",
		"http://127.0.0.1:9000":       "http://127.0.0.1:9000/api/v3",
		"https://empresa.com/github/": "https://empresa.com/github/api/v3",
	} {
		if got := GitHubAPI(in); got != want {
			t.Errorf("GitHubAPI(%q) = %q; quero %q", in, got, want)
		}
	}
	if got, err := normServer("https://git.empresa.com/api/v3/"); err != nil || got != "https://git.empresa.com" {
		t.Errorf("normServer com /api/v3: %q %v", got, err)
	}
}

func TestGitHubListPulls(t *testing.T) {
	f := newFakeGitHub(t)
	c := NewGitHubClient(f.srv.URL, "segredo")
	ctx := context.Background()

	all, err := c.ListPulls(ctx, "dono/app", PullQuery{Category: "all"})
	if err != nil || len(all) != 1 || all[0].Number != 3 || all[0].Head != "frete" || all[0].Comments != 3 || all[0].Labels[0] != "bug" {
		t.Fatalf("todos: %+v %v", all, err)
	}
	// As outras seções vão pela busca, com o filtro do VS Code.
	review, err := c.ListPulls(ctx, "dono/app", PullQuery{Category: "review", State: "merged", Search: "frete"})
	if err != nil || len(review) != 1 || review[0].State != "merged" || review[0].Author.Login != "bia" {
		t.Fatalf("revisão: %+v %v", review, err)
	}
	last := f.calls()[len(f.calls())-1]
	if !strings.Contains(last, "/search/issues") || !strings.Contains(last, "review-requested%3A%40me") || !strings.Contains(last, "is%3Amerged") || !strings.Contains(last, "repo%3Adono%2Fapp") {
		t.Fatalf("busca: %s", last)
	}
	if _, err := c.ListPulls(ctx, "dono/app", PullQuery{Category: "outra"}); err == nil {
		t.Fatal("seção desconhecida deveria falhar")
	}
	cur, err := c.PullForBranch(ctx, "dono/app", "frete")
	if err != nil || cur == nil || cur.Number != 3 {
		t.Fatalf("pull da branch: %+v %v", cur, err)
	}
	if last := f.calls()[len(f.calls())-1]; !strings.Contains(last, "head=dono%3Afrete") {
		t.Fatalf("filtro da branch: %s", last)
	}
}

func TestGitHubPullDetail(t *testing.T) {
	f := newFakeGitHub(t)
	c := NewGitHubClient(f.srv.URL, "segredo")
	d, err := c.Pull(context.Background(), "dono/app", 3)
	if err != nil {
		t.Fatal(err)
	}
	if d.HeadSHA != "abc123" || !d.SameRepo || d.Mergeable == nil || !*d.Mergeable || d.Body != "## Por quê" {
		t.Fatalf("detalhe: %+v", d)
	}
	// Situação por revisor: comentar depois de pedir mudanças não apaga o pedido; a pendente não conta;
	// quem foi chamado e ainda não revisou aparece como pedido.
	states := map[string]string{}
	for _, r := range d.Reviews {
		states[r.User.Login] = r.State
	}
	want := map[string]string{"ana": "COMMENTED", "caio": "CHANGES_REQUESTED", "duda": "APPROVED", "bia": "REQUESTED"}
	if len(states) != len(want) {
		t.Fatalf("revisões: %+v", d.Reviews)
	}
	for k, v := range want {
		if states[k] != v {
			t.Fatalf("revisões: %+v", d.Reviews)
		}
	}
	// Linha do tempo em ordem: revisões com texto ou veredito e os comentários gerais.
	var kinds []string
	for _, it := range d.Timeline {
		kinds = append(kinds, it.Kind+":"+it.State)
	}
	if strings.Join(kinds, ",") != "review:CHANGES_REQUESTED,comment:,review:APPROVED" {
		t.Fatalf("linha do tempo: %v", kinds)
	}
	if len(d.ReviewComments) != 3 || d.ReviewComments[1].InReplyTo != 20 || d.ReviewComments[2].Line != 0 || d.ReviewComments[2].Original != 3 || d.ReviewComments[2].Side != "RIGHT" {
		t.Fatalf("comentários no código: %+v", d.ReviewComments)
	}
	ch := d.Checks
	if ch.State != "failure" || ch.Passed != 1 || ch.Failed != 1 || ch.Pending != 2 || len(ch.Runs) != 4 {
		t.Fatalf("checks: %+v", ch)
	}
}

func TestGitHubCreateReviewMerge(t *testing.T) {
	f := newFakeGitHub(t)
	c := NewGitHubClient(f.srv.URL, "segredo")
	ctx := context.Background()

	pr, err := c.CreatePull(ctx, "dono/app", CreatePullRequest{Head: "x", Base: "main", Title: " novo ", Reviewers: []string{"ana"}, AssignToMe: true}, GhUser{Login: "eu"})
	if err != nil || pr.Number != 9 {
		t.Fatalf("criar: %+v %v", pr, err)
	}
	if b := f.sent["/api/v3/repos/dono/app/pulls/9/requested_reviewers"]; len(b) != 1 {
		t.Fatalf("pedido de revisão: %+v", f.sent)
	}
	if b := f.sent["/api/v3/repos/dono/app/issues/9/assignees"]; len(b) != 1 {
		t.Fatalf("atribuição: %+v", f.sent)
	}
	if _, err := c.CreatePull(ctx, "dono/app", CreatePullRequest{Head: "repetida", Base: "main", Title: "t"}, GhUser{}); err == nil || err.Error() != "já existe um pull request aberto desta branch" {
		t.Fatalf("repetido: %v", err)
	}
	if _, err := c.CreatePull(ctx, "dono/app", CreatePullRequest{Head: "main", Base: "main", Title: "t"}, GhUser{}); err == nil {
		t.Fatal("origem igual ao destino deveria falhar")
	}

	if err := c.SubmitReview(ctx, "dono/app", 3, "abc123", ReviewRequest{Event: "REQUEST_CHANGES"}); err == nil {
		t.Fatal("pedir mudanças sem texto deveria falhar")
	}
	if err := c.SubmitReview(ctx, "dono/app", 3, "abc123", ReviewRequest{Event: "COMMENT", Comments: []DraftComment{{Path: "a.go", Line: 0, Side: "RIGHT", Body: "x"}}}); err == nil {
		t.Fatal("linha 0 deveria falhar")
	}
	err = c.SubmitReview(ctx, "dono/app", 3, "abc123", ReviewRequest{Event: "APPROVE", Comments: []DraftComment{{Path: "main.go", Line: 4, Side: "LEFT", Body: "apagou isso?"}}})
	if err != nil {
		t.Fatal(err)
	}
	rv := f.sent["/api/v3/repos/dono/app/pulls/3/reviews"][0].(map[string]any)
	cm := rv["comments"].([]any)[0].(map[string]any)
	if rv["event"] != "APPROVE" || rv["commit_id"] != "abc123" || cm["side"] != "LEFT" || cm["line"] != float64(4) {
		t.Fatalf("revisão enviada: %+v", rv)
	}

	if rc, err := c.AddReviewComment(ctx, "dono/app", 3, "abc123", DraftComment{Path: "main.go", Line: 2, Side: "RIGHT", Body: "ok"}); err != nil || rc.ID != 31 {
		t.Fatalf("comentário avulso: %+v %v", rc, err)
	}
	if rc, err := c.Reply(ctx, "dono/app", 3, 20, "certo"); err != nil || rc.InReplyTo != 20 {
		t.Fatalf("resposta: %+v %v", rc, err)
	}
	if err := c.Merge(ctx, "dono/app", 3, "squash", "abc123"); err != nil {
		t.Fatal(err)
	}
	if err := c.Merge(ctx, "dono/app", 3, "squash", "velho"); err == nil || !strings.Contains(err.Error(), "mudou") {
		t.Fatalf("merge com branch que andou: %v", err)
	}
	if err := c.Merge(ctx, "dono/app", 3, "fast-forward", ""); err == nil {
		t.Fatal("forma de merge desconhecida deveria falhar")
	}
	users, err := c.Assignable(ctx, "dono/app", "ANA")
	if err != nil || len(users) != 2 || users[1].Login != "anabela" {
		t.Fatalf("pessoas: %+v %v", users, err)
	}
}

func TestGitHubErrors(t *testing.T) {
	f := newFakeGitHub(t)
	if _, err := NewGitHubClient(f.srv.URL, "errado").User(context.Background()); err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("401: %v", err)
	}
	if _, err := NewGitHubClient(f.srv.URL, "segredo").Repo(context.Background(), "outro/app"); err == nil || !strings.Contains(err.Error(), "404") {
		t.Fatalf("404: %v", err)
	}
	rate := githubError(403, http.Header{"X-Ratelimit-Remaining": {"0"}}, []byte(`{"message":"API rate limit exceeded"}`))
	if !strings.Contains(rate.Error(), "limite de chamadas") {
		t.Fatalf("limite: %v", rate)
	}
}

func TestGitHubAccounts(t *testing.T) {
	f := newFakeGitHub(t)
	ctx := context.Background()
	dir := t.TempDir()
	for _, k := range []string{"GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GH_HOST"} {
		t.Setenv(k, "")
	}
	a := NewGitHubAccounts(dir, func() string { return "" })
	if _, err := a.Save(ctx, f.srv.URL, "errado"); err == nil {
		t.Fatal("token recusado não deveria ser salvo")
	}
	info, err := a.Save(ctx, f.srv.URL, "segredo")
	if err != nil || info.Username != "eu" {
		t.Fatalf("salvar: %+v %v", info, err)
	}
	if st, err := os.Stat(filepath.Join(dir, "github-accounts.json")); err != nil || st.Mode().Perm() != 0o600 {
		t.Fatalf("arquivo de contas: %v", err)
	}
	// O env só vale para github.com, e não toma o lugar da conta.
	t.Setenv("GITHUB_TOKEN", "do-ambiente")
	if e, _ := a.For(ctx, Remote{Host: "github.com", Path: "x/y"}); e.Token != "do-ambiente" || e.Source != "env" || e.Server != "https://github.com" {
		t.Fatalf("env: %+v", e)
	}
	if e, _ := a.For(ctx, Remote{Host: "git.empresa.com", Path: "x/y"}); e.Token != "" {
		t.Fatalf("env não deveria ir para outro host: %+v", e)
	}

	// gh logado: "gh auth token --hostname <host>".
	fake := filepath.Join(dir, "gh")
	script := "#!/bin/sh\n[ \"$1 $2 $3 $4\" = \"auth token --hostname github.com\" ] && echo gh-token\n"
	if err := os.WriteFile(fake, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	g := NewGitHubAccounts(t.TempDir(), func() string { return fake })
	if e, _ := g.For(ctx, Remote{Host: "github.com", Path: "x/y"}); e.Token != "gh-token" || e.Source != "gh" {
		t.Fatalf("gh: %+v", e)
	}
	if !LooksLikeGitHub("github.empresa.com", Auth{}) || !LooksLikeGitHub("git.x.com", Auth{Source: "gh"}) || LooksLikeGitHub("gitlab.com", Auth{}) {
		t.Fatal("LooksLikeGitHub")
	}
}
