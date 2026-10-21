package gitx

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"prumo/internal/events"
	"prumo/internal/workspace"
)

// ---------------------------------------------------------------- branches

// Branch é uma branch local ou remota.
type Branch struct {
	Name     string `json:"name"`     // "main", "origin/main"
	Remote   bool   `json:"remote"`   //
	Current  bool   `json:"current"`  //
	Upstream string `json:"upstream"` // só locais
	Ahead    int    `json:"ahead"`
	Behind   int    `json:"behind"`
	Gone     bool   `json:"gone"` // upstream apagado no remoto
	Date     int64  `json:"date"` // último commit, Unix s
}

// Branches é o conteúdo do popup de branches.
type Branches struct {
	Current   string   `json:"current"` // "" = detached
	Head      string   `json:"head"`
	Local     []Branch `json:"local"`
	Remote    []Branch `json:"remote"`
	Remotes   []string `json:"remotes"`
	Operation string   `json:"operation"`
}

var trackRe = regexp.MustCompile(`(ahead|behind) (\d+)`)

// Branches lista branches locais e remotas, mais recentes primeiro.
func (g *Git) Branches(projectID string) (Branches, error) {
	ctx := context.Background()
	top, err := g.repoOf(ctx, projectID, false)
	if err != nil {
		return Branches{}, err
	}
	out, err := g.run(ctx, top, true, "for-each-ref", "--sort=-committerdate",
		"--format=%(refname)%00%(refname:short)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(HEAD)%00%(committerdate:unix)",
		"refs/heads", "refs/remotes")
	if err != nil {
		return Branches{}, err
	}
	b := Branches{Local: []Branch{}, Remote: []Branch{}, Remotes: []string{}}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		f := strings.Split(line, "\x00")
		if len(f) < 6 {
			continue
		}
		ref, short, up, track, head := f[0], f[1], f[2], f[3], f[4]
		date, _ := strconv.ParseInt(f[5], 10, 64)
		if strings.HasSuffix(ref, "/HEAD") {
			continue // origin/HEAD é só um apelido
		}
		br := Branch{Name: short, Upstream: up, Date: date, Current: head == "*", Gone: track == "gone"}
		for _, m := range trackRe.FindAllStringSubmatch(track, -1) {
			n, _ := strconv.Atoi(m[2])
			if m[1] == "ahead" {
				br.Ahead = n
			} else {
				br.Behind = n
			}
		}
		if strings.HasPrefix(ref, "refs/remotes/") {
			br.Remote = true
			b.Remote = append(b.Remote, br)
		} else {
			b.Local = append(b.Local, br)
			if br.Current {
				b.Current = short
			}
		}
	}
	if rs, err := g.run(ctx, top, true, "remote"); err == nil {
		for _, r := range strings.Fields(string(rs)) {
			b.Remotes = append(b.Remotes, r)
		}
	}
	if h, err := g.run(ctx, top, true, "rev-parse", "--short", "HEAD"); err == nil {
		b.Head = strings.TrimSpace(string(h))
	}
	b.Operation = g.operation(ctx, top)
	return b, nil
}

// CheckoutResult diz se trocou de branch ou o que impediu.
type CheckoutResult struct {
	OK           bool     `json:"ok"`
	LocalChanges []string `json:"localChanges"` // arquivos que seriam sobrescritos (modo normal)
	Message      string   `json:"message"`      // aviso para o usuário (ex.: conflito ao devolver o stash)
}

var overwrittenRe = regexp.MustCompile(`(?s)would be overwritten by (?:checkout|switch):\n(.*?)\nPlease`)

// Checkout troca de branch. mode: normal (recusa se perder mudanças), smart (guarda as mudanças,
// troca e devolve) ou force (descarta as mudanças locais). Branch remota vira local com tracking.
func (g *Git) Checkout(projectID, ref, mode string) (CheckoutResult, error) {
	ctx := context.Background()
	top, err := g.repoOf(ctx, projectID, true)
	if err != nil {
		return CheckoutResult{}, err
	}
	lock := g.repoLock(top)
	lock.Lock()
	defer lock.Unlock()
	defer g.changed(projectID)

	args := []string{"switch"}
	if rest, ok := remoteBranch(ctx, g, top, ref); ok {
		// "origin/x" sem "x" local: cria a local acompanhando a remota.
		if _, err := g.run(ctx, top, true, "rev-parse", "--verify", "--quiet", "refs/heads/"+rest); err != nil {
			args = append(args, "--track", ref)
		} else {
			args = append(args, rest)
		}
	} else {
		args = append(args, ref)
	}

	switch mode {
	case "force":
		args = append(args[:1], append([]string{"--discard-changes"}, args[1:]...)...)
	case "smart":
		dirty, err := g.run(ctx, top, true, "status", "--porcelain")
		if err != nil {
			return CheckoutResult{}, err
		}
		if len(strings.TrimSpace(string(dirty))) == 0 {
			break
		}
		if _, err := g.run(ctx, top, false, "stash", "push", "--include-untracked", "-m", "prumo: troca de branch"); err != nil {
			return CheckoutResult{}, err
		}
		if _, err := g.run(ctx, top, false, args...); err != nil {
			_, _ = g.run(ctx, top, false, "stash", "pop") // devolve onde estava
			return CheckoutResult{}, err
		}
		if _, err := g.run(ctx, top, false, "stash", "pop"); err != nil {
			return CheckoutResult{OK: true, Message: "Trocou de branch, mas suas mudanças conflitaram com a nova branch. Elas ficaram guardadas no stash e os conflitos estão marcados nos arquivos."}, nil
		}
		return CheckoutResult{OK: true}, nil
	}

	if _, err := g.run(ctx, top, false, args...); err != nil {
		var ge *gitError
		if errors.As(err, &ge) {
			if m := overwrittenRe.FindStringSubmatch(ge.stderr); m != nil {
				var files []string
				for _, f := range strings.Split(m[1], "\n") {
					if f = strings.TrimSpace(f); f != "" {
						files = append(files, f)
					}
				}
				return CheckoutResult{LocalChanges: files}, nil
			}
		}
		return CheckoutResult{}, err
	}
	return CheckoutResult{OK: true}, nil
}

// remoteBranch diz se ref é "<remoto>/<branch>" e devolve a branch.
func remoteBranch(ctx context.Context, g *Git, top, ref string) (string, bool) {
	out, err := g.run(ctx, top, true, "remote")
	if err != nil {
		return "", false
	}
	for _, r := range strings.Fields(string(out)) {
		if strings.HasPrefix(ref, r+"/") {
			if _, err := g.run(ctx, top, true, "rev-parse", "--verify", "--quiet", "refs/remotes/"+ref); err == nil {
				return strings.TrimPrefix(ref, r+"/"), true
			}
		}
	}
	return "", false
}

// CreateBranch cria uma branch a partir de from ("" = HEAD) e, se pedido, troca para ela.
func (g *Git) CreateBranch(projectID, name, from string, checkout bool) error {
	ctx := context.Background()
	top, err := g.repoOf(ctx, projectID, true)
	if err != nil {
		return err
	}
	if _, err := g.run(ctx, top, true, "check-ref-format", "--branch", name); err != nil {
		return fmt.Errorf("nome de branch inválido: %q", name)
	}
	lock := g.repoLock(top)
	lock.Lock()
	defer lock.Unlock()
	defer g.changed(projectID)
	args := []string{"branch", name}
	if checkout {
		args = []string{"switch", "-c", name}
	}
	if from != "" {
		if err := validRev(from); err != nil {
			return err
		}
		args = append(args, from)
	}
	_, err = g.run(ctx, top, false, args...)
	return err
}

// RenameBranch renomeia uma branch local.
func (g *Git) RenameBranch(projectID, oldName, newName string) error {
	ctx := context.Background()
	top, err := g.repoOf(ctx, projectID, true)
	if err != nil {
		return err
	}
	if _, err := g.run(ctx, top, true, "check-ref-format", "--branch", newName); err != nil {
		return fmt.Errorf("nome de branch inválido: %q", newName)
	}
	lock := g.repoLock(top)
	lock.Lock()
	defer lock.Unlock()
	defer g.changed(projectID)
	_, err = g.run(ctx, top, false, "branch", "-m", oldName, newName)
	return err
}

// DeleteResult devolve o commit da branch apagada (para desfazer) ou avisa que ela tem commits não integrados.
type DeleteResult struct {
	Deleted   bool   `json:"deleted"`
	Hash      string `json:"hash"`
	NotMerged bool   `json:"notMerged"`
}

// DeleteBranch apaga uma branch local. Sem force, recusa se ela tiver commits que não estão em outra branch.
func (g *Git) DeleteBranch(projectID, name string, force bool) (DeleteResult, error) {
	ctx := context.Background()
	top, err := g.repoOf(ctx, projectID, true)
	if err != nil {
		return DeleteResult{}, err
	}
	lock := g.repoLock(top)
	lock.Lock()
	defer lock.Unlock()
	defer g.changed(projectID)
	h, err := g.run(ctx, top, true, "rev-parse", "refs/heads/"+name)
	if err != nil {
		return DeleteResult{}, fmt.Errorf("branch %q não existe", name)
	}
	flag := "-d"
	if force {
		flag = "-D"
	}
	if _, err := g.run(ctx, top, false, "branch", flag, name); err != nil {
		var ge *gitError
		if errors.As(err, &ge) && strings.Contains(ge.stderr, "not fully merged") {
			return DeleteResult{NotMerged: true}, nil
		}
		return DeleteResult{}, err
	}
	return DeleteResult{Deleted: true, Hash: strings.TrimSpace(string(h))}, nil
}

// RestoreBranch recria uma branch apagada no commit em que estava.
func (g *Git) RestoreBranch(projectID, name, hash string) error {
	return g.CreateBranch(projectID, name, hash, false)
}

// ---------------------------------------------------------------- sync

// OpResult é o resultado de fetch, update e push.
type OpResult struct {
	OK        bool     `json:"ok"`
	Message   string   `json:"message"`
	Rejected  bool     `json:"rejected"`  // push recusado: o remoto tem commits que você não tem
	Conflicts []string `json:"conflicts"` // update parou em conflito
	Operation string   `json:"operation"` // merge | rebase em andamento
}

// Fetch busca os remotos e apaga as referências de branches que sumiram.
func (g *Git) Fetch(projectID string) (OpResult, error) {
	ctx := context.Background()
	top, err := g.repoOf(ctx, projectID, true)
	if err != nil {
		return OpResult{}, err
	}
	lock := g.repoLock(top)
	lock.Lock()
	defer lock.Unlock()
	defer g.changed(projectID)
	if _, err := g.run(ctx, top, false, "fetch", "--all", "--prune"); err != nil {
		return OpResult{}, err
	}
	return OpResult{OK: true}, nil
}

// Update traz a branch atual em dia com o upstream (merge ou rebase).
func (g *Git) Update(projectID, mode string) (OpResult, error) {
	ctx := context.Background()
	top, err := g.repoOf(ctx, projectID, true)
	if err != nil {
		return OpResult{}, err
	}
	lock := g.repoLock(top)
	lock.Lock()
	defer lock.Unlock()
	defer g.changed(projectID)
	if _, err := g.run(ctx, top, true, "rev-parse", "--abbrev-ref", "@{u}"); err != nil {
		return OpResult{}, errors.New("a branch atual não acompanha nenhuma branch remota: faça push com \"acompanhar\" primeiro")
	}
	flag := "--no-rebase"
	if mode == "rebase" {
		flag = "--rebase"
	}
	out, err := g.run(ctx, top, false, "pull", "--no-edit", flag)
	if err != nil {
		if files := g.conflictFiles(ctx, top); len(files) > 0 {
			return OpResult{Conflicts: files, Operation: g.operation(ctx, top),
				Message: fmt.Sprintf("%d arquivo(s) em conflito. Resolva e conclua, ou aborte.", len(files))}, nil
		}
		return OpResult{}, err
	}
	msg := "Já estava em dia."
	if !strings.Contains(string(out), "Already up to date") {
		msg = "Atualizado."
	}
	return OpResult{OK: true, Message: msg}, nil
}

func (g *Git) conflictFiles(ctx context.Context, top string) []string {
	out, err := g.run(ctx, top, true, "diff", "--name-only", "--diff-filter=U")
	if err != nil {
		return nil
	}
	var files []string
	for _, f := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if f != "" {
			files = append(files, f)
		}
	}
	return files
}

// AbortOperation desfaz um merge, rebase ou cherry-pick parado em conflito.
func (g *Git) AbortOperation(projectID string) error {
	ctx := context.Background()
	top, err := g.repoOf(ctx, projectID, true)
	if err != nil {
		return err
	}
	lock := g.repoLock(top)
	lock.Lock()
	defer lock.Unlock()
	defer g.changed(projectID)
	op := g.operation(ctx, top)
	if op == "" {
		return errors.New("não há operação em andamento")
	}
	_, err = g.run(ctx, top, false, op, "--abort")
	return err
}

// Commit de saída (para o diálogo de push).
type OutCommit struct {
	Hash    string `json:"hash"`
	Subject string `json:"subject"`
	Author  string `json:"author"`
	Date    int64  `json:"date"`
}

// Outgoing é o que o push vai mandar.
type Outgoing struct {
	Branch      string      `json:"branch"`
	Remote      string      `json:"remote"` // remoto sugerido
	Target      string      `json:"target"` // branch de destino sugerida
	HasUpstream bool        `json:"hasUpstream"`
	Remotes     []string    `json:"remotes"`
	Commits     []OutCommit `json:"commits"`
}

// Outgoing lista os commits que ainda não estão no remoto.
func (g *Git) Outgoing(projectID string) (Outgoing, error) {
	ctx := context.Background()
	top, err := g.repoOf(ctx, projectID, false)
	if err != nil {
		return Outgoing{}, err
	}
	o := Outgoing{Commits: []OutCommit{}, Remotes: []string{}}
	if b, err := g.run(ctx, top, true, "symbolic-ref", "--short", "-q", "HEAD"); err == nil {
		o.Branch = strings.TrimSpace(string(b))
	}
	if rs, err := g.run(ctx, top, true, "remote"); err == nil {
		o.Remotes = strings.Fields(string(rs))
	}
	rangeArgs := []string{"HEAD", "--not", "--remotes"}
	if up, err := g.run(ctx, top, true, "rev-parse", "--abbrev-ref", "@{u}"); err == nil {
		u := strings.TrimSpace(string(up))
		o.HasUpstream = true
		if i := strings.IndexByte(u, '/'); i > 0 {
			o.Remote, o.Target = u[:i], u[i+1:]
		}
		rangeArgs = []string{"@{u}..HEAD"}
	} else {
		o.Target = o.Branch
		if len(o.Remotes) > 0 {
			o.Remote = o.Remotes[0]
			for _, r := range o.Remotes {
				if r == "origin" {
					o.Remote = r
				}
			}
		}
	}
	out, err := g.run(ctx, top, true, append([]string{"log", "--format=%h%x00%s%x00%an%x00%ct", "-n", "500"}, rangeArgs...)...)
	if err != nil {
		return o, nil // repositório sem commits
	}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		f := strings.SplitN(line, "\x00", 4)
		if len(f) == 4 {
			d, _ := strconv.ParseInt(f[3], 10, 64)
			o.Commits = append(o.Commits, OutCommit{Hash: f[0], Subject: f[1], Author: f[2], Date: d})
		}
	}
	return o, nil
}

// PushRequest é o que o diálogo de push envia.
type PushRequest struct {
	Remote      string `json:"remote"`
	Target      string `json:"target"`      // branch de destino no remoto
	SetUpstream bool   `json:"setUpstream"` // passar a acompanhar a remota
	Force       bool   `json:"force"`       // --force-with-lease: só sobrescreve se o remoto não mudou desde o último fetch
	Tags        bool   `json:"tags"`
}

// Push envia a branch atual.
func (g *Git) Push(projectID string, req PushRequest) (OpResult, error) {
	ctx := context.Background()
	top, err := g.repoOf(ctx, projectID, true)
	if err != nil {
		return OpResult{}, err
	}
	if req.Remote == "" || req.Target == "" {
		return OpResult{}, errors.New("escolha o remoto e a branch de destino")
	}
	if _, err := g.run(ctx, top, true, "check-ref-format", "--branch", req.Target); err != nil {
		return OpResult{}, fmt.Errorf("nome de branch inválido: %q", req.Target)
	}
	lock := g.repoLock(top)
	lock.Lock()
	defer lock.Unlock()
	defer g.changed(projectID)
	args := []string{"push", "--porcelain"}
	if req.SetUpstream {
		args = append(args, "--set-upstream")
	}
	if req.Force {
		args = append(args, "--force-with-lease")
	}
	if req.Tags {
		args = append(args, "--follow-tags")
	}
	args = append(args, req.Remote, "HEAD:refs/heads/"+req.Target)
	out, err := g.run(ctx, top, false, args...)
	if err != nil {
		var ge *gitError
		text := string(out)
		if errors.As(err, &ge) {
			text += ge.stderr
		}
		if strings.Contains(text, "[rejected]") || strings.Contains(text, "non-fast-forward") || strings.Contains(text, "fetch first") || strings.Contains(text, "stale info") {
			return OpResult{Rejected: true, Message: "O remoto tem commits que você ainda não tem. Atualize (merge ou rebase) e tente de novo."}, nil
		}
		return OpResult{}, err
	}
	return OpResult{OK: true, Message: "Push concluído."}, nil
}

// ---------------------------------------------------------------- conteúdo no HEAD

// HeadFile é o conteúdo de um arquivo no último commit (marcadores de mudança no gutter).
type HeadFile struct {
	Tracked bool   `json:"tracked"`
	Content string `json:"content"`
}

// HeadContent devolve o arquivo como está no HEAD.
func (g *Git) HeadContent(projectID, path string) (HeadFile, error) {
	ctx := context.Background()
	o, err := g.reg.Get(projectID)
	if err != nil {
		return HeadFile{}, err
	}
	top, err := g.toplevel(ctx, o)
	if errors.Is(err, ErrNotRepo) {
		return HeadFile{}, nil
	}
	if err != nil {
		return HeadFile{}, err
	}
	abs, err := o.Abs(path)
	if err != nil {
		return HeadFile{}, err
	}
	rel, err := filepath.Rel(top, abs)
	if err != nil {
		return HeadFile{}, err
	}
	out, err := g.run(ctx, top, true, "show", "HEAD:"+filepath.ToSlash(rel))
	if err != nil {
		return HeadFile{}, nil // arquivo novo (ou repositório sem commit)
	}
	if strings.ContainsRune(string(out), 0) {
		return HeadFile{}, nil // binário: sem marcadores
	}
	return HeadFile{Tracked: true, Content: string(out)}, nil
}

// ---------------------------------------------------------------- comum

// repoOf devolve a raiz do repositório do projeto, exigindo confiança quando a operação roda hooks
// ou fala com remotos (que podem executar helpers configurados no repositório).
func (g *Git) repoOf(ctx context.Context, projectID string, needTrust bool) (string, error) {
	var o *workspace.Open
	var err error
	if needTrust {
		o, err = g.reg.RequireTrusted(projectID)
	} else {
		o, err = g.reg.Get(projectID)
	}
	if err != nil {
		return "", err
	}
	return g.toplevel(ctx, o)
}

func (g *Git) changed(projectID string) {
	g.bus.Emit(events.GitStatus, map[string]string{"projectId": projectID})
}

// sshBatch impede que o ssh fique esperando senha num terminal que não existe.
func sshBatch() []string {
	if os.Getenv("GIT_SSH_COMMAND") != "" {
		return nil
	}
	return []string{"GIT_SSH_COMMAND=ssh -o BatchMode=yes"}
}
