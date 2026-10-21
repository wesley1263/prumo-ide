package files

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"prumo/internal/store"
	"prumo/internal/workspace"
)

func setup(t *testing.T) (*Files, string, string) {
	t.Helper()
	ctx := context.Background()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "s.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	root := t.TempDir()
	p, _ := db.TouchProject(ctx, root, "p")
	reg := workspace.NewRegistry(db)
	if _, err := reg.Add(ctx, p); err != nil {
		t.Fatal(err)
	}
	return New(reg), p.ID, root
}

func TestTreeOrderAndHidden(t *testing.T) {
	f, id, root := setup(t)
	os.Mkdir(filepath.Join(root, ".git"), 0o755)
	os.Mkdir(filepath.Join(root, "zdir"), 0o755)
	os.WriteFile(filepath.Join(root, "B.go"), nil, 0o644)
	os.WriteFile(filepath.Join(root, "a.go"), nil, 0o644)
	nodes, err := f.Tree(id, "")
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, n := range nodes {
		names = append(names, n.Name)
	}
	if len(names) != 3 || names[0] != "zdir" || names[1] != "a.go" || names[2] != "B.go" {
		t.Fatalf("ordem errada: %v", names)
	}
	if _, err := f.Tree(id, "../"); err == nil {
		t.Fatal("subir acima da raiz deveria falhar")
	}
}

func TestReadDetectsBinaryAndCRLF(t *testing.T) {
	f, id, root := setup(t)
	os.WriteFile(filepath.Join(root, "bin"), []byte{0, 1, 2}, 0o644)
	os.WriteFile(filepath.Join(root, "win.txt"), []byte("a\r\nb\r\n"), 0o644)
	b, _ := f.Read(id, "bin")
	if !b.Binary || b.Content != "" {
		t.Fatalf("binário não detectado: %+v", b)
	}
	w, _ := f.Read(id, "win.txt")
	if w.LineEnding != "\r\n" {
		t.Fatalf("CRLF não detectado: %q", w.LineEnding)
	}
}

func TestWriteConflict(t *testing.T) {
	f, id, root := setup(t)
	p := filepath.Join(root, "main.go")
	os.WriteFile(p, []byte("package main\n"), 0o600)
	fc, _ := f.Read(id, "main.go")

	res, err := f.Write(id, "main.go", "package main // 1\n", fc.Mtime)
	if err != nil || res.Conflict {
		t.Fatalf("primeira escrita: %+v %v", res, err)
	}
	if st, _ := os.Stat(p); st.Mode().Perm() != 0o600 {
		t.Fatalf("permissão perdida: %v", st.Mode().Perm())
	}
	// Escrever de novo com o mtime antigo = alguém mudou o disco no meio.
	res, err = f.Write(id, "main.go", "package main // 2\n", fc.Mtime-1000)
	if err != nil || !res.Conflict {
		t.Fatalf("esperava conflito: %+v %v", res, err)
	}
	data, _ := os.ReadFile(p)
	if string(data) != "package main // 1\n" {
		t.Fatalf("conflito não pode gravar: %q", data)
	}
	// Arquivo novo.
	res, err = f.Write(id, "novo.go", "package main\n", 0)
	if err != nil || res.Conflict || res.Mtime == 0 {
		t.Fatalf("arquivo novo: %+v %v", res, err)
	}
}

func TestReadExternalOnlyAllowedRoots(t *testing.T) {
	f, id, _ := setup(t)
	goroot := t.TempDir()
	os.MkdirAll(filepath.Join(goroot, "src", "fmt"), 0o755)
	os.WriteFile(filepath.Join(goroot, "src", "fmt", "print.go"), []byte("package fmt\n"), 0o644)
	secret := filepath.Join(t.TempDir(), "secret.txt")
	os.WriteFile(secret, []byte("x"), 0o644)

	fc, err := f.ReadExternal(id, filepath.Join(goroot, "src", "fmt", "print.go"), []string{goroot})
	if err != nil || !fc.ReadOnly || fc.Content != "package fmt\n" {
		t.Fatalf("stdlib: %+v %v", fc, err)
	}
	for _, bad := range []string{secret, filepath.Join(goroot, "..", filepath.Base(secret)), goroot} {
		if _, err := f.ReadExternal(id, bad, []string{goroot}); err == nil {
			t.Errorf("deveria recusar %s", bad)
		}
	}
}
