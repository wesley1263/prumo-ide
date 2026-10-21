package sdk

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"prumo/internal/store"
	"prumo/internal/tools"
)

func tgz(t *testing.T, files map[string]string) []byte {
	var b bytes.Buffer
	gz := gzip.NewWriter(&b)
	tw := tar.NewWriter(gz)
	for name, body := range files {
		tw.WriteHeader(&tar.Header{Name: name, Mode: 0o755, Size: int64(len(body)), Typeflag: tar.TypeReg})
		tw.Write([]byte(body))
	}
	tw.Close()
	gz.Close()
	return b.Bytes()
}

func TestDownloadSdk(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("o teste monta um .tar.gz")
	}
	good := tgz(t, map[string]string{"go/VERSION": "go1.99.1\ntime 2026\n", "go/bin/go": "#!/bin/sh\n"})
	evil := tgz(t, map[string]string{"../fora.txt": "x", "go/VERSION": "go1.99.3\n", "go/bin/go": "x"})
	sum := func(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
	file := func(v string, body []byte, sha string) map[string]any {
		return map[string]any{"filename": v + "." + runtime.GOOS + "-" + runtime.GOARCH + ".tar.gz", "os": runtime.GOOS, "arch": runtime.GOARCH, "sha256": sha, "size": len(body), "kind": "archive"}
	}
	list := []map[string]any{
		{"version": "go1.99.1", "stable": true, "files": []any{file("go1.99.1", good, sum(good))}},
		{"version": "go1.99.2", "stable": true, "files": []any{file("go1.99.2", good, strings.Repeat("0", 64))}},
		{"version": "go1.99.3", "stable": true, "files": []any{file("go1.99.3", evil, sum(evil))}},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Query().Get("mode") == "json":
			json.NewEncoder(w).Encode(list)
		case strings.HasPrefix(r.URL.Path, "/go1.99.3"):
			w.Write(evil)
		default:
			w.Write(good)
		}
	}))
	defer srv.Close()

	ctx := context.Background()
	db, _ := store.Open(ctx, filepath.Join(t.TempDir(), "s.db"))
	defer db.Close()
	s := New(db, &tools.Finder{})
	dest := t.TempDir()
	d := s.dl()
	d.base = srv.URL + "/"
	d.dest = func() (string, error) { return dest, nil }

	rel, err := s.Available()
	if err != nil || len(rel) != 3 || rel[0].Version != "go1.99.1" {
		t.Fatalf("lista: %+v %v", rel, err)
	}
	wait := func(v string) DownloadState {
		deadline := time.Now().Add(20 * time.Second)
		for time.Now().Before(deadline) {
			st, _ := s.DownloadStatus(v)
			if st.Phase == "pronto" || st.Phase == "erro" {
				return st
			}
			time.Sleep(20 * time.Millisecond)
		}
		t.Fatal("timeout")
		return DownloadState{}
	}
	if _, err := s.Download("go1.99.1; rm -rf /"); err == nil {
		t.Fatal("versão inválida")
	}
	if _, err := s.Download("go1.99.1"); err != nil {
		t.Fatal(err)
	}
	if st := wait("go1.99.1"); st.Phase != "pronto" || st.Goroot != filepath.Join(dest, "go1.99.1") {
		t.Fatalf("pronto: %+v", st)
	}
	sdks, _ := s.List()
	if len(sdks) != 1 || sdks[0].Version != "go1.99.1" || sdks[0].Source != "downloaded" {
		t.Fatalf("registrado: %+v", sdks)
	}
	if _, err := s.Download("go1.99.1"); err == nil || !strings.Contains(err.Error(), "já está") {
		t.Fatalf("de novo: %v", err)
	}
	if _, err := s.Download("go1.99.2"); err != nil {
		t.Fatal(err)
	}
	if st := wait("go1.99.2"); st.Phase != "erro" || !strings.Contains(st.Error, "sha256") {
		t.Fatalf("sha256 errado: %+v", st)
	}
	if _, err := s.Download("go1.99.3"); err != nil {
		t.Fatal(err)
	}
	if st := wait("go1.99.3"); st.Phase != "erro" || !strings.Contains(st.Error, "caminho inválido") {
		t.Fatalf("caminho para fora: %+v", st)
	}
	if Version(filepath.Join(dest, "go1.99.2")) != "" || Version(filepath.Join(dest, "go1.99.3")) != "" {
		t.Fatal("nada deveria ter sido instalado nos que falharam")
	}
}
