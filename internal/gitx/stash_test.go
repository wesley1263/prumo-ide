package gitx

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStashSaveListApplyDrop(t *testing.T) {
	f := newSyncFixture(t)
	if err := f.g.StashSave(f.id, "nada", false); err == nil || !strings.Contains(err.Error(), "não há mudanças") {
		t.Fatalf("sem mudanças: %v", err)
	}
	write(t, f.me, "a.txt", "um\nmudado\n")
	write(t, f.me, "novo.txt", "novo\n")
	if err := f.g.StashSave(f.id, "frete pela metade", true); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(f.me, "a.txt")); string(b) != "um\n" {
		t.Fatalf("a árvore deveria voltar ao commit: %q", b)
	}
	if _, err := os.Stat(filepath.Join(f.me, "novo.txt")); !os.IsNotExist(err) {
		t.Fatal("o novo (com --include-untracked) também é guardado")
	}
	list, err := f.g.StashList(f.id)
	if err != nil || len(list) != 1 || list[0].Message != "frete pela metade" || list[0].Branch != "main" || list[0].Files != 2 || list[0].Date == 0 {
		t.Fatalf("lista: %+v %v", list, err)
	}

	// Aplicar sem tirar da pilha; com mudança no mesmo arquivo, avisa em vez de estragar.
	res, err := f.g.StashApply(f.id, 0, false)
	if err != nil || !res.OK {
		t.Fatalf("apply: %+v %v", res, err)
	}
	if b, _ := os.ReadFile(filepath.Join(f.me, "a.txt")); string(b) != "um\nmudado\n" {
		t.Fatalf("depois do apply: %q", b)
	}
	if l, _ := f.g.StashList(f.id); len(l) != 1 {
		t.Fatal("apply não tira da pilha")
	}
	res, _ = f.g.StashApply(f.id, 0, true)
	if res.OK {
		t.Fatalf("aplicar de novo por cima deveria ser recusado: %+v", res)
	}

	// Limpa e faz pop: sai da pilha.
	gitIn(t, f.me, "checkout", "--", "a.txt")
	os.Remove(filepath.Join(f.me, "novo.txt"))
	res, err = f.g.StashApply(f.id, 0, true)
	if err != nil || !res.OK {
		t.Fatalf("pop: %+v %v", res, err)
	}
	if l, _ := f.g.StashList(f.id); len(l) != 0 {
		t.Fatalf("pop deveria tirar da pilha: %+v", l)
	}

	// Drop.
	write(t, f.me, "a.txt", "outra\n")
	f.g.StashSave(f.id, "", false)
	if err := f.g.StashDrop(f.id, 0); err != nil {
		t.Fatal(err)
	}
	if l, _ := f.g.StashList(f.id); len(l) != 0 {
		t.Fatalf("drop: %+v", l)
	}
}
