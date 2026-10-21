package gitx

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTagsAndWorktrees(t *testing.T) {
	f := newSyncFixture(t)
	head := strings.TrimSpace(gitIn(t, f.me, "rev-parse", "HEAD"))
	if err := f.g.CreateTag(f.id, "v1.0.0", head, ""); err != nil {
		t.Fatal(err)
	}
	if err := f.g.CreateTag(f.id, "v1.0.0", head, ""); err == nil || !strings.Contains(err.Error(), "já existe") {
		t.Fatalf("tag repetida: %v", err)
	}
	if err := f.g.CreateTag(f.id, "com espaço", head, ""); err == nil {
		t.Fatal("nome inválido")
	}
	if err := f.g.CreateTag(f.id, "v1.1.0", head, "versão anotada"); err != nil {
		t.Fatal(err)
	}
	if typ := strings.TrimSpace(gitIn(t, f.me, "cat-file", "-t", "v1.1.0")); typ != "tag" {
		t.Fatalf("com mensagem deveria ser anotada: %s", typ)
	}
	if err := f.g.DeleteTag(f.id, "v1.0.0"); err != nil {
		t.Fatal(err)
	}
	if out := gitIn(t, f.me, "tag"); strings.Contains(out, "v1.0.0") {
		t.Fatalf("tag apagada continua: %s", out)
	}

	// Worktree com branch nova; a mesma branch não abre em dois.
	wt := filepath.Join(filepath.Dir(f.me), "eu-frete")
	w, err := f.g.AddWorktree(f.id, wt, "feat/frete", true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(w.Path, "a.txt")); err != nil {
		t.Fatal("o worktree deveria ter os arquivos")
	}
	if _, err := f.g.AddWorktree(f.id, filepath.Join(filepath.Dir(f.me), "terceiro"), "feat/frete", false); err == nil || !strings.Contains(err.Error(), "outro worktree") {
		t.Fatalf("branch já aberta: %v", err)
	}
	list, err := f.g.Worktrees(f.id)
	if err != nil || len(list) != 2 || !list[0].Main || !list[0].Current || list[1].Branch != "feat/frete" {
		t.Fatalf("lista: %+v %v", list, err)
	}
	if err := f.g.RemoveWorktree(f.id, list[0].Path, false); err == nil {
		t.Fatal("não remove o principal")
	}
	write(t, w.Path, "sujo.txt", "x\n")
	if err := f.g.RemoveWorktree(f.id, w.Path, false); err == nil || !strings.Contains(err.Error(), "mudanças") {
		t.Fatalf("com mudanças: %v", err)
	}
	if err := f.g.RemoveWorktree(f.id, w.Path, true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(w.Path); !os.IsNotExist(err) {
		t.Fatal("a pasta do worktree deveria sumir")
	}
}
