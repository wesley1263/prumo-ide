package run

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"goide/internal/events"
	"goide/internal/store"
	"goide/internal/workspace"
)

func TestParseCoverProfile(t *testing.T) {
	root := t.TempDir()
	o := &workspace.Open{Project: store.Project{RootPath: root}}
	dirs := map[string]string{"ex.com/app/cart": filepath.Join(root, "cart"), "ex.com/fora": "/outro/lugar"}
	prof := strings.Join([]string{
		"mode: set",
		"ex.com/app/cart/cart.go:10.20,12.2 2 1",
		"ex.com/app/cart/cart.go:14.2,16.3 3 0",
		"ex.com/app/cart/cart.go:10.20,12.2 2 0", // repetido por outro binário: continua coberto
		"ex.com/fora/x.go:1.1,2.2 1 1",           // fora do projeto: ignorado
		"lixo",
	}, "\n")
	cov, err := ParseCoverProfile(strings.NewReader(prof), dirs, o)
	if err != nil {
		t.Fatal(err)
	}
	if len(cov.Files) != 1 || cov.Files[0].Path != "cart/cart.go" || cov.Covered != 2 || cov.Total != 5 {
		t.Fatalf("cobertura: %+v", cov)
	}
	b := cov.Files[0].Blocks
	if len(b) != 2 || !b[0].Covered || b[1].Covered || b[0].StartLine != 10 || b[0].EndCol != 2 {
		t.Fatalf("blocos: %+v", b)
	}
	if len(cov.Packages) != 1 || cov.Packages[0].Covered != 2 {
		t.Fatalf("pacotes: %+v", cov.Packages)
	}
	if _, err := ParseCoverProfile(strings.NewReader(""), dirs, o); err == nil {
		t.Fatal("perfil vazio deveria falhar")
	}
}

// Fluxo real: go test -coverprofile num módulo pequeno, com uma função testada e outra não.
func TestStartCoverageRealGoTest(t *testing.T) {
	goExe, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go ausente")
	}
	ctx := context.Background()
	root := t.TempDir()
	if real, err := filepath.EvalSymlinks(root); err == nil {
		root = real
	}
	os.WriteFile(filepath.Join(root, "go.mod"), []byte("module ex.com/c\n\ngo 1.22\n"), 0o644)
	os.WriteFile(filepath.Join(root, "c.go"), []byte("package c\n\nfunc Usada() int {\n\treturn 1\n}\n\nfunc Esquecida() int {\n\treturn 2\n}\n"), 0o644)
	os.WriteFile(filepath.Join(root, "c_test.go"), []byte("package c\n\nimport \"testing\"\n\nfunc TestUsada(t *testing.T) {\n\tif Usada() != 1 {\n\t\tt.Fatal()\n\t}\n}\n"), 0o644)
	db, _ := store.Open(ctx, filepath.Join(t.TempDir(), "s.db"))
	defer db.Close()
	p, _ := db.TouchProject(ctx, root, "c")
	reg := workspace.NewRegistry(db)
	reg.Add(ctx, p)
	reg.SetTrusted(p.ID, true)
	bus := events.NewBus()
	ch, off := bus.Subscribe()
	defer off()
	m := NewManager(db, reg, bus, func() string { return goExe }, t.TempDir())
	cfg, err := NewRunConfigs(db, reg).FromContext(p.ID, "c_test.go", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.StartCoverage(p.ID, mustBuildCfg(t, db, p.ID)); err == nil {
		t.Fatal("cobertura numa config Go Build deveria falhar")
	}
	info, err := m.StartCoverage(p.ID, cfg.ID)
	if err != nil || !info.Coverage {
		t.Fatalf("start: %+v %v", info, err)
	}
	deadline := time.After(90 * time.Second)
	for {
		select {
		case e := <-ch:
			if e.Name != events.Coverage {
				continue
			}
			cov, err := m.Coverage(info.ID)
			if err != nil {
				t.Fatal(err)
			}
			if len(cov.Files) != 1 || cov.Files[0].Path != "c.go" || cov.Covered != 1 || cov.Total != 2 {
				t.Fatalf("cobertura: %+v", cov)
			}
			return
		case <-deadline:
			t.Fatal("a cobertura não chegou")
		}
	}
}

func mustBuildCfg(t *testing.T, db *store.DB, projectID string) string {
	dir := ""
	c, err := db.SaveRunConfig(context.Background(), store.RunConfig{ProjectID: projectID, Name: "build", Type: "go_build", RunKind: "directory", Directory: &dir})
	if err != nil {
		t.Fatal(err)
	}
	return c.ID
}
