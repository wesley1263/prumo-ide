package gitx

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// ChangeContext é o que vai para o agente escrever a mensagem de commit: só o que está marcado.
type ChangeContext struct {
	Branch    string
	Recent    []string
	Files     []string // "M internal/x.go" (letra do git + caminho relativo ao projeto)
	Diff      string
	Truncated bool
}

const (
	suggestFileMax  = 12 << 10 // por arquivo
	suggestTotalMax = 60 << 10 // no total (diffs gigantes viram resumo pela lista de arquivos)
	suggestRecent   = 12
)

var kindLetter = map[string]string{"added": "A", "modified": "M", "deleted": "D", "renamed": "R", "untracked": "A", "conflict": "U"}

// SuggestContext monta o diff do que vai para o commit: files (relativos ao projeto) e partial (arquivo →
// conteúdo que entra, no commit parcial por trecho/linha). Arquivos novos entram como "novo arquivo".
func (g *Git) SuggestContext(projectID string, files []string, partial map[string]string) (ChangeContext, error) {
	ctx := context.Background()
	if len(files) == 0 {
		return ChangeContext{}, errors.New("nenhum arquivo selecionado")
	}
	o, err := g.reg.RequireTrusted(projectID)
	if err != nil {
		return ChangeContext{}, err
	}
	top, err := g.toplevel(ctx, o)
	if err != nil {
		return ChangeContext{}, err
	}
	st, err := g.Status(projectID)
	if err != nil {
		return ChangeContext{}, err
	}
	kinds := map[string]string{}
	for _, f := range st.Files {
		kinds[f.Path] = f.Kind
	}
	hasHead := st.Head != ""
	out := ChangeContext{Branch: st.Branch}
	if hasHead {
		if b, err := g.run(ctx, top, true, "log", fmt.Sprintf("-%d", suggestRecent), "--format=%s"); err == nil {
			for _, s := range strings.Split(strings.TrimSpace(string(b)), "\n") {
				if s = strings.TrimSpace(s); s != "" {
					out.Recent = append(out.Recent, s)
				}
			}
		}
	}

	var diff strings.Builder
	for _, p := range files {
		abs, err := o.Abs(p)
		if err != nil {
			return ChangeContext{}, err
		}
		rel, err := filepath.Rel(top, abs)
		if err != nil {
			return ChangeContext{}, err
		}
		rel = filepath.ToSlash(rel)
		kind := kinds[p]
		letter := kindLetter[kind]
		if letter == "" {
			letter = "M"
		}
		out.Files = append(out.Files, letter+" "+p)

		var d string
		switch content, isPartial := partial[p]; {
		case isPartial:
			var old string
			if hasHead {
				if b, err := g.run(ctx, top, true, "show", "HEAD:"+rel); err == nil {
					old = string(b)
				}
			}
			d, err = g.diffContents(ctx, top, rel, old, content, old == "" && !hasHead)
		case kind == "untracked" || !hasHead:
			d, err = g.diffNewFile(ctx, top, rel, abs)
		default:
			var b []byte
			b, err = g.run(ctx, top, true, "diff", "HEAD", "--no-color", "--no-ext-diff", "-M", "--", ":(literal)"+rel)
			d = string(b)
		}
		if err != nil {
			return ChangeContext{}, err
		}
		if d == "" {
			continue
		}
		if len(d) > suggestFileMax {
			d = d[:suggestFileMax] + "\n[… diff deste arquivo cortado …]\n"
			out.Truncated = true
		}
		if diff.Len()+len(d) > suggestTotalMax {
			out.Truncated = true
			break
		}
		diff.WriteString(d)
		if !strings.HasSuffix(d, "\n") {
			diff.WriteString("\n")
		}
	}
	out.Diff = diff.String()
	return out, nil
}

// noIndex roda "git diff --no-index" entre dois caminhos. Código 1 quer dizer "há diferença": não é erro.
func (g *Git) noIndex(ctx context.Context, top, a, b string) (string, error) {
	out, err := g.run(ctx, top, true, "diff", "--no-index", "--no-color", "--no-ext-diff", "--", a, b)
	var ge *gitError
	var ee *exec.ExitError
	if err != nil && errors.As(err, &ge) && errors.As(ge.err, &ee) && ee.ExitCode() == 1 {
		return string(out), nil
	}
	return string(out), err
}

// relabel troca os nomes temporários do cabeçalho do diff pelo caminho do arquivo.
func relabel(d, rel string, isNew bool) string {
	i := strings.Index(d, "\n@@")
	if i < 0 {
		if strings.Contains(d, "Binary files") {
			return fmt.Sprintf("diff --git a/%s b/%s\nBinary file changed\n", rel, rel)
		}
		return ""
	}
	from := "--- a/" + rel
	if isNew {
		from = "--- /dev/null"
	}
	return fmt.Sprintf("diff --git a/%s b/%s\n%s\n+++ b/%s%s", rel, rel, from, rel, d[i:])
}

func (g *Git) diffContents(ctx context.Context, top, rel, old, new string, isNew bool) (string, error) {
	dir, err := os.MkdirTemp("", "prumo-suggest-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(dir)
	a, b := filepath.Join(dir, "a"), filepath.Join(dir, "b")
	if err := os.WriteFile(a, []byte(old), 0o600); err != nil {
		return "", err
	}
	if err := os.WriteFile(b, []byte(new), 0o600); err != nil {
		return "", err
	}
	d, err := g.noIndex(ctx, top, a, b)
	if err != nil {
		return "", err
	}
	return relabel(d, rel, isNew), nil
}

func (g *Git) diffNewFile(ctx context.Context, top, rel, abs string) (string, error) {
	if st, err := os.Stat(abs); err != nil || st.IsDir() {
		return "", nil
	}
	d, err := g.noIndex(ctx, top, os.DevNull, abs)
	if err != nil {
		return "", err
	}
	return relabel(d, rel, true), nil
}
