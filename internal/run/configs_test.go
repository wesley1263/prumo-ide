package run

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"prumo/internal/store"
	"prumo/internal/workspace"
)

func TestValidateAndSave(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "cmd", "app"), 0o755)
	os.WriteFile(filepath.Join(root, "cmd", "app", "main.go"), []byte("package main\nfunc main() {}\n"), 0o644)
	os.WriteFile(filepath.Join(root, "in.txt"), []byte("x\n"), 0o644)
	db, _ := store.Open(ctx, filepath.Join(t.TempDir(), "s.db"))
	defer db.Close()
	p, _ := db.TouchProject(ctx, root, "p")
	reg := workspace.NewRegistry(db)
	reg.Add(ctx, p)
	rc := NewRunConfigs(db, reg)
	str := func(s string) *string { return &s }

	good := store.RunConfig{Name: "app", Type: "go_build", RunKind: "directory", Directory: str("cmd/app"), RunAfterBuild: true,
		WorkingDir: str("cmd"), RedirectInputFrom: str("in.txt"), Env: map[string]string{"PORT": "8080", "_X1": ""}, ProgramArgs: `-v "a b"`}
	if probs, err := rc.Validate(p.ID, good); err != nil || len(probs) != 0 {
		t.Fatalf("config boa: %v %v", probs, err)
	}
	saved, err := rc.Save(p.ID, good)
	if err != nil || saved.ID == "" {
		t.Fatalf("salvar: %+v %v", saved, err)
	}
	// Salvar de novo a mesma (mesmo id) não acusa nome repetido; outra com o mesmo nome, sim.
	if probs, _ := rc.Validate(p.ID, saved); len(probs) != 0 {
		t.Fatalf("a própria config acusou: %v", probs)
	}
	dup := good
	if probs, _ := rc.Validate(p.ID, dup); probs["name"] == "" {
		t.Fatal("nome repetido deveria acusar")
	}

	bad := store.RunConfig{Name: " ", Type: "go_test", RunKind: "file", Files: []string{"nao/existe.go"},
		WorkingDir: str("sumiu"), OutputDir: str("../fora"), RedirectInputFrom: str("cmd"), Env: map[string]string{"1X": "a"},
		ProgramArgs: `"aberto`, GoToolArgs: `'aberto`, TestPattern: str("TestA/(")}
	probs, _ := rc.Validate(p.ID, bad)
	for _, f := range []string{"name", "files", "workingDir", "outputDir", "redirectInputFrom", "env", "programArgs", "goToolArgs", "testPattern"} {
		if probs[f] == "" {
			t.Errorf("campo %s deveria acusar; problemas: %v", f, probs)
		}
	}
	if _, err := rc.Save(p.ID, bad); err == nil || !strings.Contains(err.Error(), "nome") {
		t.Fatalf("salvar config ruim: %v", err)
	}
	pkg := store.RunConfig{Name: "pkg", Type: "go_build", RunKind: "package", PackagePath: str("")}
	if probs, _ := rc.Validate(p.ID, pkg); probs["packagePath"] == "" {
		t.Fatal("pacote vazio deveria acusar")
	}
	if probs, _ := rc.Validate(p.ID, store.RunConfig{Name: "x", Type: "go_build", RunKind: "?"}); probs["runKind"] == "" {
		t.Fatal("run kind desconhecido deveria acusar")
	}
}
