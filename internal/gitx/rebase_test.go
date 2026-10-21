package gitx

import (
	"strings"
	"testing"
)

func TestInteractiveRebase(t *testing.T) {
	f := newSyncFixture(t)
	base := strings.TrimSpace(gitIn(t, f.me, "rev-parse", "HEAD"))
	for _, n := range []string{"b", "c", "d", "e"} {
		write(t, f.me, n+".txt", n+"\n")
		gitIn(t, f.me, "add", "-A")
		gitIn(t, f.me, "commit", "-qm", "add "+n)
	}
	list, err := f.g.RebaseCommits(f.id, base)
	if err != nil || len(list) != 4 || list[0].Subject != "add b" {
		t.Fatalf("commits: %+v %v", list, err)
	}
	h := func(i int) string { return list[i].Hash }
	if _, err := f.g.InteractiveRebase(f.id, base, []RebaseStep{{Action: "pick", Hash: h(0)}}); err == nil {
		t.Fatal("lista incompleta deveria ser recusada")
	}
	if res, _ := f.g.InteractiveRebase(f.id, base, []RebaseStep{{Action: "fixup", Hash: h(0)}, {Action: "pick", Hash: h(1)}, {Action: "pick", Hash: h(2)}, {Action: "pick", Hash: h(3)}}); res.OK {
		t.Fatal("fixup no primeiro não tem onde juntar")
	}
	// e sobe para o começo e ganha nova mensagem; c vira fixup do b; d sai.
	res, err := f.g.InteractiveRebase(f.id, base, []RebaseStep{
		{Action: "reword", Hash: h(3), Message: "e primeiro, com 'aspas' e $(nada)"},
		{Action: "pick", Hash: h(0)},
		{Action: "fixup", Hash: h(1)},
		{Action: "drop", Hash: h(2)},
	})
	if err != nil || !res.OK {
		t.Fatalf("rebase: %+v %v", res, err)
	}
	subjects := strings.Split(strings.TrimSpace(gitIn(t, f.me, "log", "--format=%s", base+"..HEAD")), "\n")
	if len(subjects) != 2 || subjects[0] != "add b" || subjects[1] != "e primeiro, com 'aspas' e $(nada)" {
		t.Fatalf("histórico: %q", subjects)
	}
	files := gitIn(t, f.me, "ls-files")
	if !strings.Contains(files, "c.txt") || strings.Contains(files, "d.txt") || !strings.Contains(files, "e.txt") {
		t.Fatalf("arquivos: %s", files)
	}

	// edit para no commit; continuar termina.
	list, _ = f.g.RebaseCommits(f.id, base)
	res, err = f.g.InteractiveRebase(f.id, base, []RebaseStep{{Action: "edit", Hash: list[0].Hash}, {Action: "pick", Hash: list[1].Hash}})
	if err != nil || res.OK || res.Operation != "rebase" {
		t.Fatalf("edit deveria parar: %+v %v", res, err)
	}
	if res, err := f.g.ContinueOperation(f.id); err != nil || !res.OK {
		t.Fatalf("continuar: %+v %v", res, err)
	}
}
