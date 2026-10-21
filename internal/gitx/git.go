// Package gitx é o serviço git da IDE, sobre a CLI do git do usuário.
//
// Leituras rodam em paralelo; escritas passam por um mutex por repositório para que a
// própria IDE nunca dispute o index.lock consigo mesma.
package gitx

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"goide/internal/events"
	"goide/internal/workspace"
)

// ErrNotRepo: o projeto não está dentro de um repositório git.
var ErrNotRepo = errors.New("o projeto não está num repositório git")

// Git é o serviço exposto à UI.
type Git struct {
	reg    *workspace.Registry
	bus    *events.Bus
	gitExe func() string

	mu    sync.Mutex
	locks map[string]*sync.Mutex
}

// New cria o serviço. gitExe devolve o caminho do binário do git ("" = não instalado).
func New(reg *workspace.Registry, bus *events.Bus, gitExe func() string) *Git {
	return &Git{reg: reg, bus: bus, gitExe: gitExe, locks: map[string]*sync.Mutex{}}
}

func (g *Git) repoLock(top string) *sync.Mutex {
	g.mu.Lock()
	defer g.mu.Unlock()
	l, ok := g.locks[top]
	if !ok {
		l = &sync.Mutex{}
		g.locks[top] = l
	}
	return l
}

// gitError carrega o stderr do git, que é o que o usuário precisa ler.
type gitError struct {
	args   []string
	stderr string
	err    error
}

func (e *gitError) Error() string {
	msg := strings.TrimSpace(e.stderr)
	if msg == "" {
		msg = e.err.Error()
	}
	return fmt.Sprintf("git %s: %s", e.args[0], msg)
}

func (g *Git) run(ctx context.Context, dir string, readOnly bool, args ...string) ([]byte, error) {
	return g.runWith(ctx, dir, readOnly, nil, nil, args...)
}

// runWith é o run com variáveis de ambiente a mais (ex.: GIT_INDEX_FILE) e uma entrada.
func (g *Git) runWith(ctx context.Context, dir string, readOnly bool, env []string, stdin []byte, args ...string) ([]byte, error) {
	exe := g.gitExe()
	if exe == "" {
		return nil, errors.New("git não encontrado no PATH")
	}
	cctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(cctx, exe, args...)
	cmd.Dir = dir
	cmd.Env = append(append(os.Environ(), "LC_ALL=C", "GIT_TERMINAL_PROMPT=0"), sshBatch()...)
	if readOnly {
		cmd.Env = append(cmd.Env, "GIT_OPTIONAL_LOCKS=0")
	}
	cmd.Env = append(cmd.Env, env...)
	if stdin != nil {
		cmd.Stdin = bytes.NewReader(stdin)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		return stdout.Bytes(), &gitError{args: args, stderr: stderr.String(), err: err}
	}
	return stdout.Bytes(), nil
}

// toplevel devolve a raiz do repositório que contém o projeto.
func (g *Git) toplevel(ctx context.Context, o *workspace.Open) (string, error) {
	out, err := g.run(ctx, o.RootPath, true, "rev-parse", "--show-toplevel")
	if err != nil {
		var ge *gitError
		if errors.As(err, &ge) && strings.Contains(ge.stderr, "not a git repository") {
			return "", ErrNotRepo
		}
		return "", err
	}
	top := strings.TrimSpace(string(out))
	if real, err := filepath.EvalSymlinks(top); err == nil {
		top = real
	}
	return top, nil
}

// ---------------------------------------------------------------- status

// FileChange é um arquivo com mudança.
type FileChange struct {
	Path     string `json:"path"`     // relativo ao projeto
	OrigPath string `json:"origPath"` // renomes
	Kind     string `json:"kind"`     // added | modified | deleted | renamed | untracked | conflict
	Staged   bool   `json:"staged"`
	Unstaged bool   `json:"unstaged"`
}

// RepoStatus é o estado do repositório do projeto.
type RepoStatus struct {
	IsRepo    bool         `json:"isRepo"`
	Branch    string       `json:"branch"` // "" quando detached
	Head      string       `json:"head"`   // hash curto, "" antes do primeiro commit
	Upstream  string       `json:"upstream"`
	Ahead     int          `json:"ahead"`
	Behind    int          `json:"behind"`
	Operation string       `json:"operation"` // "" | merge | rebase | cherry-pick | revert
	Files     []FileChange `json:"files"`
}

// Status lê o estado atual do repositório do projeto.
func (g *Git) Status(projectID string) (RepoStatus, error) {
	ctx := context.Background()
	o, err := g.reg.Get(projectID)
	if err != nil {
		return RepoStatus{}, err
	}
	top, err := g.toplevel(ctx, o)
	if errors.Is(err, ErrNotRepo) {
		return RepoStatus{Files: []FileChange{}}, nil
	}
	if err != nil {
		return RepoStatus{}, err
	}
	out, err := g.run(ctx, top, true, "status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all")
	if err != nil {
		return RepoStatus{}, err
	}
	st, err := ParseStatus(out)
	if err != nil {
		return RepoStatus{}, err
	}
	st.Operation = g.operation(ctx, top)
	// Caminhos do git são relativos ao topo do repositório; a UI fala em caminhos do projeto.
	files := st.Files[:0]
	for _, f := range st.Files {
		rel, err := o.Rel(filepath.Join(top, filepath.FromSlash(f.Path)))
		if err != nil || rel == "" {
			continue
		}
		f.Path = rel
		if f.OrigPath != "" {
			if r, err := o.Rel(filepath.Join(top, filepath.FromSlash(f.OrigPath))); err == nil {
				f.OrigPath = r
			}
		}
		files = append(files, f)
	}
	st.Files = files
	return st, nil
}

func (g *Git) operation(ctx context.Context, top string) string {
	out, err := g.run(ctx, top, true, "rev-parse", "--absolute-git-dir")
	if err != nil {
		return ""
	}
	gitDir := strings.TrimSpace(string(out))
	for _, c := range []struct{ file, op string }{
		{"rebase-merge", "rebase"}, {"rebase-apply", "rebase"}, {"MERGE_HEAD", "merge"},
		{"CHERRY_PICK_HEAD", "cherry-pick"}, {"REVERT_HEAD", "revert"},
	} {
		if _, err := os.Stat(filepath.Join(gitDir, c.file)); err == nil {
			return c.op
		}
	}
	return ""
}

// ParseStatus interpreta a saída de "git status --porcelain=v2 -z --branch".
func ParseStatus(out []byte) (RepoStatus, error) {
	st := RepoStatus{IsRepo: true, Files: []FileChange{}}
	fields := strings.Split(string(out), "\x00")
	for i := 0; i < len(fields); i++ {
		line := fields[i]
		if line == "" {
			continue
		}
		switch line[0] {
		case '#':
			parseBranchHeader(&st, line)
		case '1':
			p := strings.SplitN(line, " ", 9)
			if len(p) != 9 {
				return st, fmt.Errorf("linha de status inválida: %q", line)
			}
			st.Files = append(st.Files, change(p[1], p[8], ""))
		case '2':
			p := strings.SplitN(line, " ", 10)
			if len(p) != 10 || i+1 >= len(fields) {
				return st, fmt.Errorf("linha de renome inválida: %q", line)
			}
			i++ // com -z, o caminho original vem no campo seguinte
			st.Files = append(st.Files, change(p[1], p[9], fields[i]))
		case 'u':
			p := strings.SplitN(line, " ", 11)
			if len(p) != 11 {
				return st, fmt.Errorf("linha de conflito inválida: %q", line)
			}
			st.Files = append(st.Files, FileChange{Path: p[10], Kind: "conflict", Unstaged: true})
		case '?':
			st.Files = append(st.Files, FileChange{Path: line[2:], Kind: "untracked", Unstaged: true})
		case '!':
			// ignorados não aparecem na lista de mudanças
		}
	}
	return st, nil
}

func parseBranchHeader(st *RepoStatus, line string) {
	p := strings.SplitN(line, " ", 3)
	if len(p) < 3 {
		return
	}
	switch p[1] {
	case "branch.oid":
		if p[2] != "(initial)" && len(p[2]) >= 7 {
			st.Head = p[2][:7]
		}
	case "branch.head":
		if p[2] != "(detached)" {
			st.Branch = p[2]
		}
	case "branch.upstream":
		st.Upstream = p[2]
	case "branch.ab":
		fmt.Sscanf(p[2], "+%d -%d", &st.Ahead, &st.Behind)
	}
}

func change(xy, path, orig string) FileChange {
	x, y := xy[0], xy[1]
	f := FileChange{Path: path, OrigPath: orig, Staged: x != '.', Unstaged: y != '.'}
	switch {
	case x == 'A':
		f.Kind = "added"
	case x == 'R' || x == 'C':
		f.Kind = "renamed"
	case x == 'D' || y == 'D':
		f.Kind = "deleted"
	default:
		f.Kind = "modified"
	}
	return f
}

// ---------------------------------------------------------------- commit

// CommitRequest é o que a janela de commit envia.
type CommitRequest struct {
	Files   []string `json:"files"` // relativos ao projeto; só estes entram no commit
	Message string   `json:"message"`
	Amend   bool     `json:"amend"`
	// Partial: arquivos que entram só com alguns trechos (caminho → conteúdo a commitar). O resto da
	// mudança fica no disco, sem commitar.
	Partial map[string]string `json:"partial"`
}

// CommitResult identifica o commit criado.
type CommitResult struct {
	Hash    string `json:"hash"`
	Summary string `json:"summary"`
}

// Commit grava um commit só com os arquivos escolhidos, do jeito que estão no disco.
// O que o usuário tiver no index para outros arquivos continua lá.
// Exige projeto confiável: hooks do git executam código do repositório.
func (g *Git) Commit(projectID string, req CommitRequest) (CommitResult, error) {
	ctx := context.Background()
	o, err := g.reg.RequireTrusted(projectID)
	if err != nil {
		return CommitResult{}, err
	}
	msg := strings.TrimSpace(req.Message)
	if msg == "" && !req.Amend {
		return CommitResult{}, errors.New("escreva uma mensagem de commit")
	}
	if len(req.Files) == 0 && !req.Amend {
		return CommitResult{}, errors.New("nenhum arquivo selecionado")
	}
	top, err := g.toplevel(ctx, o)
	if err != nil {
		return CommitResult{}, err
	}
	specs := make([]string, 0, len(req.Files))
	for _, p := range req.Files {
		abs, err := o.Abs(p)
		if err != nil {
			return CommitResult{}, err
		}
		rel, err := filepath.Rel(top, abs)
		if err != nil {
			return CommitResult{}, err
		}
		specs = append(specs, ":(literal)"+filepath.ToSlash(rel))
	}

	lock := g.repoLock(top)
	lock.Lock()
	defer lock.Unlock()

	if len(req.Partial) > 0 {
		if g.operation(ctx, top) != "" {
			return CommitResult{}, errors.New("commit parcial não é possível no meio de um merge ou rebase")
		}
		if err := g.commitPartial(ctx, o, top, specs, req, msg); err != nil {
			return CommitResult{}, err
		}
		return g.lastCommit(ctx, top, projectID)
	}

	if len(specs) > 0 {
		// Novos e apagados precisam estar no index para o "commit -- <paths>" enxergá-los.
		if _, err := g.run(ctx, top, false, append([]string{"add", "-A", "--"}, specs...)...); err != nil {
			return CommitResult{}, err
		}
	}
	args := []string{"commit"}
	if req.Amend {
		args = append(args, "--amend")
	}
	if msg != "" {
		args = append(args, "-m", req.Message)
	} else {
		args = append(args, "--no-edit")
	}
	// No meio de um merge o git não aceita commit parcial: os arquivos escolhidos já foram para o index
	// acima e o commit leva o index inteiro (o resultado do merge).
	if len(specs) > 0 && g.operation(ctx, top) != "merge" {
		args = append(append(args, "--"), specs...)
	}
	if _, err := g.run(ctx, top, false, args...); err != nil {
		return CommitResult{}, err
	}
	return g.lastCommit(ctx, top, projectID)
}

// lastCommit descreve o commit recém-criado e avisa a UI.
func (g *Git) lastCommit(ctx context.Context, top, projectID string) (CommitResult, error) {
	out, err := g.run(ctx, top, true, "log", "-1", "--format=%h%x00%s")
	if err != nil {
		return CommitResult{}, err
	}
	parts := strings.SplitN(strings.TrimSpace(string(out)), "\x00", 2)
	res := CommitResult{Hash: parts[0]}
	if len(parts) == 2 {
		res.Summary = parts[1]
	}
	g.bus.Emit(events.GitStatus, map[string]string{"projectId": projectID})
	return res, nil
}

// commitPartial commita usando um index temporário: parte do HEAD, entra cada arquivo inteiro de specs (como
// está no disco) e, dos parciais, o conteúdo escolhido. O index de verdade só é alinhado ao novo HEAD nos
// caminhos commitados: o que ficou de fora continua como mudança no disco.
func (g *Git) commitPartial(ctx context.Context, o *workspace.Open, top string, specs []string, req CommitRequest, msg string) error {
	tmp, err := os.CreateTemp("", "goide-index-*")
	if err != nil {
		return err
	}
	tmp.Close()
	os.Remove(tmp.Name()) // o git cria o arquivo; um arquivo vazio não é um index válido
	defer os.Remove(tmp.Name())
	env := []string{"GIT_INDEX_FILE=" + tmp.Name()}
	if _, err := g.runWith(ctx, top, false, env, nil, "read-tree", "HEAD"); err != nil {
		return err
	}
	partialSpec := map[string]bool{}
	var touched []string
	for path, content := range req.Partial {
		abs, err := o.Abs(path)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(top, abs)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		partialSpec[":(literal)"+rel] = true
		blob, err := g.runWith(ctx, top, false, nil, []byte(content), "hash-object", "-w", "--stdin")
		if err != nil {
			return err
		}
		mode := "100644"
		if st, err := os.Stat(abs); err == nil && st.Mode()&0o111 != 0 {
			mode = "100755"
		}
		if _, err := g.runWith(ctx, top, false, env, nil, "update-index", "--add", "--cacheinfo", mode+","+strings.TrimSpace(string(blob))+","+rel); err != nil {
			return err
		}
		touched = append(touched, ":(literal)"+rel)
	}
	var whole []string
	for _, sp := range specs {
		if !partialSpec[sp] {
			whole = append(whole, sp)
		}
	}
	if len(whole) > 0 {
		if _, err := g.runWith(ctx, top, false, env, nil, append([]string{"add", "-A", "--"}, whole...)...); err != nil {
			return err
		}
		touched = append(touched, whole...)
	}
	args := []string{"commit"}
	if req.Amend {
		args = append(args, "--amend")
	}
	if msg != "" {
		args = append(args, "-m", req.Message)
	} else {
		args = append(args, "--no-edit")
	}
	if _, err := g.runWith(ctx, top, false, env, nil, args...); err != nil {
		return err
	}
	// O index de verdade ainda tem a versão antiga desses caminhos: alinha ao HEAD novo (o disco não muda).
	_, err = g.run(ctx, top, false, append([]string{"reset", "-q", "--"}, touched...)...)
	return err
}

// ---------------------------------------------------------------- diff

// DiffContents alimenta o diff editor: HEAD à esquerda, disco à direita.
type DiffContents struct {
	Path   string `json:"path"`
	Left   string `json:"left"`
	Right  string `json:"right"`
	Binary bool   `json:"binary"`
}

// Diff compara a versão do HEAD com a do disco.
func (g *Git) Diff(projectID, path string) (DiffContents, error) {
	ctx := context.Background()
	o, err := g.reg.Get(projectID)
	if err != nil {
		return DiffContents{}, err
	}
	top, err := g.toplevel(ctx, o)
	if err != nil {
		return DiffContents{}, err
	}
	abs, err := o.Abs(path)
	if err != nil {
		return DiffContents{}, err
	}
	rel, err := filepath.Rel(top, abs)
	if err != nil {
		return DiffContents{}, err
	}
	d := DiffContents{Path: path}
	if left, err := g.run(ctx, top, true, "show", "HEAD:"+filepath.ToSlash(rel)); err == nil {
		d.Left = string(left)
	}
	if right, err := os.ReadFile(abs); err == nil {
		d.Right = string(right)
	}
	d.Binary = strings.ContainsRune(d.Left, 0) || strings.ContainsRune(d.Right, 0)
	if d.Binary {
		d.Left, d.Right = "", ""
	}
	return d, nil
}
