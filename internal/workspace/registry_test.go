package workspace

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestSafeJoin(t *testing.T) {
	root := filepath.FromSlash("/proj")
	ok := map[string]string{
		"":            "/proj",
		"main.go":     "/proj/main.go",
		"a/b/../c.go": "/proj/a/c.go",
		"./x":         "/proj/x",
	}
	for in, want := range ok {
		got, err := SafeJoin(root, in)
		if err != nil || got != filepath.FromSlash(want) {
			t.Errorf("SafeJoin(%q) = %q, %v; quero %q", in, got, err, want)
		}
	}
	for _, bad := range []string{"..", "../etc/passwd", "a/../../x", "/etc/passwd", "a\x00b"} {
		if _, err := SafeJoin(root, bad); !errors.Is(err, ErrOutsideProject) {
			t.Errorf("SafeJoin(%q) deveria recusar, veio %v", bad, err)
		}
	}
}

func TestRel(t *testing.T) {
	o := &Open{}
	o.RootPath = filepath.FromSlash("/proj")
	if r, err := o.Rel(filepath.FromSlash("/proj/a/b.go")); err != nil || r != "a/b.go" {
		t.Fatalf("Rel = %q, %v", r, err)
	}
	if r, err := o.Rel(filepath.FromSlash("/proj")); err != nil || r != "" {
		t.Fatalf("Rel(raiz) = %q, %v", r, err)
	}
	if _, err := o.Rel(filepath.FromSlash("/proja/x")); err == nil {
		t.Fatal("irmão com prefixo comum não é parte do projeto")
	}
}
