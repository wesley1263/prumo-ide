package gitx

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"prumo/internal/events"
	"prumo/internal/store"
	"prumo/internal/workspace"
)

// syncFixture: um remoto bare, o clone do usuário (aberto na IDE) e um clone de "outra pessoa".
type syncFixture struct {
	t      *testing.T
	g      *Git
	id     string
	me     string
	other  string
	remote string
}

func gitIn(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t", "LC_ALL=C")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func write(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func newSyncFixture(t *testing.T) *syncFixture {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git ausente")
	}
	base := t.TempDir()
	if real, err := filepath.EvalSymlinks(base); err == nil {
		base = real
	}
	remote := filepath.Join(base, "remoto.git")
	gitIn(t, base, "init", "-q", "--bare", "-b", "main", remote)
	me := filepath.Join(base, "eu")
	gitIn(t, base, "clone", "-q", remote, me)
	for _, d := range []string{me} {
		gitIn(t, d, "config", "user.name", "t")
		gitIn(t, d, "config", "user.email", "t@t")
	}
	write(t, me, "a.txt", "um\n")
	gitIn(t, me, "add", "-A")
	gitIn(t, me, "commit", "-qm", "primeiro")
	gitIn(t, me, "push", "-q", "-u", "origin", "main")
	other := filepath.Join(base, "outro")
	gitIn(t, base, "clone", "-q", remote, other)
	gitIn(t, other, "config", "user.name", "o")
	gitIn(t, other, "config", "user.email", "o@o")

	ctx := context.Background()
	db, _ := store.Open(ctx, filepath.Join(t.TempDir(), "s.db"))
	t.Cleanup(func() { db.Close() })
	p, _ := db.TouchProject(ctx, me, "eu")
	reg := workspace.NewRegistry(db)
	reg.Add(ctx, p)
	reg.SetTrusted(p.ID, true)
	g := New(reg, events.NewBus(), func() string { x, _ := exec.LookPath("git"); return x })
	return &syncFixture{t: t, g: g, id: p.ID, me: me, other: other, remote: remote}
}

func TestPushOutgoingRejectedUpdate(t *testing.T) {
	f := newSyncFixture(t)
	// Commit local: aparece como "a enviar".
	write(t, f.me, "b.txt", "novo\n")
	if _, err := f.g.Commit(f.id, CommitRequest{Files: []string{"b.txt"}, Message: "b"}); err != nil {
		t.Fatal(err)
	}
	out, err := f.g.Outgoing(f.id)
	if err != nil || !out.HasUpstream || out.Remote != "origin" || out.Target != "main" || len(out.Commits) != 1 || out.Commits[0].Subject != "b" {
		t.Fatalf("outgoing: %+v %v", out, err)
	}
	res, err := f.g.Push(f.id, PushRequest{Remote: "origin", Target: "main"})
	if err != nil || !res.OK {
		t.Fatalf("push: %+v %v", res, err)
	}
	if out, _ := f.g.Outgoing(f.id); len(out.Commits) != 0 {
		t.Fatalf("depois do push não deveria sobrar nada: %+v", out.Commits)
	}

	// Outra pessoa empurra antes: o meu push é recusado.
	gitIn(t, f.other, "pull", "-q")
	write(t, f.other, "c.txt", "dela\n")
	gitIn(t, f.other, "add", "-A")
	gitIn(t, f.other, "commit", "-qm", "dela")
	gitIn(t, f.other, "push", "-q")
	write(t, f.me, "d.txt", "meu\n")
	f.g.Commit(f.id, CommitRequest{Files: []string{"d.txt"}, Message: "meu"})
	res, err = f.g.Push(f.id, PushRequest{Remote: "origin", Target: "main"})
	if err != nil || !res.Rejected {
		t.Fatalf("push deveria ser recusado: %+v %v", res, err)
	}
	// Atualizar (merge) traz o dela; aí o push passa.
	up, err := f.g.Update(f.id, "merge")
	if err != nil || !up.OK {
		t.Fatalf("update: %+v %v", up, err)
	}
	if _, err := os.Stat(filepath.Join(f.me, "c.txt")); err != nil {
		t.Fatal("update deveria trazer c.txt")
	}
	if res, err := f.g.Push(f.id, PushRequest{Remote: "origin", Target: "main"}); err != nil || !res.OK {
		t.Fatalf("push depois do update: %+v %v", res, err)
	}
}

func TestUpdateConflictAndAbort(t *testing.T) {
	f := newSyncFixture(t)
	write(t, f.other, "a.txt", "dela\n")
	gitIn(t, f.other, "commit", "-qam", "dela")
	gitIn(t, f.other, "push", "-q")
	write(t, f.me, "a.txt", "minha\n")
	f.g.Commit(f.id, CommitRequest{Files: []string{"a.txt"}, Message: "minha"})

	up, err := f.g.Update(f.id, "merge")
	if err != nil || up.OK || len(up.Conflicts) != 1 || up.Conflicts[0] != "a.txt" || up.Operation != "merge" {
		t.Fatalf("esperava conflito em a.txt: %+v %v", up, err)
	}
	st, _ := f.g.Status(f.id)
	if st.Operation != "merge" {
		t.Fatalf("status deveria mostrar o merge: %+v", st)
	}
	if err := f.g.AbortOperation(f.id); err != nil {
		t.Fatal(err)
	}
	st, _ = f.g.Status(f.id)
	if st.Operation != "" || len(st.Files) != 0 {
		t.Fatalf("depois de abortar deveria voltar limpo: %+v", st)
	}
	data, _ := os.ReadFile(filepath.Join(f.me, "a.txt"))
	if string(data) != "minha\n" {
		t.Fatalf("abortar deveria manter a minha versão: %q", data)
	}
}

func TestBranchesCheckoutSmartAndDelete(t *testing.T) {
	f := newSyncFixture(t)
	if err := f.g.CreateBranch(f.id, "feat/x", "", true); err != nil {
		t.Fatal(err)
	}
	if err := f.g.CreateBranch(f.id, "nome inválido..", "", false); err == nil {
		t.Fatal("nome inválido deveria falhar")
	}
	write(t, f.me, "a.txt", "na feat\n")
	f.g.Commit(f.id, CommitRequest{Files: []string{"a.txt"}, Message: "feat"})

	b, err := f.g.Branches(f.id)
	if err != nil || b.Current != "feat/x" || len(b.Local) != 2 || len(b.Remote) != 1 || b.Remote[0].Name != "origin/main" {
		t.Fatalf("branches: %+v %v", b, err)
	}

	// Mudança local que conflita com main: o modo normal recusa e lista o arquivo.
	write(t, f.me, "a.txt", "mexendo\n")
	res, err := f.g.Checkout(f.id, "main", "normal")
	if err != nil || res.OK || len(res.LocalChanges) != 1 || res.LocalChanges[0] != "a.txt" {
		t.Fatalf("checkout normal: %+v %v", res, err)
	}
	// Smart: guarda, troca e devolve (aqui conflita, e o aviso explica).
	res, err = f.g.Checkout(f.id, "main", "smart")
	if err != nil || !res.OK || res.Message == "" {
		t.Fatalf("checkout smart com conflito: %+v %v", res, err)
	}
	gitIn(t, f.me, "reset", "-q", "--hard")
	gitIn(t, f.me, "stash", "drop", "-q") // o app avisou que a mudança ficou guardada no stash

	// Smart sem conflito: a mudança vai junto.
	gitIn(t, f.me, "switch", "-q", "feat/x")
	write(t, f.me, "solto.txt", "vai junto\n")
	if res, err := f.g.Checkout(f.id, "main", "smart"); err != nil || !res.OK || res.Message != "" {
		t.Fatalf("checkout smart: %+v %v", res, err)
	}
	if data, _ := os.ReadFile(filepath.Join(f.me, "solto.txt")); string(data) != "vai junto\n" {
		t.Fatal("a mudança deveria acompanhar a troca")
	}

	// Renomear e apagar (com commit não integrado: pede force) e restaurar.
	if err := f.g.RenameBranch(f.id, "feat/x", "feat/y"); err != nil {
		t.Fatal(err)
	}
	del, err := f.g.DeleteBranch(f.id, "feat/y", false)
	if err != nil || del.Deleted || !del.NotMerged {
		t.Fatalf("apagar não integrada sem force: %+v %v", del, err)
	}
	del, err = f.g.DeleteBranch(f.id, "feat/y", true)
	if err != nil || !del.Deleted || del.Hash == "" {
		t.Fatalf("apagar com force: %+v %v", del, err)
	}
	if err := f.g.RestoreBranch(f.id, "feat/y", del.Hash); err != nil {
		t.Fatal(err)
	}
	if gitIn(t, f.me, "rev-parse", "feat/y") != del.Hash {
		t.Fatal("restaurar deveria voltar ao mesmo commit")
	}
}

func TestCheckoutRemoteBranchCreatesTracking(t *testing.T) {
	f := newSyncFixture(t)
	gitIn(t, f.other, "switch", "-q", "-c", "dela")
	write(t, f.other, "z.txt", "z\n")
	gitIn(t, f.other, "add", "-A")
	gitIn(t, f.other, "commit", "-qm", "z")
	gitIn(t, f.other, "push", "-q", "-u", "origin", "dela")
	if _, err := f.g.Fetch(f.id); err != nil {
		t.Fatal(err)
	}
	res, err := f.g.Checkout(f.id, "origin/dela", "normal")
	if err != nil || !res.OK {
		t.Fatalf("checkout remota: %+v %v", res, err)
	}
	b, _ := f.g.Branches(f.id)
	if b.Current != "dela" {
		t.Fatalf("deveria estar na local dela: %+v", b)
	}
	for _, l := range b.Local {
		if l.Name == "dela" && l.Upstream != "origin/dela" {
			t.Fatalf("deveria acompanhar origin/dela: %+v", l)
		}
	}
}

func TestHeadContentAndTrust(t *testing.T) {
	f := newSyncFixture(t)
	h, err := f.g.HeadContent(f.id, "a.txt")
	if err != nil || !h.Tracked || h.Content != "um\n" {
		t.Fatalf("head: %+v %v", h, err)
	}
	if h, _ := f.g.HeadContent(f.id, "nao-existe.txt"); h.Tracked {
		t.Fatal("arquivo novo não está no HEAD")
	}
	f.g.reg.SetTrusted(f.id, false)
	if _, err := f.g.Push(f.id, PushRequest{Remote: "origin", Target: "main"}); err != workspace.ErrUntrusted {
		t.Fatalf("push sem confiança: %v", err)
	}
	if _, err := f.g.Branches(f.id); err != nil {
		t.Fatalf("listar branches é leitura e não exige confiança: %v", err)
	}
}
