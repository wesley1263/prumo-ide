package store

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"
)

func openTest(t *testing.T) *DB {
	t.Helper()
	db, err := Open(context.Background(), filepath.Join(t.TempDir(), "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestMigrateIsIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.db")
	for i := 0; i < 2; i++ {
		db, err := Open(context.Background(), path)
		if err != nil {
			t.Fatalf("abertura %d: %v", i, err)
		}
		db.Close()
	}
}

func TestProjectTouchAndTrust(t *testing.T) {
	ctx := context.Background()
	db := openTest(t)
	p, err := db.TouchProject(ctx, "/tmp/x", "x")
	if err != nil {
		t.Fatal(err)
	}
	if p.Trusted || p.Env == nil || p.BuildTags == nil {
		t.Fatalf("defaults errados: %+v", p)
	}
	again, err := db.TouchProject(ctx, "/tmp/x", "x")
	if err != nil || again.ID != p.ID {
		t.Fatalf("reabrir deveria manter o id: %v %s != %s", err, again.ID, p.ID)
	}
	if err := db.SetProjectTrusted(ctx, p.ID, true); err != nil {
		t.Fatal(err)
	}
	got, _ := db.ProjectByID(ctx, p.ID)
	if !got.Trusted {
		t.Fatal("trusted não gravou")
	}
	if err := db.SetProjectTrusted(ctx, "nope", true); err != ErrNotFound {
		t.Fatalf("esperava ErrNotFound, veio %v", err)
	}
}

func TestTemporaryRunConfigsCappedAtFive(t *testing.T) {
	ctx := context.Background()
	db := openTest(t)
	p, _ := db.TouchProject(ctx, "/tmp/x", "x")
	dir := "."
	for i := 0; i < 7; i++ {
		_, err := db.SaveRunConfig(ctx, RunConfig{ProjectID: p.ID, Name: fmt.Sprintf("c%d", i), Type: "go_build",
			Temporary: true, RunKind: "directory", Directory: &dir, RunAfterBuild: true})
		if err != nil {
			t.Fatal(err)
		}
	}
	list, err := db.ListRunConfigs(ctx, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 5 {
		t.Fatalf("esperava 5 temporárias, veio %d", len(list))
	}
}

func TestRunConfigScopedToProject(t *testing.T) {
	ctx := context.Background()
	db := openTest(t)
	a, _ := db.TouchProject(ctx, "/a", "a")
	b, _ := db.TouchProject(ctx, "/b", "b")
	dir := "."
	c, err := db.SaveRunConfig(ctx, RunConfig{ProjectID: a.ID, Name: "run", Type: "go_build", RunKind: "directory", Directory: &dir})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.RunConfigByID(ctx, b.ID, c.ID); err != ErrNotFound {
		t.Fatalf("config de outro projeto não pode vazar: %v", err)
	}
}

func TestSettingsRoundTrip(t *testing.T) {
	ctx := context.Background()
	db := openTest(t)
	if err := db.SetSetting(ctx, "appearance.theme", json.RawMessage(`"light"`)); err != nil {
		t.Fatal(err)
	}
	if err := db.SetSetting(ctx, "bad", json.RawMessage(`{`)); err == nil {
		t.Fatal("JSON inválido deveria falhar")
	}
	got, err := db.GetSettings(ctx, []string{"appearance.theme", "missing"})
	if err != nil {
		t.Fatal(err)
	}
	if string(got["appearance.theme"]) != `"light"` || len(got) != 1 {
		t.Fatalf("settings errados: %v", got)
	}
}

func TestDefaultSdkSwitch(t *testing.T) {
	ctx := context.Background()
	db := openTest(t)
	a, _ := db.UpsertSdk(ctx, "/go1", "go1.24.0", "detected")
	b, _ := db.UpsertSdk(ctx, "/go2", "go1.25.0", "detected")
	if err := db.SetDefaultSdk(ctx, a.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.SetDefaultSdk(ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	list, _ := db.ListSdks(ctx)
	if !list[0].IsDefault || list[0].ID != b.ID || list[1].IsDefault {
		t.Fatalf("padrão errado: %+v", list)
	}
}
