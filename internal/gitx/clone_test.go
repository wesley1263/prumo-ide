package gitx

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"goide/internal/events"
)

func TestCloneLocalAndErrors(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git ausente")
	}
	f := newSyncFixture(t)
	bus := events.NewBus()
	g := New(f.g.reg, bus, f.g.gitExe)
	ch, off := bus.Subscribe()
	defer off()
	parent := t.TempDir()

	start, err := g.Clone(f.remote, parent, "")
	if err != nil {
		t.Fatal(err)
	}
	if start.Path != filepath.Join(parent, "remoto") {
		t.Fatalf("pasta sugerida: %s", start.Path)
	}
	var final CloneProgress
	deadline := time.After(30 * time.Second)
	for !final.Done {
		select {
		case e := <-ch:
			if p, ok := e.Data.(CloneProgress); ok && p.ID == start.ID && p.Done {
				final = p
			}
		case <-deadline:
			t.Fatal("o clone não terminou")
		}
	}
	if !final.OK || final.Error != "" {
		t.Fatalf("clone: %+v", final)
	}
	if b, err := os.ReadFile(filepath.Join(start.Path, "a.txt")); err != nil || string(b) != "um\n" {
		t.Fatalf("arquivo clonado: %q %v", b, err)
	}

	// Pasta já ocupada, URL perigosa ou sem sentido, destino relativo.
	if _, err := g.Clone(f.remote, parent, ""); err == nil || !strings.Contains(err.Error(), "não está vazia") {
		t.Fatalf("destino ocupado: %v", err)
	}
	for _, bad := range []string{"", "--upload-pack=touch /tmp/x", "ext::sh -c touch% /tmp/x", "repo sem esquema"} {
		if _, err := g.Clone(bad, parent, "x"); err == nil {
			t.Errorf("URL %q deveria ser recusada", bad)
		}
	}
	if _, err := g.Clone(f.remote, "relativo", "x"); err == nil {
		t.Fatal("destino relativo deveria falhar")
	}
	if _, err := g.Clone(f.remote, parent, "../fora"); err == nil {
		t.Fatal("nome com / deveria falhar")
	}

	// Repositório que não existe: termina com erro e não deixa a pasta para trás.
	missing, err := g.Clone(filepath.Join(parent, "nao-existe.git"), parent, "falha")
	if err != nil {
		t.Fatal(err)
	}
	final = CloneProgress{}
	for !final.Done {
		select {
		case e := <-ch:
			if p, ok := e.Data.(CloneProgress); ok && p.ID == missing.ID && p.Done {
				final = p
			}
		case <-time.After(30 * time.Second):
			t.Fatal("o clone com erro não terminou")
		}
	}
	if final.OK || !strings.Contains(final.Error, "não encontrado") {
		t.Fatalf("erro esperado: %+v", final)
	}
	if _, err := os.Stat(missing.Path); !os.IsNotExist(err) {
		t.Fatal("a pasta do clone que falhou deveria sumir")
	}
}

func TestRepoNameAndProgress(t *testing.T) {
	for in, want := range map[string]string{
		"https://github.com/org/app.git": "app",
		"git@github.com:org/lib.git":     "lib",
		"ssh://git@host/x/y/":            "y",
		"/srv/git/proj.git":              "proj",
	} {
		if got := RepoName(in); got != want {
			t.Errorf("RepoName(%q) = %q; quero %q", in, got, want)
		}
	}
	if ph, p, ok := parseCloneLine("Receiving objects:  50% (5/10), 1.00 KiB | 1 MiB/s"); !ok || ph != "Recebendo objetos" || p != 45 {
		t.Fatalf("progresso: %q %d %v", ph, p, ok)
	}
	if _, p, ok := parseCloneLine("remote: Counting objects: 100% (3/3), done."); !ok || p != 5 {
		t.Fatalf("progresso do remoto: %d %v", p, ok)
	}
	if _, _, ok := parseCloneLine("Cloning into 'x'..."); ok {
		t.Fatal("linha sem progresso não conta")
	}
}
