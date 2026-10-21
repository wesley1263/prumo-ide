package gitx

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCherryPickRevertReset(t *testing.T) {
	f := newSyncFixture(t)
	// Um commit num branch lateral para trazer com cherry-pick.
	gitIn(t, f.me, "checkout", "-q", "-b", "lado")
	write(t, f.me, "b.txt", "do lado\n")
	gitIn(t, f.me, "add", "-A")
	gitIn(t, f.me, "commit", "-qm", "lado: b.txt")
	side := strings.TrimSpace(gitIn(t, f.me, "rev-parse", "HEAD"))
	gitIn(t, f.me, "checkout", "-q", "main")

	if _, err := f.g.CherryPick(f.id, "não-é-hash"); err == nil {
		t.Fatal("hash inválido deveria ser recusado")
	}
	res, err := f.g.CherryPick(f.id, side)
	if err != nil || !res.OK {
		t.Fatalf("cherry-pick: %+v %v", res, err)
	}
	if b, _ := os.ReadFile(filepath.Join(f.me, "b.txt")); string(b) != "do lado\n" {
		t.Fatal("o b.txt deveria vir com o cherry-pick")
	}
	if msg := gitIn(t, f.me, "log", "-1", "--format=%s"); strings.TrimSpace(msg) != "lado: b.txt" {
		t.Fatalf("mensagem: %q", msg)
	}

	// Revert do que acabou de entrar: commit novo, b.txt some.
	head := strings.TrimSpace(gitIn(t, f.me, "rev-parse", "HEAD"))
	res, err = f.g.Revert(f.id, head)
	if err != nil || !res.OK {
		t.Fatalf("revert: %+v %v", res, err)
	}
	if _, err := os.Stat(filepath.Join(f.me, "b.txt")); !os.IsNotExist(err) {
		t.Fatal("o revert deveria apagar o b.txt")
	}
	if n := strings.TrimSpace(gitIn(t, f.me, "rev-list", "--count", "HEAD")); n != "3" {
		t.Fatalf("commits depois do revert: %s", n)
	}

	// Cherry-pick que conflita: a operação fica em andamento e a lista de conflitos vem.
	write(t, f.me, "a.txt", "main mudou\n")
	gitIn(t, f.me, "commit", "-qam", "main: a.txt")
	gitIn(t, f.me, "checkout", "-q", "lado")
	write(t, f.me, "a.txt", "lado mudou\n")
	gitIn(t, f.me, "commit", "-qam", "lado: a.txt")
	conflict := strings.TrimSpace(gitIn(t, f.me, "rev-parse", "HEAD"))
	gitIn(t, f.me, "checkout", "-q", "main")
	res, err = f.g.CherryPick(f.id, conflict)
	if err != nil || res.OK || res.Operation != "cherry-pick" || len(res.Conflicts) != 1 || res.Conflicts[0] != "a.txt" {
		t.Fatalf("cherry-pick com conflito: %+v %v", res, err)
	}
	if res, _ := f.g.Revert(f.id, head); res.OK || res.Operation != "cherry-pick" {
		t.Fatalf("outra operação com uma em andamento: %+v", res)
	}
	if err := f.g.AbortOperation(f.id); err != nil {
		t.Fatal(err)
	}

	// Reset soft volta o branch e deixa as mudanças preparadas; hard descarta.
	first := strings.TrimSpace(gitIn(t, f.me, "rev-list", "--max-parents=0", "HEAD"))
	res, err = f.g.Reset(f.id, first, "soft")
	if err != nil || !res.OK {
		t.Fatalf("reset soft: %+v %v", res, err)
	}
	if staged := gitIn(t, f.me, "diff", "--cached", "--name-only"); !strings.Contains(staged, "a.txt") {
		t.Fatalf("soft deveria deixar preparado: %q", staged)
	}
	if _, err := f.g.Reset(f.id, first, "explodir"); err == nil {
		t.Fatal("modo inválido")
	}
	if res, err := f.g.Reset(f.id, first, "hard"); err != nil || !res.OK {
		t.Fatalf("reset hard: %+v %v", res, err)
	}
	if b, _ := os.ReadFile(filepath.Join(f.me, "a.txt")); string(b) != "um\n" {
		t.Fatalf("hard deveria voltar o arquivo: %q", b)
	}
}
