package gitx

import (
	"strings"
	"testing"
)

func TestCompareBranches(t *testing.T) {
	f := newSyncFixture(t)
	gitIn(t, f.me, "checkout", "-q", "-b", "lado")
	write(t, f.me, "b.txt", "do lado\n")
	write(t, f.me, "a.txt", "um\nlado\n")
	gitIn(t, f.me, "add", "-A")
	gitIn(t, f.me, "commit", "-qm", "lado: b e a")
	gitIn(t, f.me, "checkout", "-q", "main")
	write(t, f.me, "c.txt", "da main\n")
	gitIn(t, f.me, "add", "-A")
	gitIn(t, f.me, "commit", "-qm", "main: c")

	if _, err := f.g.CompareBranches(f.id, "--output=x"); err == nil {
		t.Fatal("revisão com - na frente deveria ser recusada")
	}
	if _, err := f.g.CompareBranches(f.id, "nao-existe"); err == nil {
		t.Fatal("branch inexistente")
	}
	c, err := f.g.CompareBranches(f.id, "lado")
	if err != nil {
		t.Fatal(err)
	}
	if c.Current != "main" || len(c.OnlyOther) != 1 || c.OnlyOther[0].Subject != "lado: b e a" || len(c.OnlyCurrent) != 1 || c.OnlyCurrent[0].Subject != "main: c" {
		t.Fatalf("commits: %+v", c)
	}
	kinds := map[string]string{}
	for _, f := range c.Files {
		kinds[f.Path] = f.Kind
	}
	if kinds["a.txt"] != "modified" || kinds["b.txt"] != "added" || kinds["c.txt"] != "deleted" {
		t.Fatalf("arquivos: %+v", c.Files)
	}
	d, err := f.g.RefDiff(f.id, "HEAD", "lado", "a.txt", "")
	if err != nil || d.Left != "um\n" || !strings.Contains(d.Right, "lado") {
		t.Fatalf("diff: %+v %v", d, err)
	}
}
