package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMigrateDir(t *testing.T) {
	base := t.TempDir()
	os.MkdirAll(filepath.Join(base, LegacyName), 0o755)
	os.WriteFile(filepath.Join(base, LegacyName, "state.db"), []byte("x"), 0o644)
	MigrateDir(base, LegacyName, Name)
	if b, err := os.ReadFile(filepath.Join(base, Name, "state.db")); err != nil || string(b) != "x" {
		t.Fatalf("a pasta antiga deveria virar a nova: %v", err)
	}
	// Com a nova já existindo, não mexe em nada (a antiga, se reaparecer, fica).
	os.MkdirAll(filepath.Join(base, LegacyName), 0o755)
	MigrateDir(base, LegacyName, Name)
	if _, err := os.Stat(filepath.Join(base, LegacyName)); err != nil {
		t.Fatal("com a nova presente, a antiga não deveria ser movida")
	}
}
