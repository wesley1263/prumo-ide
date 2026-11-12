package forge

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// GitHubClient fala com a API REST do GitHub (github.com ou GitHub Enterprise).
type GitHubClient struct {
	api   string // https://api.github.com ou https://<host>/api/v3
	token string
	http  *http.Client
}

// GitHubAPI é a raiz da API para o servidor: github.com usa api.github.com; o Enterprise, <servidor>/api/v3.
func GitHubAPI(server string) string {
	server = strings.TrimRight(server, "/")
	if u, err := url.Parse(server); err == nil && strings.EqualFold(u.Host, "github.com") {
		return "https://api.github.com"
	}
	return server + "/api/v3"
}

// NewGitHubClient cria o cliente para o servidor (https://github.com ou o do Enterprise).
func NewGitHubClient(server, token string) *GitHubClient {
	return &GitHubClient{api: GitHubAPI(server), token: token, http: &http.Client{Timeout: 30 * time.Second}}
}

func (c *GitHubClient) do(ctx context.Context, method, path string, query url.Values, body, out any) error {
	u := c.api + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, u, rd)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		var ue *url.Error
		if errors.As(err, &ue) && ue.Timeout() {
			return fmt.Errorf("o GitHub (%s) não respondeu a tempo", c.api)
		}
		return fmt.Errorf("não foi possível falar com o GitHub (%s): %w", c.api, errors.Unwrap(err))
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode >= 300 {
		return githubError(resp.StatusCode, resp.Header, data)
	}
	if out == nil || len(data) == 0 {
		return nil
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("resposta inesperada do GitHub em %s: %w", path, err)
	}
	return nil
}

// githubError traduz o código e a mensagem do GitHub ({"message": ..., "errors": [...]}).
func githubError(status int, h http.Header, data []byte) error {
	var m struct {
		Message string `json:"message"`
		Errors  []struct {
			Message string `json:"message"`
			Code    string `json:"code"`
			Field   string `json:"field"`
		} `json:"errors"`
	}
	_ = json.Unmarshal(data, &m)
	parts := []string{}
	if m.Message != "" {
		parts = append(parts, m.Message)
	}
	for _, e := range m.Errors {
		switch {
		case e.Message != "":
			parts = append(parts, e.Message)
		case e.Field != "":
			parts = append(parts, e.Field+": "+e.Code)
		}
	}
	detail := strings.Join(parts, "; ")
	var msg string
	switch {
	case status == http.StatusUnauthorized:
		msg = "o GitHub recusou o token (401): confira se ele ainda vale"
	case status == http.StatusForbidden && h.Get("X-RateLimit-Remaining") == "0":
		msg = "limite de chamadas do GitHub atingido: espere alguns minutos"
	case status == http.StatusForbidden:
		msg = "o token não tem permissão para isso no GitHub (403)"
	case status == http.StatusNotFound:
		msg = "não encontrado no GitHub (404): o repositório existe e o token enxerga ele?"
	case status == http.StatusMethodNotAllowed:
		msg = "o GitHub não deixou (405)"
	case status == http.StatusConflict:
		msg = "o GitHub recusou (409)"
	case status == http.StatusUnprocessableEntity:
		msg = "o GitHub recusou (422)"
	default:
		msg = fmt.Sprintf("o GitHub respondeu %d", status)
	}
	if detail != "" {
		msg += ": " + detail
	}
	return &APIError{Status: status, Msg: msg}
}

// ---------------------------------------------------------------- tipos para a UI

// GhUser é uma pessoa no GitHub.
type GhUser struct {
	Login     string `json:"login"`
	AvatarURL string `json:"avatarUrl"`
	HTMLURL   string `json:"htmlUrl"`
}

// Repo é o repositório no servidor.
type Repo struct {
	FullName      string `json:"fullName"` // dono/repo
	HTMLURL       string `json:"htmlUrl"`
	DefaultBranch string `json:"defaultBranch"`
	CanPush       bool   `json:"canPush"`
}

// PullRequest é um item da lista.
type PullRequest struct {
	Number    int      `json:"number"`
	Title     string   `json:"title"`
	State     string   `json:"state"` // open | closed | merged
	Draft     bool     `json:"draft"`
	Author    GhUser   `json:"author"`
	Head      string   `json:"head"` // branch de origem ("" quando veio da busca)
	Base      string   `json:"base"`
	HTMLURL   string   `json:"htmlUrl"`
	CreatedAt string   `json:"createdAt"`
	UpdatedAt string   `json:"updatedAt"`
	Comments  int      `json:"comments"`
	Labels    []string `json:"labels"`
}

// CheckRun é um check (GitHub Actions e outros) ou um status de commit.
type CheckRun struct {
	Name       string `json:"name"`
	Status     string `json:"status"`     // queued | in_progress | completed
	Conclusion string `json:"conclusion"` // success | failure | neutral | cancelled | skipped | timed_out | action_required | ""
	URL        string `json:"url"`
}

// Checks resume os checks do último commit.
type Checks struct {
	State   string     `json:"state"` // success | failure | pending | "" (nenhum)
	Passed  int        `json:"passed"`
	Failed  int        `json:"failed"`
	Pending int        `json:"pending"`
	Skipped int        `json:"skipped"`
	Runs    []CheckRun `json:"runs"`
}

// ReviewState é a última revisão de cada pessoa (ou um pedido de revisão ainda sem resposta).
type ReviewState struct {
	User  GhUser `json:"user"`
	State string `json:"state"` // APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED | REQUESTED
}

// TimelineItem é um comentário geral ou uma revisão enviada, na ordem em que aconteceram.
type TimelineItem struct {
	Kind      string `json:"kind"` // comment | review
	ID        int64  `json:"id"`
	Author    GhUser `json:"author"`
	Body      string `json:"body"`
	State     string `json:"state"` // revisão: APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED
	CreatedAt string `json:"createdAt"`
	HTMLURL   string `json:"htmlUrl"`
}

// ReviewComment é um comentário numa linha do diff.
type ReviewComment struct {
	ID        int64  `json:"id"`
	InReplyTo int64  `json:"inReplyTo"` // 0 = começa a conversa
	ReviewID  int64  `json:"reviewId"`
	Path      string `json:"path"` // relativo ao repositório
	Line      int    `json:"line"` // 0 = desatualizado (a linha não existe mais no diff atual)
	Side      string `json:"side"` // RIGHT (versão nova) | LEFT (versão antiga)
	StartLine int    `json:"startLine"`
	Original  int    `json:"originalLine"`
	Body      string `json:"body"`
	Author    GhUser `json:"author"`
	CreatedAt string `json:"createdAt"`
	HTMLURL   string `json:"htmlUrl"`
	DiffHunk  string `json:"diffHunk"`
}

// PullDetail é o pull request aberto: descrição, checks, revisões, linha do tempo e comentários no código.
type PullDetail struct {
	PullRequest
	Body           string          `json:"body"`
	HeadSHA        string          `json:"headSha"`
	BaseSHA        string          `json:"baseSha"`
	HeadRepo       string          `json:"headRepo"` // dono/repo de onde vem (fork ou o próprio)
	SameRepo       bool            `json:"sameRepo"`
	Merged         bool            `json:"merged"`
	MergedBy       *GhUser         `json:"mergedBy"`
	Mergeable      *bool           `json:"mergeable"`      // nil = o GitHub ainda está calculando
	MergeableState string          `json:"mergeableState"` // clean | dirty | blocked | behind | unstable | unknown...
	Additions      int             `json:"additions"`
	Deletions      int             `json:"deletions"`
	ChangedFiles   int             `json:"changedFiles"`
	Commits        int             `json:"commits"`
	Assignees      []GhUser        `json:"assignees"`
	Reviews        []ReviewState   `json:"reviews"`
	Checks         Checks          `json:"checks"`
	Timeline       []TimelineItem  `json:"timeline"`
	ReviewComments []ReviewComment `json:"reviewComments"`
}

// ---------------------------------------------------------------- formato da API

type ghUser struct {
	Login     string `json:"login"`
	AvatarURL string `json:"avatar_url"`
	HTMLURL   string `json:"html_url"`
}

func (u ghUser) conv() GhUser { return GhUser(u) }

func convGhUsers(list []ghUser) []GhUser {
	out := make([]GhUser, 0, len(list))
	for _, u := range list {
		out = append(out, u.conv())
	}
	return out
}

type ghLabel struct {
	Name string `json:"name"`
}

func labelNames(list []ghLabel) []string {
	out := make([]string, 0, len(list))
	for _, l := range list {
		out = append(out, l.Name)
	}
	return out
}

type ghRef struct {
	Ref  string `json:"ref"`
	SHA  string `json:"sha"`
	Repo *struct {
		FullName string `json:"full_name"`
	} `json:"repo"`
}

type ghPull struct {
	Number         int       `json:"number"`
	Title          string    `json:"title"`
	Body           string    `json:"body"`
	State          string    `json:"state"`
	Draft          bool      `json:"draft"`
	User           ghUser    `json:"user"`
	Head           ghRef     `json:"head"`
	Base           ghRef     `json:"base"`
	HTMLURL        string    `json:"html_url"`
	CreatedAt      string    `json:"created_at"`
	UpdatedAt      string    `json:"updated_at"`
	MergedAt       string    `json:"merged_at"`
	Merged         bool      `json:"merged"`
	MergedBy       *ghUser   `json:"merged_by"`
	Mergeable      *bool     `json:"mergeable"`
	MergeableState string    `json:"mergeable_state"`
	Comments       int       `json:"comments"`
	ReviewComments int       `json:"review_comments"`
	Additions      int       `json:"additions"`
	Deletions      int       `json:"deletions"`
	ChangedFiles   int       `json:"changed_files"`
	Commits        int       `json:"commits"`
	Labels         []ghLabel `json:"labels"`
	Assignees      []ghUser  `json:"assignees"`
	Reviewers      []ghUser  `json:"requested_reviewers"`
}

func (p ghPull) summary() PullRequest {
	state := p.State
	if p.MergedAt != "" || p.Merged {
		state = "merged"
	}
	return PullRequest{
		Number: p.Number, Title: p.Title, State: state, Draft: p.Draft, Author: p.User.conv(),
		Head: p.Head.Ref, Base: p.Base.Ref, HTMLURL: p.HTMLURL, CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
		Comments: p.Comments + p.ReviewComments, Labels: labelNames(p.Labels),
	}
}

type ghReviewComment struct {
	ID           int64  `json:"id"`
	InReplyTo    int64  `json:"in_reply_to_id"`
	ReviewID     int64  `json:"pull_request_review_id"`
	Path         string `json:"path"`
	Line         *int   `json:"line"`
	Side         string `json:"side"`
	StartLine    *int   `json:"start_line"`
	OriginalLine *int   `json:"original_line"`
	Body         string `json:"body"`
	User         ghUser `json:"user"`
	CreatedAt    string `json:"created_at"`
	HTMLURL      string `json:"html_url"`
	DiffHunk     string `json:"diff_hunk"`
}

type ghIssueComment struct {
	ID        int64  `json:"id"`
	User      ghUser `json:"user"`
	Body      string `json:"body"`
	CreatedAt string `json:"created_at"`
	HTMLURL   string `json:"html_url"`
}

type ghReview struct {
	ID          int64  `json:"id"`
	User        ghUser `json:"user"`
	Body        string `json:"body"`
	State       string `json:"state"`
	SubmittedAt string `json:"submitted_at"`
	HTMLURL     string `json:"html_url"`
}

func intOf(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}

func (r ghReviewComment) conv() ReviewComment {
	side := r.Side
	if side == "" {
		side = "RIGHT"
	}
	return ReviewComment{
		ID: r.ID, InReplyTo: r.InReplyTo, ReviewID: r.ReviewID, Path: r.Path, Line: intOf(r.Line), Side: side,
		StartLine: intOf(r.StartLine), Original: intOf(r.OriginalLine), Body: r.Body, Author: r.User.conv(),
		CreatedAt: r.CreatedAt, HTMLURL: r.HTMLURL, DiffHunk: r.DiffHunk,
	}
}

func repoPath(repo string) string {
	owner, name, _ := strings.Cut(repo, "/")
	return "/repos/" + url.PathEscape(owner) + "/" + url.PathEscape(name)
}

// pages busca uma lista paginada (até max páginas de 100).
func pages[T any](ctx context.Context, c *GitHubClient, path string, q url.Values, max int) ([]T, error) {
	var all []T
	for page := 1; page <= max; page++ {
		qq := url.Values{"per_page": {"100"}, "page": {strconv.Itoa(page)}}
		maps.Copy(qq, q)
		var list []T
		if err := c.do(ctx, http.MethodGet, path, qq, nil, &list); err != nil {
			return nil, err
		}
		all = append(all, list...)
		if len(list) < 100 {
			break
		}
	}
	return all, nil
}

// ---------------------------------------------------------------- chamadas

// User é o dono do token.
func (c *GitHubClient) User(ctx context.Context) (GhUser, error) {
	var u ghUser
	if err := c.do(ctx, http.MethodGet, "/user", nil, nil, &u); err != nil {
		return GhUser{}, err
	}
	return u.conv(), nil
}

// Repo lê o repositório (dono/repo).
func (c *GitHubClient) Repo(ctx context.Context, repo string) (Repo, error) {
	var r struct {
		FullName      string `json:"full_name"`
		HTMLURL       string `json:"html_url"`
		DefaultBranch string `json:"default_branch"`
		Permissions   *struct {
			Push bool `json:"push"`
		} `json:"permissions"`
	}
	if err := c.do(ctx, http.MethodGet, repoPath(repo), nil, nil, &r); err != nil {
		return Repo{}, err
	}
	return Repo{FullName: r.FullName, HTMLURL: r.HTMLURL, DefaultBranch: r.DefaultBranch, CanPush: r.Permissions != nil && r.Permissions.Push}, nil
}

// PullQuery: quais pull requests listar. Category segue as seções do VS Code.
type PullQuery struct {
	Category string `json:"category"` // review (esperando a minha revisão) | assigned | mine | all
	State    string `json:"state"`    // open | closed | merged | all ("" = open)
	Search   string `json:"search"`
}

// ListPulls lista os pull requests (os 50 atualizados mais recentemente). "all" sem busca usa a lista do
// repositório; as outras seções usam a busca do GitHub (review-requested:@me, assignee:@me, author:@me).
func (c *GitHubClient) ListPulls(ctx context.Context, repo string, q PullQuery) ([]PullRequest, error) {
	state := q.State
	if state == "" {
		state = "open"
	}
	if state != "open" && state != "closed" && state != "merged" && state != "all" {
		return nil, fmt.Errorf("estado inválido: %q", q.State)
	}
	search := strings.TrimSpace(q.Search)
	if q.Category == "all" && search == "" && state != "merged" {
		var list []ghPull
		if err := c.do(ctx, http.MethodGet, repoPath(repo)+"/pulls", url.Values{"state": {state}, "sort": {"updated"}, "direction": {"desc"}, "per_page": {"50"}}, nil, &list); err != nil {
			return nil, err
		}
		out := make([]PullRequest, 0, len(list))
		for _, p := range list {
			out = append(out, p.summary())
		}
		return out, nil
	}
	terms := []string{"is:pr", "repo:" + repo}
	switch state {
	case "open", "closed":
		terms = append(terms, "is:"+state)
	case "merged":
		terms = append(terms, "is:merged")
	}
	switch q.Category {
	case "all":
	case "review":
		terms = append(terms, "review-requested:@me")
	case "assigned":
		terms = append(terms, "assignee:@me")
	case "mine":
		terms = append(terms, "author:@me")
	default:
		return nil, fmt.Errorf("filtro inválido: %q", q.Category)
	}
	if search != "" {
		terms = append(terms, search)
	}
	var res struct {
		Items []struct {
			Number      int       `json:"number"`
			Title       string    `json:"title"`
			State       string    `json:"state"`
			Draft       bool      `json:"draft"`
			User        ghUser    `json:"user"`
			HTMLURL     string    `json:"html_url"`
			CreatedAt   string    `json:"created_at"`
			UpdatedAt   string    `json:"updated_at"`
			Comments    int       `json:"comments"`
			Labels      []ghLabel `json:"labels"`
			PullRequest *struct {
				MergedAt string `json:"merged_at"`
			} `json:"pull_request"`
		} `json:"items"`
	}
	if err := c.do(ctx, http.MethodGet, "/search/issues", url.Values{"q": {strings.Join(terms, " ")}, "sort": {"updated"}, "order": {"desc"}, "per_page": {"50"}}, nil, &res); err != nil {
		return nil, err
	}
	out := make([]PullRequest, 0, len(res.Items))
	for _, it := range res.Items {
		st := it.State
		if it.PullRequest != nil && it.PullRequest.MergedAt != "" {
			st = "merged"
		}
		out = append(out, PullRequest{
			Number: it.Number, Title: it.Title, State: st, Draft: it.Draft, Author: it.User.conv(), HTMLURL: it.HTMLURL,
			CreatedAt: it.CreatedAt, UpdatedAt: it.UpdatedAt, Comments: it.Comments, Labels: labelNames(it.Labels),
		})
	}
	return out, nil
}

// PullForBranch é o pull request aberto da branch (do próprio repositório), ou nil.
func (c *GitHubClient) PullForBranch(ctx context.Context, repo, branch string) (*PullRequest, error) {
	owner, _, _ := strings.Cut(repo, "/")
	var list []ghPull
	if err := c.do(ctx, http.MethodGet, repoPath(repo)+"/pulls", url.Values{"state": {"open"}, "head": {owner + ":" + branch}}, nil, &list); err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, nil
	}
	p := list[0].summary()
	return &p, nil
}

// Pull lê um pull request com checks, revisões, comentários gerais e comentários no código.
func (c *GitHubClient) Pull(ctx context.Context, repo string, n int) (PullDetail, error) {
	base := fmt.Sprintf("%s/pulls/%d", repoPath(repo), n)
	var p ghPull
	if err := c.do(ctx, http.MethodGet, base, nil, nil, &p); err != nil {
		return PullDetail{}, err
	}
	d := PullDetail{
		PullRequest: p.summary(), Body: p.Body, HeadSHA: p.Head.SHA, BaseSHA: p.Base.SHA, Merged: p.Merged || p.MergedAt != "",
		Mergeable: p.Mergeable, MergeableState: p.MergeableState, Additions: p.Additions, Deletions: p.Deletions,
		ChangedFiles: p.ChangedFiles, Commits: p.Commits, Assignees: convGhUsers(p.Assignees),
		Reviews: []ReviewState{}, Timeline: []TimelineItem{}, ReviewComments: []ReviewComment{}, Checks: Checks{Runs: []CheckRun{}},
	}
	if p.Head.Repo != nil {
		d.HeadRepo = p.Head.Repo.FullName
	}
	d.SameRepo = d.HeadRepo == "" || strings.EqualFold(d.HeadRepo, repo)
	if p.MergedBy != nil {
		u := p.MergedBy.conv()
		d.MergedBy = &u
	}

	// O resto em paralelo: comentários, revisões, comentários no código e checks.
	var (
		wg                     sync.WaitGroup
		comments               []ghIssueComment
		reviews                []ghReview
		rcs                    []ghReviewComment
		errC, errR, errRC, err error
	)
	wg.Add(4)
	go func() {
		defer wg.Done()
		comments, errC = pages[ghIssueComment](ctx, c, fmt.Sprintf("%s/issues/%d/comments", repoPath(repo), n), nil, 10)
	}()
	go func() {
		defer wg.Done()
		reviews, errR = pages[ghReview](ctx, c, base+"/reviews", nil, 10)
	}()
	go func() {
		defer wg.Done()
		rcs, errRC = pages[ghReviewComment](ctx, c, base+"/comments", nil, 10)
	}()
	go func() {
		defer wg.Done()
		// Sem permissão para checks (token fino): a seção só fica vazia.
		d.Checks, err = c.checks(ctx, repo, p.Head.SHA)
		if err != nil {
			d.Checks = Checks{Runs: []CheckRun{}}
		}
	}()
	wg.Wait()
	for _, err := range []error{errC, errR, errRC} {
		if err != nil {
			return PullDetail{}, err
		}
	}

	for _, x := range comments {
		d.Timeline = append(d.Timeline, TimelineItem{Kind: "comment", ID: x.ID, Author: x.User.conv(), Body: x.Body, CreatedAt: x.CreatedAt, HTMLURL: x.HTMLURL})
	}
	latest := map[string]ReviewState{}
	var order []string
	for _, r := range reviews {
		if r.State == "PENDING" {
			continue // a revisão pendente de quem está vendo não foi enviada
		}
		// Revisão só com comentários no código e sem texto: os comentários já aparecem no diff.
		if r.Body != "" || r.State != "COMMENTED" {
			d.Timeline = append(d.Timeline, TimelineItem{Kind: "review", ID: r.ID, Author: r.User.conv(), Body: r.Body, State: r.State, CreatedAt: r.SubmittedAt, HTMLURL: r.HTMLURL})
		}
		// A situação de cada revisor é a última revisão que decide (aprovar ou pedir mudanças); comentar não muda.
		prev, seen := latest[r.User.Login]
		if !seen {
			order = append(order, r.User.Login)
		}
		if !seen || r.State != "COMMENTED" || prev.State == "COMMENTED" {
			latest[r.User.Login] = ReviewState{User: r.User.conv(), State: r.State}
		}
	}
	for _, u := range p.Reviewers {
		if _, ok := latest[u.Login]; !ok {
			order = append(order, u.Login)
		}
		latest[u.Login] = ReviewState{User: u.conv(), State: "REQUESTED"} // pedido de novo: vale o pedido
	}
	for _, login := range order {
		d.Reviews = append(d.Reviews, latest[login])
	}
	sort.SliceStable(d.Timeline, func(i, j int) bool { return d.Timeline[i].CreatedAt < d.Timeline[j].CreatedAt })
	for _, rc := range rcs {
		d.ReviewComments = append(d.ReviewComments, rc.conv())
	}
	return d, nil
}

// checks junta os check runs (GitHub Actions e apps) e os status de commit (CIs antigos) do commit.
func (c *GitHubClient) checks(ctx context.Context, repo, sha string) (Checks, error) {
	out := Checks{Runs: []CheckRun{}}
	if sha == "" {
		return out, nil
	}
	var runs struct {
		CheckRuns []struct {
			Name       string `json:"name"`
			Status     string `json:"status"`
			Conclusion string `json:"conclusion"`
			HTMLURL    string `json:"html_url"`
			DetailsURL string `json:"details_url"`
		} `json:"check_runs"`
	}
	if err := c.do(ctx, http.MethodGet, fmt.Sprintf("%s/commits/%s/check-runs", repoPath(repo), url.PathEscape(sha)), url.Values{"per_page": {"100"}}, nil, &runs); err != nil {
		return out, err
	}
	for _, r := range runs.CheckRuns {
		u := r.HTMLURL
		if u == "" {
			u = r.DetailsURL
		}
		out.Runs = append(out.Runs, CheckRun{Name: r.Name, Status: r.Status, Conclusion: r.Conclusion, URL: u})
	}
	var st struct {
		Statuses []struct {
			Context   string `json:"context"`
			State     string `json:"state"` // success | failure | error | pending
			TargetURL string `json:"target_url"`
		} `json:"statuses"`
	}
	if err := c.do(ctx, http.MethodGet, fmt.Sprintf("%s/commits/%s/status", repoPath(repo), url.PathEscape(sha)), nil, nil, &st); err == nil {
		for _, s := range st.Statuses {
			r := CheckRun{Name: s.Context, Status: "completed", Conclusion: s.State, URL: s.TargetURL}
			switch s.State {
			case "pending":
				r.Status, r.Conclusion = "in_progress", ""
			case "error":
				r.Conclusion = "failure"
			}
			out.Runs = append(out.Runs, r)
		}
	}
	for _, r := range out.Runs {
		switch {
		case r.Status != "completed":
			out.Pending++
		case r.Conclusion == "success" || r.Conclusion == "neutral":
			out.Passed++
		case r.Conclusion == "skipped" || r.Conclusion == "cancelled":
			out.Skipped++
		default:
			out.Failed++
		}
	}
	switch {
	case len(out.Runs) == 0:
	case out.Failed > 0:
		out.State = "failure"
	case out.Pending > 0:
		out.State = "pending"
	default:
		out.State = "success"
	}
	return out, nil
}

// CreatePullRequest é o formulário de novo pull request.
type CreatePullRequest struct {
	Head       string   `json:"head"`
	Base       string   `json:"base"`
	Title      string   `json:"title"`
	Body       string   `json:"body"`
	Draft      bool     `json:"draft"`
	Reviewers  []string `json:"reviewers"` // logins
	AssignToMe bool     `json:"assignToMe"`
}

// CreatePull abre o pull request e pede as revisões. Se o pedido de revisão falhar, o pull request já existe:
// o erro volta junto com ele.
func (c *GitHubClient) CreatePull(ctx context.Context, repo string, r CreatePullRequest, me GhUser) (PullRequest, error) {
	if strings.TrimSpace(r.Title) == "" {
		return PullRequest{}, errors.New("o pull request precisa de um título")
	}
	if r.Head == "" || r.Base == "" {
		return PullRequest{}, errors.New("escolha a branch de origem e a de destino")
	}
	if r.Head == r.Base {
		return PullRequest{}, errors.New("a branch de origem e a de destino são a mesma")
	}
	var p ghPull
	body := map[string]any{"title": strings.TrimSpace(r.Title), "head": r.Head, "base": r.Base, "body": r.Body, "draft": r.Draft}
	if err := c.do(ctx, http.MethodPost, repoPath(repo)+"/pulls", nil, body, &p); err != nil {
		var ae *APIError
		if errors.As(err, &ae) && ae.Status == http.StatusUnprocessableEntity && strings.Contains(ae.Msg, "already exists") {
			return PullRequest{}, &APIError{Status: ae.Status, Msg: "já existe um pull request aberto desta branch"}
		}
		return PullRequest{}, err
	}
	out := p.summary()
	if len(r.Reviewers) > 0 {
		if err := c.do(ctx, http.MethodPost, fmt.Sprintf("%s/pulls/%d/requested_reviewers", repoPath(repo), p.Number), nil, map[string]any{"reviewers": r.Reviewers}, nil); err != nil {
			return out, fmt.Errorf("pull request #%d criado, mas o pedido de revisão falhou: %w", p.Number, err)
		}
	}
	if r.AssignToMe && me.Login != "" {
		if err := c.do(ctx, http.MethodPost, fmt.Sprintf("%s/issues/%d/assignees", repoPath(repo), p.Number), nil, map[string]any{"assignees": []string{me.Login}}, nil); err != nil {
			return out, fmt.Errorf("pull request #%d criado, mas não deu para atribuir a você: %w", p.Number, err)
		}
	}
	return out, nil
}

// Comment publica um comentário geral na conversa do pull request.
func (c *GitHubClient) Comment(ctx context.Context, repo string, n int, body string) error {
	if strings.TrimSpace(body) == "" {
		return errors.New("o comentário está vazio")
	}
	return c.do(ctx, http.MethodPost, fmt.Sprintf("%s/issues/%d/comments", repoPath(repo), n), nil, map[string]string{"body": body}, nil)
}

// DraftComment é um comentário numa linha, ainda não enviado (fica na revisão pendente, como no VS Code).
type DraftComment struct {
	Path string `json:"path"` // relativo ao repositório
	Line int    `json:"line"`
	Side string `json:"side"` // RIGHT | LEFT
	Body string `json:"body"`
}

func (d DraftComment) valid() error {
	if strings.TrimSpace(d.Body) == "" {
		return errors.New("o comentário está vazio")
	}
	if d.Path == "" || d.Line < 1 || (d.Side != "RIGHT" && d.Side != "LEFT") {
		return fmt.Errorf("posição do comentário inválida: %s:%d", d.Path, d.Line)
	}
	return nil
}

// ReviewRequest envia uma revisão: o veredito, o texto geral e os comentários pendentes no código.
type ReviewRequest struct {
	Event    string         `json:"event"` // APPROVE | REQUEST_CHANGES | COMMENT
	Body     string         `json:"body"`
	Comments []DraftComment `json:"comments"`
}

// SubmitReview envia a revisão de uma vez (o GitHub cria a revisão já enviada, com os comentários).
func (c *GitHubClient) SubmitReview(ctx context.Context, repo string, n int, commit string, r ReviewRequest) error {
	switch r.Event {
	case "APPROVE":
	case "REQUEST_CHANGES", "COMMENT":
		if strings.TrimSpace(r.Body) == "" && len(r.Comments) == 0 {
			return errors.New("escreva um comentário para enviar a revisão")
		}
	default:
		return fmt.Errorf("tipo de revisão inválido: %q", r.Event)
	}
	comments := make([]map[string]any, 0, len(r.Comments))
	for _, d := range r.Comments {
		if err := d.valid(); err != nil {
			return err
		}
		comments = append(comments, map[string]any{"path": d.Path, "line": d.Line, "side": d.Side, "body": d.Body})
	}
	body := map[string]any{"event": r.Event, "body": r.Body, "comments": comments}
	if commit != "" {
		body["commit_id"] = commit
	}
	return c.do(ctx, http.MethodPost, fmt.Sprintf("%s/pulls/%d/reviews", repoPath(repo), n), nil, body, nil)
}

// AddReviewComment publica um comentário avulso numa linha (sem revisão pendente).
func (c *GitHubClient) AddReviewComment(ctx context.Context, repo string, n int, commit string, d DraftComment) (ReviewComment, error) {
	if err := d.valid(); err != nil {
		return ReviewComment{}, err
	}
	var rc ghReviewComment
	body := map[string]any{"body": d.Body, "commit_id": commit, "path": d.Path, "line": d.Line, "side": d.Side}
	if err := c.do(ctx, http.MethodPost, fmt.Sprintf("%s/pulls/%d/comments", repoPath(repo), n), nil, body, &rc); err != nil {
		return ReviewComment{}, err
	}
	return rc.conv(), nil
}

// Reply responde a uma conversa no código.
func (c *GitHubClient) Reply(ctx context.Context, repo string, n int, to int64, body string) (ReviewComment, error) {
	if strings.TrimSpace(body) == "" {
		return ReviewComment{}, errors.New("o comentário está vazio")
	}
	var rc ghReviewComment
	if err := c.do(ctx, http.MethodPost, fmt.Sprintf("%s/pulls/%d/comments/%d/replies", repoPath(repo), n, to), nil, map[string]string{"body": body}, &rc); err != nil {
		return ReviewComment{}, err
	}
	return rc.conv(), nil
}

// Merge junta o pull request (merge, squash ou rebase). sha: o commit que a pessoa viu (o GitHub recusa se
// a branch andou depois).
func (c *GitHubClient) Merge(ctx context.Context, repo string, n int, method, sha string) error {
	if method != "merge" && method != "squash" && method != "rebase" {
		return fmt.Errorf("forma de merge inválida: %q", method)
	}
	body := map[string]any{"merge_method": method}
	if sha != "" {
		body["sha"] = sha
	}
	err := c.do(ctx, http.MethodPut, fmt.Sprintf("%s/pulls/%d/merge", repoPath(repo), n), nil, body, nil)
	var ae *APIError
	if errors.As(err, &ae) && ae.Status == http.StatusConflict {
		return &APIError{Status: ae.Status, Msg: "a branch do pull request mudou depois que você abriu: atualize e tente de novo"}
	}
	return err
}

// Assignable busca pessoas que podem revisar (as que podem ser atribuídas no repositório).
func (c *GitHubClient) Assignable(ctx context.Context, repo, query string) ([]GhUser, error) {
	list, err := pages[ghUser](ctx, c, repoPath(repo)+"/assignees", nil, 3)
	if err != nil {
		return nil, err
	}
	query = strings.ToLower(strings.TrimSpace(query))
	out := []GhUser{}
	for _, u := range list {
		if query == "" || strings.Contains(strings.ToLower(u.Login), query) {
			out = append(out, u.conv())
		}
		if len(out) == 20 {
			break
		}
	}
	return out, nil
}
