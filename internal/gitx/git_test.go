package gitx

import (
	"context"
	"fmt"
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

func TestParseStatus(t *testing.T) {
	raw := strings.Join([]string{
		"# branch.oid 1234567890abcdef",
		"# branch.head main",
		"# branch.upstream origin/main",
		"# branch.ab +2 -1",
		"1 .M N... 100644 100644 100644 aaa bbb dir/with space.go",
		"1 A. N... 000000 100644 100644 000 ccc new.go",
		"1 D. N... 100644 000000 000000 ddd 000 gone.go",
		"2 R. N... 100644 100644 100644 eee eee R100 renamed.go",
		"old name.go",
		"u UU N... 100644 100644 100644 100644 f1 f2 f3 conflict.go",
		"? untracked file.txt",
		"! ignored.log",
		"",
	}, "\x00")
	st, err := ParseStatus([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if st.Branch != "main" || st.Head != "1234567" || st.Upstream != "origin/main" || st.Ahead != 2 || st.Behind != 1 {
		t.Fatalf("cabeçalho errado: %+v", st)
	}
	want := []FileChange{
		{Path: "dir/with space.go", Kind: "modified", Unstaged: true},
		{Path: "new.go", Kind: "added", Staged: true},
		{Path: "gone.go", Kind: "deleted", Staged: true},
		{Path: "renamed.go", OrigPath: "old name.go", Kind: "renamed", Staged: true},
		{Path: "conflict.go", Kind: "conflict", Unstaged: true},
		{Path: "untracked file.txt", Kind: "untracked", Unstaged: true},
	}
	if len(st.Files) != len(want) {
		t.Fatalf("esperava %d arquivos, veio %d: %+v", len(want), len(st.Files), st.Files)
	}
	for i := range want {
		if st.Files[i] != want[i] {
			t.Errorf("arquivo %d = %+v; quero %+v", i, st.Files[i], want[i])
		}
	}
}

func TestParseStatusDetachedInitial(t *testing.T) {
	st, _ := ParseStatus([]byte("# branch.oid (initial)\x00# branch.head (detached)\x00"))
	if st.Head != "" || st.Branch != "" {
		t.Fatalf("detached/initial: %+v", st)
	}
}

// Fluxo real: repositório novo, commit só de um arquivo, o outro continua pendente.
func TestCommitOnlySelectedFiles(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git ausente")
	}
	ctx := context.Background()
	root := t.TempDir()
	if real, err := filepath.EvalSymlinks(root); err == nil {
		root = real
	}
	sh := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	sh("init", "-q", "-b", "main")
	sh("config", "user.name", "t")
	sh("config", "user.email", "t@t")
	os.WriteFile(filepath.Join(root, "a.go"), []byte("package a\n"), 0o644)
	os.WriteFile(filepath.Join(root, "b.go"), []byte("package b\n"), 0o644)

	db, _ := store.Open(ctx, filepath.Join(t.TempDir(), "s.db"))
	defer db.Close()
	p, _ := db.TouchProject(ctx, root, "r")
	reg := workspace.NewRegistry(db)
	reg.Add(ctx, p)
	g := New(reg, events.NewBus(), func() string { p, _ := exec.LookPath("git"); return p })

	if _, err := g.Commit(p.ID, CommitRequest{Files: []string{"a.go"}, Message: "x"}); err != workspace.ErrUntrusted {
		t.Fatalf("commit sem confiança deveria falhar, veio %v", err)
	}
	reg.SetTrusted(p.ID, true)

	if _, err := g.Commit(p.ID, CommitRequest{Files: []string{"a.go"}, Message: "  "}); err == nil {
		t.Fatal("mensagem vazia deveria falhar")
	}
	res, err := g.Commit(p.ID, CommitRequest{Files: []string{"a.go"}, Message: "primeiro"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Hash == "" || res.Summary != "primeiro" {
		t.Fatalf("resultado: %+v", res)
	}
	st, err := g.Status(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if st.Branch != "main" || len(st.Files) != 1 || st.Files[0].Path != "b.go" || st.Files[0].Kind != "untracked" {
		t.Fatalf("só b.go deveria sobrar: %+v", st)
	}
	// Diff de arquivo modificado.
	os.WriteFile(filepath.Join(root, "a.go"), []byte("package a\n// mudou\n"), 0o644)
	d, err := g.Diff(p.ID, "a.go")
	if err != nil || d.Left != "package a\n" || !strings.Contains(d.Right, "mudou") {
		t.Fatalf("diff: %+v %v", d, err)
	}
}

func TestStatusOutsideRepo(t *testing.T) {
	ctx := context.Background()
	db, _ := store.Open(ctx, filepath.Join(t.TempDir(), "s.db"))
	defer db.Close()
	p, _ := db.TouchProject(ctx, t.TempDir(), "x")
	reg := workspace.NewRegistry(db)
	reg.Add(ctx, p)
	g := New(reg, events.NewBus(), func() string { p, _ := exec.LookPath("git"); return p })
	st, err := g.Status(p.ID)
	if err != nil || st.IsRepo {
		t.Fatalf("fora de repo: %+v %v", st, err)
	}
}

// Commit parcial: só o trecho escolhido entra; o resto continua no disco como mudança.
func TestCommitPartial(t *testing.T) {
	f := newSyncFixture(t)
	write(t, f.me, "a.txt", "um\ndois\ntrês\n")
	write(t, f.me, "b.txt", "bê\n")
	gitIn(t, f.me, "add", "-A")
	gitIn(t, f.me, "commit", "-qm", "base")
	// Duas mudanças em a.txt; só a primeira vai para o commit. b.txt muda e entra inteiro.
	write(t, f.me, "a.txt", "UM\ndois\nTRÊS\n")
	write(t, f.me, "b.txt", "bê bê\n")
	res, err := f.g.Commit(f.id, CommitRequest{Files: []string{"a.txt", "b.txt"}, Message: "parcial", Partial: map[string]string{"a.txt": "UM\ndois\ntrês\n"}})
	if err != nil {
		t.Fatal(err)
	}
	if res.Summary != "parcial" {
		t.Fatalf("resultado: %+v", res)
	}
	if got := gitIn(t, f.me, "show", "HEAD:a.txt"); got != "UM\ndois\ntrês" {
		t.Fatalf("a.txt no commit: %q", got)
	}
	if got := gitIn(t, f.me, "show", "HEAD:b.txt"); got != "bê bê" {
		t.Fatalf("b.txt no commit: %q", got)
	}
	// O disco não mudou e a segunda mudança aparece como pendente (não staged).
	if b, _ := os.ReadFile(filepath.Join(f.me, "a.txt")); string(b) != "UM\ndois\nTRÊS\n" {
		t.Fatalf("disco: %q", b)
	}
	if st := gitIn(t, f.me, "status", "--porcelain"); st != "M a.txt" {
		t.Fatalf("status: %q", st)
	}
}

// Pasta não versionada grande (um cache de módulos fora do .gitignore) vira uma entrada só; pasta pequena
// continua arquivo por arquivo. O projeto é uma subpasta do repositório, como num monorepo.
func TestStatusCollapsesLargeUntrackedDirs(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git ausente")
	}
	ctx := context.Background()
	repo := t.TempDir()
	if real, err := filepath.EvalSymlinks(repo); err == nil {
		repo = real
	}
	put := func(dir, name, content string) {
		os.MkdirAll(filepath.Dir(filepath.Join(dir, name)), 0o755)
		write(t, dir, name, content)
	}
	gitIn(t, repo, "init", "-q", "-b", "main")
	root := filepath.Join(repo, "apps", "api")
	put(root, "go.mod", "module api\n")
	put(repo, ".gitignore", "*.log\n")
	gitIn(t, repo, "add", "-A")
	gitIn(t, repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base")
	for i := range UntrackedDirMax + 50 {
		put(root, fmt.Sprintf(".cache/mod/m%d/f.go", i), "package m\n")
	}
	put(root, ".cache/build.log", "ignorado\n")
	put(root, "novo/a.go", "package novo\n")
	put(root, "novo/sub/b.go", "package sub\n")

	db, _ := store.Open(ctx, filepath.Join(t.TempDir(), "s.db"))
	defer db.Close()
	p, _ := db.TouchProject(ctx, root, "api")
	reg := workspace.NewRegistry(db)
	reg.Add(ctx, p)
	reg.SetTrusted(p.ID, true)
	g := New(reg, events.NewBus(), func() string { p, _ := exec.LookPath("git"); return p })

	st, err := g.Status(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := []FileChange{
		{Path: ".cache/", Kind: "untracked", Unstaged: true, Count: UntrackedDirMax + 50},
		{Path: "novo/a.go", Kind: "untracked", Unstaged: true},
		{Path: "novo/sub/b.go", Kind: "untracked", Unstaged: true},
	}
	if !reflect.DeepEqual(st.Files, want) {
		t.Fatalf("arquivos:\n got %+v\nwant %+v", st.Files, want)
	}

	// A pasta recolhida entra inteira no commit (menos o ignorado).
	if _, err := g.Commit(p.ID, CommitRequest{Files: []string{".cache/"}, Message: "cache"}); err != nil {
		t.Fatal(err)
	}
	if n := len(strings.Fields(gitIn(t, repo, "ls-files", "apps/api/.cache"))); n != UntrackedDirMax+50 {
		t.Fatalf("arquivos do cache no commit: %d", n)
	}
}
