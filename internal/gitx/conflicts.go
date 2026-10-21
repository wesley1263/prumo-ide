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

	"goide/internal/proc"
)

// ---------------------------------------------------------------- conflitos (S25, S26)

// MergeChunk é um pedaço do resultado da mesclagem: texto já resolvido ou um conflito com as três versões.
type MergeChunk struct {
	Conflict bool   `json:"conflict"`
	Text     string `json:"text"` // quando não é conflito
	Ours     string `json:"ours"`
	Base     string `json:"base"`
	Theirs   string `json:"theirs"`
}

// MergeInput é o que o editor de 3 painéis precisa.
type MergeInput struct {
	Path        string       `json:"path"`
	Kind        string       `json:"kind"` // both-modified | both-added | deleted-by-us | deleted-by-them
	Ours        string       `json:"ours"`
	Base        string       `json:"base"`
	Theirs      string       `json:"theirs"`
	OursLabel   string       `json:"oursLabel"`
	TheirsLabel string       `json:"theirsLabel"`
	Chunks      []MergeChunk `json:"chunks"`
	Conflicts   int          `json:"conflicts"`
	Binary      bool         `json:"binary"`
	Operation   string       `json:"operation"`
}

// conflictRepo resolve o projeto, o repositório e o caminho relativo a ele.
func (g *Git) conflictRepo(ctx context.Context, projectID, path string, needTrust bool) (top, rel string, err error) {
	o, err := g.reg.Get(projectID)
	if err != nil {
		return "", "", err
	}
	if needTrust {
		if _, err := g.reg.RequireTrusted(projectID); err != nil {
			return "", "", err
		}
	}
	top, err = g.toplevel(ctx, o)
	if err != nil {
		return "", "", err
	}
	abs, err := o.Abs(path)
	if err != nil {
		return "", "", err
	}
	r, err := filepath.Rel(top, abs)
	if err != nil {
		return "", "", err
	}
	return top, filepath.ToSlash(r), nil
}

// stage lê uma versão do index (1 = base, 2 = nossa, 3 = deles). ok=false: não existe nesse lado.
func (g *Git) stage(ctx context.Context, top string, n int, rel string) (string, bool) {
	b, err := g.run(ctx, top, true, "show", fmt.Sprintf(":%d:%s", n, rel))
	if err != nil {
		return "", false
	}
	return string(b), true
}

// labels diz de quem é cada lado. No rebase o git inverte: "nossa" é a base nova e "deles" é o seu commit.
func (g *Git) labels(ctx context.Context, top, op string) (ours, theirs string) {
	branch := "HEAD"
	if b, err := g.run(ctx, top, true, "symbolic-ref", "--short", "-q", "HEAD"); err == nil {
		branch = strings.TrimSpace(string(b))
	}
	other := ""
	for _, ref := range []string{"MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD"} {
		if b, err := g.run(ctx, top, true, "name-rev", "--name-only", "--always", ref); err == nil {
			other = strings.TrimSpace(string(b))
			break
		}
	}
	if op == "rebase" {
		return "Base do rebase" + suffix(other), "Seu commit" + suffix(branch)
	}
	return "Suas mudanças" + suffix(branch), "Mudanças que chegaram" + suffix(other)
}

func suffix(name string) string {
	if name == "" || name == "undefined" {
		return ""
	}
	return " (" + name + ")"
}

// markerSize longo para não confundir com linhas do próprio arquivo parecidas com "<<<<<<<".
const markerSize = 32

// ConflictVersions devolve as três versões do arquivo em conflito e a mesclagem automática, em pedaços:
// o que não conflita já vem resolvido; cada conflito traz o trecho de cada lado.
func (g *Git) ConflictVersions(projectID, path string) (MergeInput, error) {
	ctx := context.Background()
	top, rel, err := g.conflictRepo(ctx, projectID, path, false)
	if err != nil {
		return MergeInput{}, err
	}
	in := MergeInput{Path: path, Chunks: []MergeChunk{}, Operation: g.operation(ctx, top)}
	base, hasBase := g.stage(ctx, top, 1, rel)
	ours, hasOurs := g.stage(ctx, top, 2, rel)
	theirs, hasTheirs := g.stage(ctx, top, 3, rel)
	switch {
	case !hasOurs && !hasTheirs:
		return MergeInput{}, errors.New("o arquivo não está em conflito")
	case !hasOurs:
		in.Kind = "deleted-by-us"
	case !hasTheirs:
		in.Kind = "deleted-by-them"
	case !hasBase:
		in.Kind = "both-added"
	default:
		in.Kind = "both-modified"
	}
	in.Base, in.Ours, in.Theirs = base, ours, theirs
	in.OursLabel, in.TheirsLabel = g.labels(ctx, top, in.Operation)
	if strings.ContainsRune(base+ours+theirs, 0) {
		in.Binary = true
		in.Base, in.Ours, in.Theirs = "", "", ""
		return in, nil
	}
	if in.Kind == "deleted-by-us" || in.Kind == "deleted-by-them" {
		return in, nil // não há o que mesclar linha a linha: é manter ou apagar
	}
	merged, n, err := mergeFile(ctx, g.gitExe(), ours, base, theirs)
	if err != nil {
		return MergeInput{}, err
	}
	in.Chunks, in.Conflicts = parseMerged(merged), n
	return in, nil
}

// mergeFile roda o git merge-file em arquivos temporários (a mesclagem de 3 vias do próprio git).
func mergeFile(ctx context.Context, gitExe, ours, base, theirs string) (string, int, error) {
	if gitExe == "" {
		return "", 0, errors.New("git não encontrado")
	}
	dir, err := os.MkdirTemp("", "goide-merge-*")
	if err != nil {
		return "", 0, err
	}
	defer os.RemoveAll(dir)
	files := []string{filepath.Join(dir, "ours"), filepath.Join(dir, "base"), filepath.Join(dir, "theirs")}
	for i, content := range []string{ours, base, theirs} {
		if err := os.WriteFile(files[i], []byte(content), 0o600); err != nil {
			return "", 0, err
		}
	}
	cmd := exec.CommandContext(ctx, gitExe, "merge-file", "-p", "--diff3", fmt.Sprintf("--marker-size=%d", markerSize),
		"-L", "ours", "-L", "base", "-L", "theirs", files[0], files[1], files[2])
	cmd.Env = append(os.Environ(), "LC_ALL=C")
	cmd.SysProcAttr = proc.Attr(false)
	var out, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &stderr
	err = cmd.Run()
	// O código de saída é o número de conflitos (0 = mesclou tudo); negativo/alto é erro de verdade.
	var ee *exec.ExitError
	switch {
	case err == nil:
		return out.String(), 0, nil
	case errors.As(err, &ee) && ee.ExitCode() > 0 && ee.ExitCode() < 128:
		return out.String(), ee.ExitCode(), nil
	default:
		return "", 0, fmt.Errorf("git merge-file: %v %s", err, strings.TrimSpace(stderr.String()))
	}
}

// parseMerged separa a saída do merge-file (estilo diff3) em texto resolvido e conflitos.
func parseMerged(merged string) []MergeChunk {
	open := strings.Repeat("<", markerSize) + " "
	mid := strings.Repeat("|", markerSize) + " "
	sep := strings.Repeat("=", markerSize)
	end := strings.Repeat(">", markerSize) + " "
	var chunks []MergeChunk
	var text strings.Builder
	var cur *MergeChunk
	section := 0 // 1 = nossa, 2 = base, 3 = deles
	flush := func() {
		if text.Len() > 0 {
			chunks = append(chunks, MergeChunk{Text: text.String()})
			text.Reset()
		}
	}
	for _, line := range strings.SplitAfter(merged, "\n") {
		if line == "" {
			continue
		}
		bare := strings.TrimRight(line, "\r\n")
		switch {
		case cur == nil && strings.HasPrefix(bare, open):
			flush()
			cur, section = &MergeChunk{Conflict: true}, 1
		case cur != nil && strings.HasPrefix(bare, mid):
			section = 2
		case cur != nil && bare == sep:
			section = 3
		case cur != nil && strings.HasPrefix(bare, end):
			chunks = append(chunks, *cur)
			cur, section = nil, 0
		case cur != nil && section == 1:
			cur.Ours += line
		case cur != nil && section == 2:
			cur.Base += line
		case cur != nil && section == 3:
			cur.Theirs += line
		default:
			text.WriteString(line)
		}
	}
	flush()
	if chunks == nil {
		chunks = []MergeChunk{}
	}
	return chunks
}

// ResolveConflict marca o arquivo como resolvido. side: "content" grava o resultado da mesclagem; "ours" ou
// "theirs" fica com um dos lados inteiro; "delete" apaga (conflito de apagado de um lado).
func (g *Git) ResolveConflict(projectID, path, side, content string) error {
	ctx := context.Background()
	top, rel, err := g.conflictRepo(ctx, projectID, path, true)
	if err != nil {
		return err
	}
	lock := g.repoLock(top)
	lock.Lock()
	defer lock.Unlock()
	defer g.changed(projectID)
	abs := filepath.Join(top, filepath.FromSlash(rel))
	write := func(s string) error {
		perm := os.FileMode(0o644)
		if st, err := os.Stat(abs); err == nil {
			perm = st.Mode().Perm()
		}
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			return err
		}
		return os.WriteFile(abs, []byte(s), perm)
	}
	switch side {
	case "content":
		if strings.Contains(content, strings.Repeat("<", markerSize)) {
			return errors.New("o resultado ainda tem marcadores de conflito")
		}
		if err := write(content); err != nil {
			return err
		}
	case "ours", "theirs":
		n := 2
		if side == "theirs" {
			n = 3
		}
		s, ok := g.stage(ctx, top, n, rel)
		if !ok {
			// Esse lado apagou o arquivo: ficar com ele é apagar.
			_, err := g.run(ctx, top, false, "rm", "-q", "--", rel)
			return err
		}
		if err := write(s); err != nil {
			return err
		}
	case "delete":
		_, err := g.run(ctx, top, false, "rm", "-q", "--", rel)
		return err
	default:
		return fmt.Errorf("lado desconhecido: %q", side)
	}
	_, err = g.run(ctx, top, false, "add", "--", rel)
	return err
}

// ContinueOperation conclui o merge, rebase ou cherry-pick depois que todos os conflitos foram resolvidos.
func (g *Git) ContinueOperation(projectID string) (OpResult, error) {
	ctx := context.Background()
	top, err := g.repoOf(ctx, projectID, true)
	if err != nil {
		return OpResult{}, err
	}
	lock := g.repoLock(top)
	lock.Lock()
	defer lock.Unlock()
	defer g.changed(projectID)
	op := g.operation(ctx, top)
	if op == "" {
		return OpResult{}, errors.New("não há operação em andamento")
	}
	if out, err := g.run(ctx, top, true, "diff", "--name-only", "--diff-filter=U"); err == nil && strings.TrimSpace(string(out)) != "" {
		left := strings.Fields(string(out))
		return OpResult{Conflicts: left, Operation: op, Message: fmt.Sprintf("ainda há %d arquivo(s) em conflito", len(left))}, nil
	}
	// Sem editor: a mensagem padrão do git (MERGE_MSG, a do commit original no rebase) vale.
	args := []string{"-c", "core.editor=true", op, "--continue"}
	if op == "merge" {
		args = []string{"commit", "--no-edit"}
	}
	if _, err := g.run(ctx, top, false, args...); err != nil {
		var ge *gitError
		if errors.As(err, &ge) && op == "rebase" && strings.Contains(ge.stderr, "CONFLICT") {
			// O próximo commit do rebase também conflitou.
			out, _ := g.run(ctx, top, true, "diff", "--name-only", "--diff-filter=U")
			return OpResult{Conflicts: strings.Fields(string(out)), Operation: op, Message: "o próximo commit do rebase também tem conflitos"}, nil
		}
		return OpResult{}, err
	}
	res := OpResult{OK: true, Message: map[string]string{"merge": "Merge concluído.", "rebase": "Rebase concluído.", "cherry-pick": "Cherry-pick concluído.", "revert": "Revert concluído."}[op]}
	if next := g.operation(ctx, top); next != "" {
		res.OK, res.Operation, res.Message = false, next, "seguindo para o próximo commit do rebase"
	}
	return res, nil
}
