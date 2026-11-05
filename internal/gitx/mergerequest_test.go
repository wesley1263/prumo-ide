package gitx

import (
	"strings"
	"testing"
)

// mrFixture: "outra pessoa" sobe a branch dela e o "GitLab" (o bare) publica refs/merge-requests/1/head.
func mrFixture(t *testing.T) (*syncFixture, string) {
	f := newSyncFixture(t)
	gitIn(t, f.other, "pull", "-q")
	gitIn(t, f.other, "switch", "-q", "-c", "feature")
	write(t, f.other, "a.txt", "um\ndois\n")
	write(t, f.other, "b.txt", "novo\n")
	gitIn(t, f.other, "add", "-A")
	gitIn(t, f.other, "commit", "-qm", "feat: b e mais a")
	gitIn(t, f.other, "push", "-q", "origin", "feature")
	head := gitIn(t, f.other, "rev-parse", "HEAD")
	gitIn(t, f.remote, "update-ref", "refs/merge-requests/1/head", head)
	return f, head
}

func TestMainRemoteReadsRawURL(t *testing.T) {
	f := newSyncFixture(t)
	// insteadOf troca a URL do fetch, mas o que identifica o projeto no servidor é a URL configurada.
	gitIn(t, f.me, "remote", "set-url", "origin", "git@gitlab.example.com:time/app.git")
	gitIn(t, f.me, "config", "url."+f.remote+".insteadOf", "git@gitlab.example.com:time/app.git")
	r, err := f.g.MainRemote(f.id)
	if err != nil || r.Name != "origin" || r.URL != "git@gitlab.example.com:time/app.git" {
		t.Fatalf("remoto: %+v %v", r, err)
	}
}

func TestFetchMergeRequestAndFiles(t *testing.T) {
	f, head := mrFixture(t)
	ref, err := f.g.FetchMergeRequest(f.id, "origin", 1, "main")
	if err != nil {
		t.Fatal(err)
	}
	if !f.g.HasCommit(f.id, head) || !f.g.HasCommit(f.id, ref) {
		t.Fatalf("o commit do merge request deveria estar no repositório local")
	}
	base, err := f.g.MergeBase(f.id, "origin/main", ref)
	if err != nil {
		t.Fatal(err)
	}
	files, err := f.g.RangeFiles(f.id, base, ref)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, x := range files {
		got[x.Path] = x.Kind
	}
	if len(got) != 2 || got["a.txt"] != "modified" || got["b.txt"] != "added" {
		t.Fatalf("arquivos: %+v", files)
	}
	d, err := f.g.RefDiff(f.id, base, ref, "a.txt", "")
	if err != nil || d.Left != "um\n" || d.Right != "um\ndois\n" {
		t.Fatalf("diff: %+v %v", d, err)
	}
	// O ref do merge request não vira branch.
	b, _ := f.g.Branches(f.id)
	for _, x := range append(b.Local, b.Remote...) {
		if strings.Contains(x.Name, "merge-requests") {
			t.Fatalf("ref do merge request apareceu como branch: %s", x.Name)
		}
	}
}

func TestPrepareMergeRequestCheckout(t *testing.T) {
	f, head := mrFixture(t)
	// Mesmo projeto: a branch de origem, acompanhando a remota.
	ref, err := f.g.PrepareMergeRequestCheckout(f.id, "origin", 1, "feature", true)
	if err != nil || ref != "origin/feature" {
		t.Fatalf("mesmo projeto: %q %v", ref, err)
	}
	res, err := f.g.Checkout(f.id, ref, "normal")
	if err != nil || !res.OK {
		t.Fatalf("checkout: %+v %v", res, err)
	}
	if cur, _ := f.g.CurrentBranch(f.id); cur != "feature" {
		t.Fatalf("branch atual: %q", cur)
	}
	// Fork: branch local criada do commit do merge request.
	ref, err = f.g.PrepareMergeRequestCheckout(f.id, "origin", 1, "feature", false)
	if err != nil || ref != "mr/1-feature" {
		t.Fatalf("fork: %q %v", ref, err)
	}
	if got := gitIn(t, f.me, "rev-parse", "mr/1-feature"); got != head {
		t.Fatalf("mr/1-feature em %s, quero %s", got, head)
	}
	if _, err := f.g.PrepareMergeRequestCheckout(f.id, "origin", 1, "-x", true); err == nil {
		t.Fatal("nome de branch começando com - deveria ser recusado")
	}
}

func TestBranchSummary(t *testing.T) {
	f := newSyncFixture(t)
	gitIn(t, f.me, "switch", "-q", "-c", "minha")
	write(t, f.me, "c.txt", "c\n")
	gitIn(t, f.me, "add", "-A")
	gitIn(t, f.me, "commit", "-qm", "feat: c\n\ncorpo do commit")
	s, err := f.g.BranchSummary(f.id, "origin/main")
	if err != nil {
		t.Fatal(err)
	}
	if len(s.Commits) != 1 || s.Commits[0] != "feat: c\n\ncorpo do commit" || !strings.Contains(s.Diff, "+c") || !strings.Contains(s.Stat, "c.txt") {
		t.Fatalf("resumo: %+v", s)
	}
	gitIn(t, f.me, "switch", "-q", "main")
	if _, err := f.g.BranchSummary(f.id, "origin/main"); err == nil {
		t.Fatal("branch sem commits novos deveria dar erro")
	}
}
