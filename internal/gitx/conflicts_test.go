package gitx

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// conflictFixture: main e feature mudam a mesma linha (conflito) e linhas diferentes (mescla sozinho).
func conflictFixture(t *testing.T) *syncFixture {
	f := newSyncFixture(t)
	write(t, f.me, "a.txt", "um\ndois\ntrês\nquatro\ncinco\nseis\n")
	gitIn(t, f.me, "commit", "-qam", "base")
	gitIn(t, f.me, "checkout", "-qb", "feature")
	write(t, f.me, "a.txt", "UM\ndois\nTRÊS (feature)\nquatro\ncinco\nseis\n")
	write(t, f.me, "x.txt", "da feature\n")
	gitIn(t, f.me, "add", "-A")
	gitIn(t, f.me, "commit", "-qm", "feature")
	gitIn(t, f.me, "checkout", "-q", "main")
	write(t, f.me, "a.txt", "um\ndois\nTRÊS (main)\nquatro\ncinco\nSEIS\n")
	write(t, f.me, "x.txt", "da main\n")
	gitIn(t, f.me, "add", "-A")
	gitIn(t, f.me, "commit", "-qm", "main")
	cmd := exec.Command("git", "merge", "-q", "feature")
	cmd.Dir = f.me
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
	if out, err := cmd.CombinedOutput(); err == nil {
		t.Fatalf("o merge deveria conflitar: %s", out)
	}
	return f
}

func TestConflictVersionsAndResolve(t *testing.T) {
	f := conflictFixture(t)
	in, err := f.g.ConflictVersions(f.id, "a.txt")
	if err != nil {
		t.Fatal(err)
	}
	if in.Kind != "both-modified" || in.Operation != "merge" || in.Conflicts != 1 {
		t.Fatalf("entrada: kind=%s op=%s conflitos=%d", in.Kind, in.Operation, in.Conflicts)
	}
	if !strings.HasPrefix(in.OursLabel, "Suas mudanças (main)") || !strings.Contains(in.TheirsLabel, "feature") {
		t.Fatalf("rótulos: %q / %q", in.OursLabel, in.TheirsLabel)
	}
	// "UM" (só da feature) e "SEIS" (só da main) entram sozinhos; a linha 3 é o conflito.
	var text strings.Builder
	var conflict MergeChunk
	for _, c := range in.Chunks {
		if c.Conflict {
			conflict = c
		} else {
			text.WriteString(c.Text)
		}
	}
	if conflict.Ours != "TRÊS (main)\n" || conflict.Theirs != "TRÊS (feature)\n" || conflict.Base != "três\n" {
		t.Fatalf("conflito: %+v", conflict)
	}
	if !strings.Contains(text.String(), "UM\n") || !strings.Contains(text.String(), "SEIS\n") {
		t.Fatalf("mesclado sozinho: %q", text.String())
	}

	// Ainda com conflitos: continuar não conclui.
	res, err := f.g.ContinueOperation(f.id)
	if err != nil || res.OK || len(res.Conflicts) != 2 {
		t.Fatalf("continuar com conflitos: %+v %v", res, err)
	}
	if err := f.g.ResolveConflict(f.id, "a.txt", "content", "x\n"+strings.Repeat("<", markerSize)+" ours\n"); err == nil {
		t.Fatal("resultado com marcadores deveria ser recusado")
	}
	if err := f.g.ResolveConflict(f.id, "a.txt", "content", "UM\ndois\nTRÊS (as duas)\nquatro\ncinco\nSEIS\n"); err != nil {
		t.Fatal(err)
	}
	if err := f.g.ResolveConflict(f.id, "x.txt", "theirs", ""); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(f.me, "x.txt")); string(b) != "da feature\n" {
		t.Fatalf("x.txt com o lado deles: %q", b)
	}
	res, err = f.g.ContinueOperation(f.id)
	if err != nil || !res.OK {
		t.Fatalf("concluir o merge: %+v %v", res, err)
	}
	st, _ := f.g.Status(f.id)
	if st.Operation != "" || len(st.Files) != 0 {
		t.Fatalf("depois do merge: %+v", st)
	}
	if parents := gitIn(t, f.me, "log", "-1", "--format=%P"); len(strings.Fields(parents)) != 2 {
		t.Fatalf("deveria ser um commit de merge: %q", parents)
	}
}

func TestConflictDeletedByThem(t *testing.T) {
	f := newSyncFixture(t)
	gitIn(t, f.me, "checkout", "-qb", "apaga")
	gitIn(t, f.me, "rm", "-q", "a.txt")
	gitIn(t, f.me, "commit", "-qm", "apaga a")
	gitIn(t, f.me, "checkout", "-q", "main")
	write(t, f.me, "a.txt", "mudado\n")
	gitIn(t, f.me, "commit", "-qam", "muda a")
	cmd := exec.Command("git", "merge", "-q", "apaga")
	cmd.Dir = f.me
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
	cmd.Run()
	in, err := f.g.ConflictVersions(f.id, "a.txt")
	if err != nil || in.Kind != "deleted-by-them" || in.Ours != "mudado\n" {
		t.Fatalf("apagado por eles: %+v %v", in, err)
	}
	// Ficar com o lado deles = apagar.
	if err := f.g.ResolveConflict(f.id, "a.txt", "theirs", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(f.me, "a.txt")); !os.IsNotExist(err) {
		t.Fatal("a.txt deveria ter sido apagado")
	}
	if res, err := f.g.ContinueOperation(f.id); err != nil || !res.OK {
		t.Fatalf("concluir: %+v %v", res, err)
	}
	if _, err := f.g.ConflictVersions(f.id, "a.txt"); err == nil {
		t.Fatal("sem conflito deveria falhar")
	}
}

func TestParseMergedKeepsMarkerLookalikes(t *testing.T) {
	// Uma linha "<<<<<<< " curta no arquivo não é marcador (o merge-file usa marcadores de 32).
	m := "a\n<<<<<<< não sou marcador\n" + strings.Repeat("<", markerSize) + " ours\nX\n" + strings.Repeat("|", markerSize) + " base\nB\n" + strings.Repeat("=", markerSize) + "\nY\n" + strings.Repeat(">", markerSize) + " theirs\nz\n"
	cs := parseMerged(m)
	if len(cs) != 3 || cs[0].Text != "a\n<<<<<<< não sou marcador\n" || !cs[1].Conflict || cs[1].Ours != "X\n" || cs[1].Base != "B\n" || cs[1].Theirs != "Y\n" || cs[2].Text != "z\n" {
		t.Fatalf("pedaços: %+v", cs)
	}
}
