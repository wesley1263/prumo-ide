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

func TestRunConfigsAsProjectFiles(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "go.mod"), []byte("module demo\n\ngo 1.22\n"), 0o644)
	os.MkdirAll(filepath.Join(root, "cmd", "app"), 0o755)
	db, _ := store.Open(ctx, filepath.Join(t.TempDir(), "s.db"))
	defer db.Close()
	p, _ := db.TouchProject(ctx, root, "demo")
	reg := workspace.NewRegistry(db)
	reg.Add(ctx, p)
	rc := NewRunConfigs(db, reg)
	dir := "cmd/app"

	gera, err := rc.Save(p.ID, store.RunConfig{Name: "Gera", Type: "go_build", RunKind: "directory", Directory: &dir, StoreAsProjectFile: true})
	if err != nil {
		t.Fatal(err)
	}
	app, err := rc.Save(p.ID, store.RunConfig{Name: "App: servidor", Type: "go_build", RunKind: "directory", Directory: &dir, RunAfterBuild: true,
		ProgramArgs: "-port 8080", StoreAsProjectFile: true, BeforeLaunch: []store.BeforeTask{{Kind: "run_config", Ref: &gera.ID}}})
	if err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(root, ".prumo", "run", "App_ servidor.json"))
	if err != nil {
		t.Fatal(err)
	}
	if s := string(b); !strings.Contains(s, `"config": "Gera"`) || strings.Contains(s, gera.ID) || strings.Contains(s, `"id"`) {
		t.Fatalf("arquivo deveria apontar pelo nome, sem ids:\n%s", s)
	}

	// Outro clone: banco vazio, só os arquivos (vieram pelo git).
	db2, _ := store.Open(ctx, filepath.Join(t.TempDir(), "s2.db"))
	defer db2.Close()
	p2, _ := db2.TouchProject(ctx, root, "demo")
	reg2 := workspace.NewRegistry(db2)
	reg2.Add(ctx, p2)
	list, err := NewRunConfigs(db2, reg2).List(p2.ID)
	if err != nil || len(list) != 2 {
		t.Fatalf("lista no outro clone: %+v %v", list, err)
	}
	var got store.RunConfig
	for _, c := range list {
		if c.Name == "App: servidor" {
			got = c
		}
	}
	if got.ProgramArgs != "-port 8080" || !got.StoreAsProjectFile || len(got.BeforeLaunch) != 1 || got.BeforeLaunch[0].Ref == nil {
		t.Fatalf("importada: %+v", got)
	}

	// Mudou no arquivo (pull): a lista traz a mudança.
	s := strings.Replace(string(b), "-port 8080", "-port 9090", 1)
	os.WriteFile(filepath.Join(root, ".prumo", "run", "App_ servidor.json"), []byte(s), 0o644)
	list, _ = NewRunConfigs(db2, reg2).List(p2.ID)
	for _, c := range list {
		if c.Name == "App: servidor" && c.ProgramArgs != "-port 9090" {
			t.Fatalf("mudança do arquivo: %+v", c)
		}
	}

	// Renomear troca o arquivo; desmarcar e apagar tiram do projeto.
	app.Name = "App"
	app, _ = rc.Save(p.ID, app)
	if _, err := os.Stat(filepath.Join(root, ".prumo", "run", "App_ servidor.json")); !os.IsNotExist(err) {
		t.Fatal("o arquivo do nome antigo deveria sair")
	}
	app.StoreAsProjectFile = false
	rc.Save(p.ID, app)
	if _, err := os.Stat(filepath.Join(root, ".prumo", "run", "App.json")); !os.IsNotExist(err) {
		t.Fatal("desmarcar tira o arquivo")
	}
	rc.Delete(p.ID, gera.ID)
	if _, err := os.Stat(filepath.Join(root, ".prumo", "run", "Gera.json")); !os.IsNotExist(err) {
		t.Fatal("apagar tira o arquivo")
	}
}

func TestRunConfigsLegacyFolderStillRead(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "go.mod"), []byte("module demo\n\ngo 1.22\n"), 0o644)
	os.MkdirAll(filepath.Join(root, "cmd", "app"), 0o755)
	os.MkdirAll(filepath.Join(root, ".goide", "run"), 0o755)
	os.WriteFile(filepath.Join(root, ".goide", "run", "Antiga.json"), []byte(`{"name":"Antiga","type":"go_build","runKind":"directory","directory":"cmd/app","runAfterBuild":true,"useBuildTags":true}`), 0o644)
	db, _ := store.Open(ctx, filepath.Join(t.TempDir(), "s.db"))
	defer db.Close()
	p, _ := db.TouchProject(ctx, root, "demo")
	reg := workspace.NewRegistry(db)
	reg.Add(ctx, p)
	list, err := NewRunConfigs(db, reg).List(p.ID)
	if err != nil || len(list) != 1 || list[0].Name != "Antiga" {
		t.Fatalf("a config da pasta antiga (.goide/run) deveria entrar: %+v %v", list, err)
	}
}

