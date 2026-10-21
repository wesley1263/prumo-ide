package search

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"prumo/internal/events"
	"prumo/internal/files"
	"prumo/internal/store"
	"prumo/internal/workspace"
)

// setup cria um projeto com os arquivos dados e devolve o serviço e o id.
func setup(t *testing.T, tree map[string]string) (*Service, *workspace.Registry, string, string) {
	t.Helper()
	ctx := context.Background()
	root := t.TempDir()
	if real, err := filepath.EvalSymlinks(root); err == nil {
		root = real
	}
	for rel, content := range tree {
		abs := filepath.Join(root, filepath.FromSlash(rel))
		os.MkdirAll(filepath.Dir(abs), 0o755)
		if err := os.WriteFile(abs, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "s.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	p, _ := db.TouchProject(ctx, root, "p")
	reg := workspace.NewRegistry(db)
	if _, err := reg.Add(ctx, p); err != nil {
		t.Fatal(err)
	}
	git := func() string { p, _ := exec.LookPath("git"); return p }
	return New(reg, events.NewBus(), files.New(reg), git), reg, p.ID, root
}

func paths(hits []FileHit) []string {
	out := make([]string, len(hits))
	for i, h := range hits {
		out[i] = h.Path
	}
	return out
}

func TestFilesFuzzy(t *testing.T) {
	s, _, id, _ := setup(t, map[string]string{
		"main.go":                       "",
		"handlers/orders.go":            "",
		"handlers/orders_test.go":       "",
		"internal/store/order_store.go": "",
		"docs/border.md":                "",
		"internal/user_service.go":      "",
		"internal/UserService.java":     "",
		"internal/users.go":             "",
		"node_modules/x/orders.js":      "",
	})
	cases := []struct {
		q     string
		first string
	}{
		{"orders", "handlers/orders.go"},
		{"hand/ord", "handlers/orders.go"},
		{"ostore", "internal/store/order_store.go"},
	}
	for _, c := range cases {
		hits, err := s.Files(id, c.q, 10)
		if err != nil {
			t.Fatal(err)
		}
		if len(hits) == 0 || hits[0].Path != c.first {
			t.Errorf("%q: primeiro = %v; quero %s", c.q, paths(hits), c.first)
		}
	}
	// "us": início de palavra em user_service (u, _s) e no CamelCase (U, S) vale mais que o "s" no meio de users.
	for _, q := range []string{"usrsvc", "US"} {
		hits, _ := s.Files(id, q, 10)
		if len(hits) < 2 || !strings.Contains(strings.ToLower(hits[0].Path+hits[1].Path), "user_service") || !strings.Contains(hits[0].Path+hits[1].Path, "UserService") {
			t.Errorf("%q: primeiros = %v", q, paths(hits))
		}
	}
	hits, _ := s.Files(id, "zzz", 10)
	if len(hits) != 0 {
		t.Errorf("zzz não deveria achar nada: %v", paths(hits))
	}
	all, _ := s.Files(id, "", 100)
	for _, h := range all {
		if strings.HasPrefix(h.Path, "node_modules/") {
			t.Errorf("node_modules não entra na lista: %s", h.Path)
		}
	}
	// Posições marcam os caracteres casados (a UI destaca).
	hits, _ = s.Files(id, "usrsvc", 1)
	got := ""
	for _, p := range hits[0].Positions {
		got += string(hits[0].Path[p])
	}
	if strings.ToLower(got) != "usrsvc" {
		t.Errorf("posições %v marcam %q", hits[0].Positions, got)
	}
}

func TestFuzzyKeepsMatchFeasible(t *testing.T) {
	// O "a" de início de palavra mais à frente não pode roubar o casamento: depois dele não há "b".
	if _, _, ok := matchRunes([]rune("ab"), []rune("xab_a"), 0); !ok {
		t.Fatal("ab deveria casar em xab_a")
	}
}

func TestPositionsAreUTF16(t *testing.T) {
	// "😀" ocupa 2 unidades UTF-16: a posição do "x" depois dele é 2, não 1.
	if got := utf16Positions("😀x", []int{1}); !reflect.DeepEqual(got, []int{2}) {
		t.Fatalf("posições = %v", got)
	}
}

func TestFilesRespectGitignoreWhenTrusted(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git ausente")
	}
	s, reg, id, root := setup(t, map[string]string{
		".gitignore":   "build/\n*.log\n",
		"a.go":         "",
		"build/out.go": "",
		"debug.log":    "",
	})
	if out, err := exec.Command("git", "-C", root, "init", "-q").CombinedOutput(); err != nil {
		t.Fatalf("%v %s", err, out)
	}
	// Sem confiança: varredura simples (o git não roda), então os ignorados aparecem.
	all, _ := s.Files(id, "", 100)
	if !reflect.DeepEqual(paths(all), []string{".gitignore", "a.go", "build/out.go", "debug.log"}) {
		t.Fatalf("sem confiança: %v", paths(all))
	}
	reg.SetTrusted(id, true)
	time.Sleep(indexTTL + 100*time.Millisecond) // vence o cache
	all, _ = s.Files(id, "", 100)
	if !reflect.DeepEqual(paths(all), []string{".gitignore", "a.go"}) {
		t.Fatalf("com confiança: %v", paths(all))
	}
}

// waitText roda a busca até o fim e devolve todas as ocorrências.
func waitText(t *testing.T, s *Service, id string, opt Options) TextResults {
	t.Helper()
	sid, err := s.Text(id, opt)
	if err != nil {
		t.Fatal(err)
	}
	var all TextResults
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		r, err := s.Results(sid, all.Next, 0)
		if err != nil {
			t.Fatal(err)
		}
		all.Matches = append(all.Matches, r.Matches...)
		all.Next, all.Done, all.Truncated, all.Files, all.Error = r.Next, r.Done, r.Truncated, r.Files, r.Error
		if r.Done {
			return all
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("a busca não terminou")
	return all
}

func where(ms []Match) []string {
	out := make([]string, len(ms))
	for i, m := range ms {
		out[i] = m.Path + ":" + strconv.Itoa(m.Line) + ":" + strconv.Itoa(m.Col)
	}
	return out
}

func TestTextSearch(t *testing.T) {
	long := strings.Repeat("x", 500) + "Order" + strings.Repeat("y", 500)
	s, _, id, _ := setup(t, map[string]string{
		"a.go":        "package a\n\nfunc NewOrder() {}\n// order, orders, Order\n",
		"b/b.go":      "package b\r\nvar x = \"😀Order\"\r\n",
		"b/b_test.go": "package b // Order\n",
		"img.png":     "\x89PNG\x00\x00Order",
		"long.txt":    long,
		"notes/n.md":  "Order\n",
		"empty.go":    "",
		"nolf.go":     "last Order",
	})

	r := waitText(t, s, id, Options{Query: "order"})
	want := []string{"a.go:3:9", "a.go:4:4", "a.go:4:11", "a.go:4:19", "b/b.go:2:12", "b/b_test.go:1:14", "long.txt:1:501", "nolf.go:1:6", "notes/n.md:1:1"}
	if !reflect.DeepEqual(where(r.Matches), want) {
		t.Fatalf("sem diferenciar maiúsculas:\n got %v\nwant %v", where(r.Matches), want)
	}
	if r.Files != 6 || r.Error != "" {
		t.Errorf("arquivos = %d, erro = %q", r.Files, r.Error)
	}
	// Coluna em UTF-16: o emoji conta 2; o \r do CRLF não aparece.
	for _, m := range r.Matches {
		if m.Path == "b/b.go" && (m.Preview != "var x = \"😀Order\"" || m.Start != 11 || m.End != 16) {
			t.Errorf("prévia CRLF/UTF-16: %+v", m)
		}
		if m.Path == "long.txt" {
			if len(m.Preview) > previewMax+10 || m.Preview[m.Start:m.End] != "Order" {
				t.Errorf("prévia da linha longa: start=%d end=%d len=%d", m.Start, m.End, len(m.Preview))
			}
		}
	}

	r = waitText(t, s, id, Options{Query: "Order", CaseSensitive: true, WholeWords: true, Mask: "*.go, !*_test.go"})
	if !reflect.DeepEqual(where(r.Matches), []string{"a.go:4:19", "b/b.go:2:12", "nolf.go:1:6"}) { // o emoji não é letra: há fronteira antes de Order
		t.Fatalf("palavra inteira + máscara: %v", where(r.Matches))
	}
	r = waitText(t, s, id, Options{Query: `func \w+\(`, Regex: true})
	if !reflect.DeepEqual(where(r.Matches), []string{"a.go:3:1"}) || r.Matches[0].Len != 14 {
		t.Fatalf("regex: %+v", r.Matches)
	}
	r = waitText(t, s, id, Options{Query: "order", Dir: "b"})
	if !reflect.DeepEqual(where(r.Matches), []string{"b/b.go:2:12", "b/b_test.go:1:14"}) {
		t.Fatalf("escopo de pasta: %v", where(r.Matches))
	}
	if _, err := s.Text(id, Options{Query: "(", Regex: true}); err == nil || !strings.Contains(err.Error(), "inválida") {
		t.Fatalf("regex inválida: %v", err)
	}
	if _, err := s.Text(id, Options{Query: "x", Dir: "../fora"}); err == nil {
		t.Fatal("escopo fora do projeto deveria falhar")
	}
	if _, err := s.Text(id, Options{Query: ""}); err == nil {
		t.Fatal("busca vazia deveria falhar")
	}
}

func TestNewSearchReplacesOld(t *testing.T) {
	s, _, id, _ := setup(t, map[string]string{"a.go": "x\n"})
	first, _ := s.Text(id, Options{Query: "x"})
	waitText(t, s, id, Options{Query: "x"})
	if _, err := s.Results(first, 0, 0); err == nil {
		t.Fatal("a busca anterior deveria ter sido descartada")
	}
}

func TestTruncatesAtMax(t *testing.T) {
	s, _, id, _ := setup(t, map[string]string{"a.txt": strings.Repeat("a\n", MaxMatches+50)})
	r := waitText(t, s, id, Options{Query: "a"})
	if len(r.Matches) != MaxMatches || !r.Truncated {
		t.Fatalf("matches = %d, truncado = %v", len(r.Matches), r.Truncated)
	}
}

func TestReplace(t *testing.T) {
	s, _, id, root := setup(t, map[string]string{
		"a.go": "package a\r\n\r\nfunc oldName() { oldName() }\r\n",
		"b.go": "package b\n\nvar v = oldName\n",
	})
	opt := Options{Query: "oldName", CaseSensitive: true}
	r := waitText(t, s, id, opt)
	if len(r.Matches) != 3 {
		t.Fatalf("matches: %v", where(r.Matches))
	}
	// Troca a 1ª e a 3ª; a 2ª (a.go:3:18) fica. Mais um alvo que não existe: conta como pulado.
	targets := []Target{
		{Path: "a.go", Line: 3, Col: 6},
		{Path: "b.go", Line: 3, Col: 9},
		{Path: "b.go", Line: 1, Col: 1},
	}
	res, err := s.Replace(id, opt, "newName", targets)
	if err != nil {
		t.Fatal(err)
	}
	if res.Replaced != 2 || res.Skipped != 1 || !reflect.DeepEqual(res.Paths, []string{"a.go", "b.go"}) {
		t.Fatalf("resultado: %+v", res)
	}
	a, _ := os.ReadFile(filepath.Join(root, "a.go"))
	if string(a) != "package a\r\n\r\nfunc newName() { oldName() }\r\n" {
		t.Fatalf("a.go (CRLF preservado): %q", a)
	}
	b, _ := os.ReadFile(filepath.Join(root, "b.go"))
	if string(b) != "package b\n\nvar v = newName\n" {
		t.Fatalf("b.go: %q", b)
	}

	// Regex com grupo.
	ropt := Options{Query: `func (\w+)\(\)`, Regex: true}
	res, err = s.Replace(id, ropt, "func ${1}V2()", []Target{{Path: "a.go", Line: 3, Col: 1}})
	if err != nil || res.Replaced != 1 {
		t.Fatalf("regex: %+v %v", res, err)
	}
	a, _ = os.ReadFile(filepath.Join(root, "a.go"))
	if !strings.Contains(string(a), "func newNameV2() { oldName() }") {
		t.Fatalf("regex com grupo: %q", a)
	}

	// Alvo velho (o arquivo mudou depois da busca): pulado, arquivo intacto.
	before, _ := os.ReadFile(filepath.Join(root, "b.go"))
	res, _ = s.Replace(id, opt, "zzz", []Target{{Path: "b.go", Line: 3, Col: 9}})
	after, _ := os.ReadFile(filepath.Join(root, "b.go"))
	if res.Replaced != 0 || res.Skipped != 1 || string(before) != string(after) {
		t.Fatalf("alvo velho: %+v %q", res, after)
	}
	if _, err := s.Replace(id, opt, "x", []Target{{Path: "../fora.go", Line: 1, Col: 1}}); err == nil {
		t.Fatal("caminho fora do projeto deveria falhar")
	}
}
