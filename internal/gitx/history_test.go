package gitx

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"prumo/internal/events"
	"prumo/internal/store"
	"prumo/internal/workspace"
)

func subjects(cs []LogCommit) []string {
	out := make([]string, len(cs))
	for i, c := range cs {
		out[i] = c.Subject
	}
	return out
}

// Histórico com branch e merge:
//
//   - merge feature
//     |\
//     | * feature 2
//     | * feature 1
//   - | main 2
//     |/
//   - primeiro
func TestLogGraphFiltersAndDetails(t *testing.T) {
	f := newSyncFixture(t)
	commit := func(dir, file, content, msg string) {
		write(t, dir, file, content)
		gitIn(t, dir, "add", "-A")
		gitIn(t, dir, "commit", "-qm", msg)
	}
	gitIn(t, f.me, "checkout", "-q", "-b", "feature")
	commit(f.me, "f.txt", "f1\n", "feature 1")
	commit(f.me, "f.txt", "f1\nf2\n", "feature 2")
	gitIn(t, f.me, "checkout", "-q", "main")
	commit(f.me, "a.txt", "um\ndois\n", "main 2")
	gitIn(t, f.me, "merge", "-q", "--no-ff", "-m", "merge feature", "feature")
	gitIn(t, f.me, "tag", "v1")

	page, err := f.g.Log(f.id, LogFilter{}, 100)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"merge feature", "feature 2", "main 2", "feature 1", "primeiro"}
	// --date-order pode intercalar commits do mesmo segundo de outra forma: confere o conjunto e as pontas.
	got := subjects(page.Commits)
	if len(got) != 5 || got[0] != "merge feature" || got[4] != "primeiro" {
		t.Fatalf("log: %v (quero algo como %v)", got, want)
	}
	if page.Width != 2 || page.HasMore {
		t.Fatalf("largura do grafo = %d, hasMore = %v", page.Width, page.HasMore)
	}
	top := page.Commits[0]
	if len(top.Parents) != 2 || top.Node != 0 {
		t.Fatalf("merge: %+v", top)
	}
	// O merge sai para duas colunas (os dois pais).
	outs := map[int]bool{}
	for _, s := range top.Lines {
		if s.Y1 == 1 {
			outs[s.X2] = true
		}
	}
	if !outs[0] || !outs[1] {
		t.Fatalf("o merge deveria descer para as colunas 0 e 1: %+v", top.Lines)
	}
	// Refs: HEAD -> main, a tag e a remota.
	var kinds []string
	for _, r := range top.Refs {
		kinds = append(kinds, r.Kind+":"+r.Name)
	}
	if !reflect.DeepEqual(kinds, []string{"head:main", "tag:v1"}) {
		t.Fatalf("refs do topo: %v", kinds)
	}
	last := page.Commits[4]
	hasRemote := false
	for _, r := range last.Refs {
		hasRemote = hasRemote || (r.Kind == "remote" && r.Name == "origin/main")
	}
	if !hasRemote {
		t.Fatalf("o primeiro commit deveria ter origin/main: %+v", last.Refs)
	}
	// Todo trecho fica dentro da largura e todo commit (menos o raiz) desce para alguém.
	for _, c := range page.Commits {
		down := false
		for _, s := range c.Lines {
			if s.X1 >= page.Width || s.X2 >= page.Width {
				t.Fatalf("trecho fora da largura em %q: %+v", c.Subject, s)
			}
			down = down || (s.Y1 == 1 && s.Y2 == 2)
		}
		if len(c.Parents) > 0 && !down {
			t.Fatalf("%q não liga ao pai: %+v", c.Subject, c.Lines)
		}
	}

	// Filtros.
	page, _ = f.g.Log(f.id, LogFilter{Text: "FEATURE"}, 100)
	if !reflect.DeepEqual(subjects(page.Commits), []string{"merge feature", "feature 2", "feature 1"}) {
		t.Fatalf("filtro de texto: %v", subjects(page.Commits))
	}
	page, _ = f.g.Log(f.id, LogFilter{Path: "f.txt", Follow: true}, 100)
	if !reflect.DeepEqual(subjects(page.Commits), []string{"feature 2", "feature 1"}) {
		t.Fatalf("histórico do arquivo: %v", subjects(page.Commits))
	}
	page, _ = f.g.Log(f.id, LogFilter{Branch: "feature"}, 100)
	if len(page.Commits) != 3 {
		t.Fatalf("só a branch feature: %v", subjects(page.Commits))
	}
	page, _ = f.g.Log(f.id, LogFilter{}, 2)
	if len(page.Commits) != 2 || !page.HasMore {
		t.Fatalf("limite: %d hasMore=%v", len(page.Commits), page.HasMore)
	}
	if _, err := f.g.Log(f.id, LogFilter{Branch: "--output=/tmp/x"}, 10); err == nil {
		t.Fatal("branch começando com - deveria ser recusada")
	}

	// Detalhes e diff de um commit.
	page, _ = f.g.Log(f.id, LogFilter{Text: "feature 2"}, 10)
	d, err := f.g.CommitDetails(f.id, page.Commits[0].Hash)
	if err != nil {
		t.Fatal(err)
	}
	if d.Message != "feature 2" || len(d.Files) != 1 || d.Files[0].Path != "f.txt" || d.Files[0].Kind != "modified" || !reflect.DeepEqual(d.Branches, []string{"feature", "main"}) {
		t.Fatalf("detalhes: %+v", d)
	}
	diff, err := f.g.CommitDiff(f.id, d.Hash, "f.txt", "")
	if err != nil || diff.Left != "f1\n" || diff.Right != "f1\nf2\n" {
		t.Fatalf("diff do commit: %+v %v", diff, err)
	}
	if _, err := f.g.CommitDetails(f.id, "--help"); err == nil {
		t.Fatal("revisão começando com - deveria ser recusada")
	}
	// Commit raiz: arquivos adicionados.
	root, _ := f.g.CommitDetails(f.id, last.Hash)
	if len(root.Files) != 1 || root.Files[0].Kind != "added" || root.Files[0].Path != "a.txt" {
		t.Fatalf("commit raiz: %+v", root.Files)
	}
}

func TestRenameAndBlame(t *testing.T) {
	f := newSyncFixture(t)
	gitIn(t, f.me, "mv", "a.txt", "b.txt")
	gitIn(t, f.me, "commit", "-qm", "renomeia")
	page, _ := f.g.Log(f.id, LogFilter{Text: "renomeia"}, 1)
	d, _ := f.g.CommitDetails(f.id, page.Commits[0].Hash)
	if len(d.Files) != 1 || d.Files[0].Kind != "renamed" || d.Files[0].OldPath != "a.txt" || d.Files[0].Path != "b.txt" {
		t.Fatalf("renome: %+v", d.Files)
	}
	diff, _ := f.g.CommitDiff(f.id, d.Hash, "b.txt", "a.txt")
	if diff.Left != "um\n" || diff.Right != "um\n" {
		t.Fatalf("diff do renome: %+v", diff)
	}
	hist, _ := f.g.Log(f.id, LogFilter{Path: "b.txt", Follow: true}, 10)
	if !reflect.DeepEqual(subjects(hist.Commits), []string{"renomeia", "primeiro"}) {
		t.Fatalf("--follow atravessa o renome: %v", subjects(hist.Commits))
	}

	// Blame: linha velha, linha nova commitada, linha ainda não commitada.
	write(t, f.me, "b.txt", "um\ndois\n")
	gitIn(t, f.me, "commit", "-qam", "segunda linha")
	write(t, f.me, "b.txt", "um\ndois\ntrês\n")
	bl, err := f.g.Blame(f.id, "b.txt")
	if err != nil {
		t.Fatal(err)
	}
	if len(bl.Lines) != 3 {
		t.Fatalf("linhas: %+v", bl)
	}
	c := func(i int) BlameCommit { return bl.Commits[bl.Lines[i]] }
	if c(0).Summary != "primeiro" || c(1).Summary != "segunda linha" || !c(2).Pending || c(0).Author != "t" || c(0).Date == 0 {
		t.Fatalf("blame: %+v / %+v / %+v", c(0), c(1), c(2))
	}
	write(t, f.me, "novo.txt", "x\n")
	if _, err := f.g.Blame(f.id, "novo.txt"); err == nil || !strings.Contains(err.Error(), "não versionado") {
		t.Fatalf("arquivo novo: %v", err)
	}
	if _, err := f.g.Blame(f.id, "../fora.txt"); err == nil {
		t.Fatal("caminho fora do projeto deveria falhar")
	}
	_ = os.Remove(filepath.Join(f.me, "novo.txt"))
}

func TestLogEmptyRepo(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git ausente")
	}
	ctx := context.Background()
	root := t.TempDir()
	gitIn(t, root, "init", "-q")
	db, _ := store.Open(ctx, filepath.Join(t.TempDir(), "s.db"))
	defer db.Close()
	p, _ := db.TouchProject(ctx, root, "vazio")
	reg := workspace.NewRegistry(db)
	reg.Add(ctx, p)
	g := New(reg, events.NewBus(), func() string { x, _ := exec.LookPath("git"); return x })
	page, err := g.Log(p.ID, LogFilter{}, 10)
	if err != nil || len(page.Commits) != 0 {
		t.Fatalf("repositório sem commits: %+v %v", page, err)
	}
}
