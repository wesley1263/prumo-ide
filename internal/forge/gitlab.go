package forge

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Client fala com a API v4 de um servidor GitLab.
type Client struct {
	base  string // https://gitlab.com
	token string
	http  *http.Client
}

// NewClient cria o cliente. O token vai no cabeçalho Authorization (vale para token pessoal e OAuth do glab).
func NewClient(server, token string) *Client {
	return &Client{base: strings.TrimRight(server, "/"), token: token, http: &http.Client{Timeout: 30 * time.Second}}
}

// APIError é um erro devolvido pelo servidor, já com uma frase para o usuário.
type APIError struct {
	Status int
	Msg    string
}

func (e *APIError) Error() string { return e.Msg }

func (c *Client) do(ctx context.Context, method, path string, query url.Values, body, out any) error {
	u := c.base + "/api/v4" + path
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
	req.Header.Set("Accept", "application/json")
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
			return fmt.Errorf("o GitLab (%s) não respondeu a tempo", c.base)
		}
		return fmt.Errorf("não foi possível falar com o GitLab (%s): %w", c.base, errors.Unwrap(err))
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode >= 300 {
		return apiError(resp.StatusCode, data)
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("resposta inesperada do GitLab em %s: %w", path, err)
	}
	return nil
}

// apiError traduz o código e a mensagem do GitLab ({"message": ...} ou {"error": ...}).
func apiError(status int, data []byte) error {
	var m struct {
		Message any    `json:"message"`
		Error   string `json:"error"`
	}
	_ = json.Unmarshal(data, &m)
	detail := m.Error
	switch v := m.Message.(type) {
	case string:
		detail = v
	case []any:
		parts := make([]string, 0, len(v))
		for _, p := range v {
			parts = append(parts, fmt.Sprint(p))
		}
		detail = strings.Join(parts, "; ")
	case map[string]any:
		parts := make([]string, 0, len(v))
		for k, p := range v {
			parts = append(parts, fmt.Sprintf("%s: %v", k, p))
		}
		detail = strings.Join(parts, "; ")
	}
	var msg string
	switch status {
	case http.StatusUnauthorized:
		msg = "o GitLab recusou o token (401): confira se ele ainda vale e tem o escopo api"
	case http.StatusForbidden:
		msg = "o token não tem permissão para isso no GitLab (403)"
	case http.StatusNotFound:
		msg = "não encontrado no GitLab (404): o projeto existe e o token enxerga ele?"
	case http.StatusConflict:
		msg = "o GitLab recusou (409)"
	default:
		msg = fmt.Sprintf("o GitLab respondeu %d", status)
	}
	if detail != "" {
		msg += ": " + detail
	}
	return &APIError{Status: status, Msg: msg}
}

// ---------------------------------------------------------------- tipos para a UI

// User é uma pessoa no GitLab.
type User struct {
	ID        int    `json:"id"`
	Username  string `json:"username"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatarUrl"`
	WebURL    string `json:"webUrl"`
}

// Project é o projeto no servidor.
type Project struct {
	ID            int    `json:"id"`
	Path          string `json:"path"` // grupo/projeto
	WebURL        string `json:"webUrl"`
	DefaultBranch string `json:"defaultBranch"`
}

// Pipeline é o CI do último commit do merge request.
type Pipeline struct {
	ID     int    `json:"id"`
	Status string `json:"status"` // success | failed | running | pending | canceled | skipped | manual | created...
	WebURL string `json:"webUrl"`
}

// MergeRequest é um item da lista.
type MergeRequest struct {
	IID          int       `json:"iid"`
	Title        string    `json:"title"`
	State        string    `json:"state"` // opened | merged | closed | locked
	Draft        bool      `json:"draft"`
	Author       User      `json:"author"`
	SourceBranch string    `json:"sourceBranch"`
	TargetBranch string    `json:"targetBranch"`
	WebURL       string    `json:"webUrl"`
	CreatedAt    string    `json:"createdAt"`
	UpdatedAt    string    `json:"updatedAt"`
	Comments     int       `json:"comments"`
	Labels       []string  `json:"labels"`
	Reviewers    []User    `json:"reviewers"`
	Assignees    []User    `json:"assignees"`
	HasConflicts bool      `json:"hasConflicts"`
	MergeStatus  string    `json:"mergeStatus"` // detailed_merge_status: mergeable, not_approved, ci_still_running...
	Pipeline     *Pipeline `json:"pipeline"`
}

// Note é um comentário (ou um evento do sistema, como "aprovou" e "adicionou commits").
type Note struct {
	ID        int    `json:"id"`
	Body      string `json:"body"`
	Author    User   `json:"author"`
	CreatedAt string `json:"createdAt"`
	System    bool   `json:"system"`
	// Comentário numa linha do diff: o arquivo e a linha (nova, ou a antiga se a linha foi apagada).
	Path string `json:"path"`
	Line int    `json:"line"`
}

// MergeRequestDetail é o merge request aberto: descrição, CI, aprovações, comentários e as revisões do diff.
type MergeRequestDetail struct {
	MergeRequest
	Description     string `json:"description"`
	SourceProjectID int    `json:"sourceProjectId"`
	TargetProjectID int    `json:"targetProjectId"`
	BaseSHA         string `json:"baseSha"`
	HeadSHA         string `json:"headSha"`
	StartSHA        string `json:"startSha"`
	ApprovedBy      []User `json:"approvedBy"`
	ApprovalsLeft   int    `json:"approvalsLeft"`
	Notes           []Note `json:"notes"`
	MergedBy        *User  `json:"mergedBy"`
}

// ---------------------------------------------------------------- formato da API

type apiUser struct {
	ID        int    `json:"id"`
	Username  string `json:"username"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	WebURL    string `json:"web_url"`
}

func (u apiUser) conv() User { return User(u) }

func convUsers(list []apiUser) []User {
	out := make([]User, 0, len(list))
	for _, u := range list {
		out = append(out, u.conv())
	}
	return out
}

type apiPipeline struct {
	ID     int    `json:"id"`
	Status string `json:"status"`
	WebURL string `json:"web_url"`
}

type apiMR struct {
	IID                 int          `json:"iid"`
	Title               string       `json:"title"`
	Description         string       `json:"description"`
	State               string       `json:"state"`
	Draft               bool         `json:"draft"`
	WorkInProgress      bool         `json:"work_in_progress"`
	Author              apiUser      `json:"author"`
	SourceBranch        string       `json:"source_branch"`
	TargetBranch        string       `json:"target_branch"`
	SourceProjectID     int          `json:"source_project_id"`
	TargetProjectID     int          `json:"target_project_id"`
	WebURL              string       `json:"web_url"`
	CreatedAt           string       `json:"created_at"`
	UpdatedAt           string       `json:"updated_at"`
	UserNotesCount      int          `json:"user_notes_count"`
	Labels              []string     `json:"labels"`
	Reviewers           []apiUser    `json:"reviewers"`
	Assignees           []apiUser    `json:"assignees"`
	HasConflicts        bool         `json:"has_conflicts"`
	MergeStatus         string       `json:"merge_status"`
	DetailedMergeStatus string       `json:"detailed_merge_status"`
	HeadPipeline        *apiPipeline `json:"head_pipeline"`
	MergedBy            *apiUser     `json:"merged_by"`
	DiffRefs            *struct {
		BaseSHA  string `json:"base_sha"`
		HeadSHA  string `json:"head_sha"`
		StartSHA string `json:"start_sha"`
	} `json:"diff_refs"`
}

func (m apiMR) summary() MergeRequest {
	status := m.DetailedMergeStatus
	if status == "" {
		status = m.MergeStatus
	}
	labels := m.Labels
	if labels == nil {
		labels = []string{}
	}
	out := MergeRequest{
		IID: m.IID, Title: m.Title, State: m.State, Draft: m.Draft || m.WorkInProgress, Author: m.Author.conv(),
		SourceBranch: m.SourceBranch, TargetBranch: m.TargetBranch, WebURL: m.WebURL,
		CreatedAt: m.CreatedAt, UpdatedAt: m.UpdatedAt, Comments: m.UserNotesCount, Labels: labels,
		Reviewers: convUsers(m.Reviewers), Assignees: convUsers(m.Assignees), HasConflicts: m.HasConflicts, MergeStatus: status,
	}
	if m.HeadPipeline != nil {
		out.Pipeline = &Pipeline{ID: m.HeadPipeline.ID, Status: m.HeadPipeline.Status, WebURL: m.HeadPipeline.WebURL}
	}
	return out
}

func projectPath(path string) string { return "/projects/" + url.PathEscape(path) }

// ---------------------------------------------------------------- chamadas

// User é o dono do token.
func (c *Client) User(ctx context.Context) (User, error) {
	var u apiUser
	if err := c.do(ctx, http.MethodGet, "/user", nil, nil, &u); err != nil {
		return User{}, err
	}
	return u.conv(), nil
}

// Project lê o projeto pelo caminho (grupo/projeto).
func (c *Client) Project(ctx context.Context, path string) (Project, error) {
	var p struct {
		ID                int    `json:"id"`
		PathWithNamespace string `json:"path_with_namespace"`
		WebURL            string `json:"web_url"`
		DefaultBranch     string `json:"default_branch"`
	}
	if err := c.do(ctx, http.MethodGet, projectPath(path), nil, nil, &p); err != nil {
		return Project{}, err
	}
	return Project{ID: p.ID, Path: p.PathWithNamespace, WebURL: p.WebURL, DefaultBranch: p.DefaultBranch}, nil
}

// ListFilter: quais merge requests listar.
type ListFilter struct {
	State  string `json:"state"`  // opened | merged | closed | all
	Scope  string `json:"scope"`  // all | mine (criados por mim) | review (pedem a minha revisão) | assigned
	Search string `json:"search"` // título e descrição
	Source string `json:"source"` // só os desta branch de origem
}

// ListMergeRequests lista os merge requests do projeto (os 50 atualizados mais recentemente).
func (c *Client) ListMergeRequests(ctx context.Context, path string, f ListFilter, me User) ([]MergeRequest, error) {
	q := url.Values{"order_by": {"updated_at"}, "sort": {"desc"}, "per_page": {"50"}}
	switch f.State {
	case "", "opened":
		q.Set("state", "opened")
	case "merged", "closed", "all":
		q.Set("state", f.State)
	default:
		return nil, fmt.Errorf("estado inválido: %q", f.State)
	}
	switch f.Scope {
	case "", "all":
	case "mine":
		q.Set("author_id", strconv.Itoa(me.ID))
	case "review":
		q.Set("reviewer_id", strconv.Itoa(me.ID))
	case "assigned":
		q.Set("assignee_id", strconv.Itoa(me.ID))
	default:
		return nil, fmt.Errorf("filtro inválido: %q", f.Scope)
	}
	if s := strings.TrimSpace(f.Search); s != "" {
		q.Set("search", s)
	}
	if f.Source != "" {
		q.Set("source_branch", f.Source)
	}
	var list []apiMR
	if err := c.do(ctx, http.MethodGet, projectPath(path)+"/merge_requests", q, nil, &list); err != nil {
		return nil, err
	}
	out := make([]MergeRequest, 0, len(list))
	for _, m := range list {
		out = append(out, m.summary())
	}
	return out, nil
}

// MergeRequest lê um merge request com aprovações e comentários.
func (c *Client) MergeRequest(ctx context.Context, path string, iid int) (MergeRequestDetail, error) {
	base := fmt.Sprintf("%s/merge_requests/%d", projectPath(path), iid)
	var m apiMR
	if err := c.do(ctx, http.MethodGet, base, nil, nil, &m); err != nil {
		return MergeRequestDetail{}, err
	}
	d := MergeRequestDetail{
		MergeRequest: m.summary(), Description: m.Description,
		SourceProjectID: m.SourceProjectID, TargetProjectID: m.TargetProjectID,
		ApprovedBy: []User{}, Notes: []Note{},
	}
	if m.DiffRefs != nil {
		d.BaseSHA, d.HeadSHA, d.StartSHA = m.DiffRefs.BaseSHA, m.DiffRefs.HeadSHA, m.DiffRefs.StartSHA
	}
	if m.MergedBy != nil {
		u := m.MergedBy.conv()
		d.MergedBy = &u
	}
	// Aprovações: no GitLab sem o recurso (ou sem permissão) a chamada falha; aí a seção só não aparece.
	var ap struct {
		ApprovalsLeft int `json:"approvals_left"`
		ApprovedBy    []struct {
			User apiUser `json:"user"`
		} `json:"approved_by"`
	}
	if err := c.do(ctx, http.MethodGet, base+"/approvals", nil, nil, &ap); err == nil {
		d.ApprovalsLeft = ap.ApprovalsLeft
		for _, a := range ap.ApprovedBy {
			d.ApprovedBy = append(d.ApprovedBy, a.User.conv())
		}
	}
	notes, err := c.notes(ctx, base)
	if err != nil {
		return MergeRequestDetail{}, err
	}
	d.Notes = notes
	return d, nil
}

func (c *Client) notes(ctx context.Context, base string) ([]Note, error) {
	out := []Note{}
	for page := 1; page <= 10; page++ { // até 1000 comentários
		var list []struct {
			ID        int     `json:"id"`
			Body      string  `json:"body"`
			Author    apiUser `json:"author"`
			CreatedAt string  `json:"created_at"`
			System    bool    `json:"system"`
			Position  *struct {
				NewPath string `json:"new_path"`
				OldPath string `json:"old_path"`
				NewLine int    `json:"new_line"`
				OldLine int    `json:"old_line"`
			} `json:"position"`
		}
		q := url.Values{"sort": {"asc"}, "order_by": {"created_at"}, "per_page": {"100"}, "page": {strconv.Itoa(page)}}
		if err := c.do(ctx, http.MethodGet, base+"/notes", q, nil, &list); err != nil {
			return nil, err
		}
		for _, n := range list {
			note := Note{ID: n.ID, Body: n.Body, Author: n.Author.conv(), CreatedAt: n.CreatedAt, System: n.System}
			if p := n.Position; p != nil {
				note.Path, note.Line = p.NewPath, p.NewLine
				if note.Line == 0 {
					note.Path, note.Line = p.OldPath, p.OldLine
				}
			}
			out = append(out, note)
		}
		if len(list) < 100 {
			break
		}
	}
	return out, nil
}

// CreateRequest é o formulário de novo merge request.
type CreateRequest struct {
	SourceBranch       string `json:"sourceBranch"`
	TargetBranch       string `json:"targetBranch"`
	Title              string `json:"title"`
	Description        string `json:"description"`
	Draft              bool   `json:"draft"`
	ReviewerIDs        []int  `json:"reviewerIds"`
	AssignToMe         bool   `json:"assignToMe"`
	RemoveSourceBranch bool   `json:"removeSourceBranch"`
	Squash             bool   `json:"squash"`
}

// DraftTitle põe (ou mantém) o prefixo de rascunho que o GitLab reconhece.
func DraftTitle(title string, draft bool) string {
	title = strings.TrimSpace(title)
	low := strings.ToLower(title)
	has := strings.HasPrefix(low, "draft:") || strings.HasPrefix(low, "[draft]") || strings.HasPrefix(low, "(draft)")
	if draft && !has {
		return "Draft: " + title
	}
	return title
}

// CreateMergeRequest abre o merge request.
func (c *Client) CreateMergeRequest(ctx context.Context, path string, r CreateRequest, me User) (MergeRequest, error) {
	if strings.TrimSpace(r.Title) == "" {
		return MergeRequest{}, errors.New("o merge request precisa de um título")
	}
	if r.SourceBranch == "" || r.TargetBranch == "" {
		return MergeRequest{}, errors.New("escolha a branch de origem e a de destino")
	}
	if r.SourceBranch == r.TargetBranch {
		return MergeRequest{}, errors.New("a branch de origem e a de destino são a mesma")
	}
	body := map[string]any{
		"source_branch":        r.SourceBranch,
		"target_branch":        r.TargetBranch,
		"title":                DraftTitle(r.Title, r.Draft),
		"description":          r.Description,
		"remove_source_branch": r.RemoveSourceBranch,
		"squash":               r.Squash,
	}
	if len(r.ReviewerIDs) > 0 {
		body["reviewer_ids"] = r.ReviewerIDs
	}
	if r.AssignToMe && me.ID != 0 {
		body["assignee_id"] = me.ID
	}
	var m apiMR
	if err := c.do(ctx, http.MethodPost, projectPath(path)+"/merge_requests", nil, body, &m); err != nil {
		var ae *APIError
		if errors.As(err, &ae) && ae.Status == http.StatusConflict {
			return MergeRequest{}, &APIError{Status: ae.Status, Msg: "já existe um merge request aberto desta branch: " + strings.TrimPrefix(ae.Msg, "o GitLab recusou (409): ")}
		}
		return MergeRequest{}, err
	}
	return m.summary(), nil
}

// Comment publica um comentário geral no merge request.
func (c *Client) Comment(ctx context.Context, path string, iid int, body string) (Note, error) {
	if strings.TrimSpace(body) == "" {
		return Note{}, errors.New("o comentário está vazio")
	}
	var n struct {
		ID        int     `json:"id"`
		Body      string  `json:"body"`
		Author    apiUser `json:"author"`
		CreatedAt string  `json:"created_at"`
	}
	if err := c.do(ctx, http.MethodPost, fmt.Sprintf("%s/merge_requests/%d/notes", projectPath(path), iid), nil, map[string]string{"body": body}, &n); err != nil {
		return Note{}, err
	}
	return Note{ID: n.ID, Body: n.Body, Author: n.Author.conv(), CreatedAt: n.CreatedAt}, nil
}

// Members busca pessoas do projeto (para escolher revisores).
func (c *Client) Members(ctx context.Context, path, query string) ([]User, error) {
	q := url.Values{"per_page": {"20"}}
	if s := strings.TrimSpace(query); s != "" {
		q.Set("query", s)
	}
	var list []apiUser
	if err := c.do(ctx, http.MethodGet, projectPath(path)+"/members/all", q, nil, &list); err != nil {
		return nil, err
	}
	return convUsers(list), nil
}
