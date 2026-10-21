package gitx

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSuggestContext(t *testing.T) {
	f := newSyncFixture(t)
	write(t, f.me, "b.txt", "linha 1\nlinha 2\nlinha 3\n")
	gitIn(t, f.me, "add", "-A")
	gitIn(t, f.me, "commit", "-qm", "feat: adiciona b")

	write(t, f.me, "a.txt", "um\nmudado no a\n")
	write(t, f.me, "novo.txt", "conteúdo novo\n")
	os.Remove(filepath.Join(f.me, "b.txt"))
	write(t, f.me, "b.txt", "linha 1\nlinha 2 mexida\nlinha 3\nlinha 4 fora do commit\n")
	f.g.changed(f.id)

	// b.txt entra só em parte: a linha 2 sim, a linha 4 não (commit parcial por linha).
	partial := map[string]string{"b.txt": "linha 1\nlinha 2 mexida\nlinha 3\n"}
	c, err := f.g.SuggestContext(f.id, []string{"a.txt", "novo.txt", "b.txt"}, partial)
	if err != nil {
		t.Fatal(err)
	}
	if c.Branch != "main" || len(c.Recent) == 0 || c.Recent[0] != "feat: adiciona b" {
		t.Fatalf("branch/recentes: %+v", c)
	}
	if strings.Join(c.Files, ",") != "M a.txt,A novo.txt,M b.txt" {
		t.Fatalf("arquivos: %v", c.Files)
	}
	for _, want := range []string{"+mudado no a", "--- /dev/null\n+++ b/novo.txt", "+conteúdo novo", "+++ b/b.txt", "+linha 2 mexida"} {
		if !strings.Contains(c.Diff, want) {
			t.Errorf("diff sem %q:\n%s", want, c.Diff)
		}
	}
	if strings.Contains(c.Diff, "linha 4 fora do commit") {
		t.Errorf("o que ficou fora do commit parcial não pode ir para o agente:\n%s", c.Diff)
	}
	if strings.Contains(c.Diff, os.TempDir()) {
		t.Errorf("caminhos temporários vazaram no diff:\n%s", c.Diff)
	}

	// Apagado e diff grande (cortado).
	os.Remove(filepath.Join(f.me, "a.txt"))
	write(t, f.me, "grande.txt", strings.Repeat("x\n", 40000))
	c, err = f.g.SuggestContext(f.id, []string{"a.txt", "grande.txt"}, nil)
	if err != nil || !strings.Contains(c.Diff, "-um") || !c.Truncated || len(c.Diff) > suggestTotalMax+200 {
		t.Fatalf("apagado/cortado: trunc=%v len=%d err=%v", c.Truncated, len(c.Diff), err)
	}
	if _, err := f.g.SuggestContext(f.id, nil, nil); err == nil {
		t.Fatal("sem arquivos deveria recusar")
	}
}
