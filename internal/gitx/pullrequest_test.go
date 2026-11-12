package gitx

import (
	"testing"
)

// prFixture: "outra pessoa" sobe a branch dela e o "GitHub" (o bare) publica refs/pull/2/head.
func prFixture(t *testing.T) (*syncFixture, string) {
	f := newSyncFixture(t)
	gitIn(t, f.other, "pull", "-q")
	gitIn(t, f.other, "switch", "-q", "-c", "feature")
	write(t, f.other, "a.txt", "um\ndois\n")
	gitIn(t, f.other, "add", "-A")
	gitIn(t, f.other, "commit", "-qm", "feat: mais a")
	gitIn(t, f.other, "push", "-q", "origin", "feature")
	head := gitIn(t, f.other, "rev-parse", "HEAD")
	gitIn(t, f.remote, "update-ref", "refs/pull/2/head", head)
	return f, head
}

func TestFetchPullRequestAndCheckout(t *testing.T) {
	f, head := prFixture(t)
	ref, err := f.g.FetchPullRequest(f.id, "origin", 2, "main")
	if err != nil || ref != "refs/prumo/pull-requests/2" {
		t.Fatalf("fetch: %q %v", ref, err)
	}
	if got := gitIn(t, f.me, "rev-parse", ref); got != head {
		t.Fatalf("ref do pull request em %s, quero %s", got, head)
	}
	// Mesmo repositório: a branch de origem, acompanhando a remota.
	if ref, err := f.g.PreparePullRequestCheckout(f.id, "origin", 2, "feature", true); err != nil || ref != "origin/feature" {
		t.Fatalf("mesmo repositório: %q %v", ref, err)
	}
	// Fork: branch local criada do commit do pull request.
	ref, err = f.g.PreparePullRequestCheckout(f.id, "origin", 2, "feature", false)
	if err != nil || ref != "pr/2-feature" {
		t.Fatalf("fork: %q %v", ref, err)
	}
	if got := gitIn(t, f.me, "rev-parse", "pr/2-feature"); got != head {
		t.Fatalf("pr/2-feature em %s, quero %s", got, head)
	}
	if _, err := f.g.FetchPullRequest(f.id, "origin", 2, "--upload-pack=x"); err == nil {
		t.Fatal("branch de destino começando com - deveria ser recusada")
	}
}

func TestRepoAndProjectPath(t *testing.T) {
	f := newSyncFixture(t)
	p, err := f.g.RepoPath(f.id, "dir/a.go")
	if err != nil || p != "dir/a.go" {
		t.Fatalf("RepoPath: %q %v", p, err)
	}
	if p, err := f.g.ProjectPath(f.id, "dir/a.go"); err != nil || p != "dir/a.go" {
		t.Fatalf("ProjectPath: %q %v", p, err)
	}
}
