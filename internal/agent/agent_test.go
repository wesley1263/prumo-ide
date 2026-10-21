package agent

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestClean(t *testing.T) {
	cases := map[string]string{
		"```\nfeat: add cart\n```":            "feat: add cart",
		"```text\nfix: x\n\nbody line\n```":   "fix: x\n\nbody line",
		"Commit message: feat: y":             "feat: y",
		"\"chore: z\"":                        "chore: z",
		"  feat: a  \r\n\r\n\r\n\r\nbody  \n": "feat: a\n\nbody",
		"Mensagem de commit: corrige o frete": "corrige o frete",
	}
	for in, want := range cases {
		if got := Clean(in); got != want {
			t.Errorf("Clean(%q) = %q, queria %q", in, got, want)
		}
	}
}

func TestBuildPrompt(t *testing.T) {
	c := CommitContext{Branch: "feat/x", Recent: []string{"feat: a", "fix: b"}, Files: []string{"M a.go"}, Diff: "diff --git a/a.go b/a.go\n+x\n"}
	p := BuildPrompt(c, "pt-BR", "en", "Use emoji no início")
	for _, want := range []string{"commit message only", "Brazilian Portuguese", "Conventional Commits", "Use emoji no início", "Branch: feat/x", "- fix: b", "M a.go", "+x"} {
		if !strings.Contains(p, want) {
			t.Errorf("prompt sem %q:\n%s", want, p)
		}
	}
	// auto sem histórico: o idioma da interface.
	if p := BuildPrompt(CommitContext{Diff: "x"}, "auto", "pt-BR", ""); !strings.Contains(p, "Write the message in Brazilian Portuguese") {
		t.Errorf("auto sem commits deveria usar o idioma da UI:\n%s", p)
	}
	if p := BuildPrompt(c, "auto", "en", ""); !strings.Contains(p, "same language as the recent commits") {
		t.Errorf("auto com commits deveria seguir os commits:\n%s", p)
	}
}

// fakeAgent escreve um script que faz o papel do agente: guarda o pedido e a pasta onde rodou, e responde.
func fakeAgent(t *testing.T, reply string, exit int) (string, string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("script de shell")
	}
	dir := t.TempDir()
	seen := filepath.Join(dir, "seen")
	script := filepath.Join(dir, "agente")
	body := "#!/bin/sh\ncat > " + seen + ".prompt\npwd > " + seen + ".cwd\nprintf '%s' \"$*\" > " + seen + ".args\n"
	if exit != 0 {
		body += "echo 'cota esgotada' >&2\nexit " + string(rune('0'+exit)) + "\n"
	} else {
		body += "cat <<'MSG'\n" + reply + "\nMSG\n"
	}
	os.WriteFile(script, []byte(body), 0o755)
	return script, seen
}

func TestRunnerRunsAgentOutsideProjectWithPromptOnStdin(t *testing.T) {
	script, seen := fakeAgent(t, "```\nfeat: frete grátis\n```", 0)
	cmd, err := Resolve("custom", script+" --modo teste", func(s string) ([]string, error) { return strings.Fields(s), nil })
	if err != nil {
		t.Fatal(err)
	}
	msg, err := NewRunner().Run("p1", cmd, "PEDIDO\ndiff aqui")
	if err != nil || msg != "feat: frete grátis" {
		t.Fatalf("run: %q %v", msg, err)
	}
	prompt, _ := os.ReadFile(seen + ".prompt")
	cwd, _ := os.ReadFile(seen + ".cwd")
	args, _ := os.ReadFile(seen + ".args")
	if string(prompt) != "PEDIDO\ndiff aqui" || string(args) != "--modo teste" {
		t.Fatalf("pedido/args: %q %q", prompt, args)
	}
	if !strings.Contains(string(cwd), "prumo-agent-") {
		t.Fatalf("o agente deveria rodar numa pasta temporária própria: %s", cwd)
	}
}

func TestRunnerFailureAndCancel(t *testing.T) {
	script, _ := fakeAgent(t, "", 3)
	cmd := Command{Name: "Agente", Path: script}
	if _, err := NewRunner().Run("p", cmd, "x"); err == nil || !strings.Contains(err.Error(), "cota esgotada") {
		t.Fatalf("falha deveria trazer o stderr: %v", err)
	}

	dir := t.TempDir()
	slow := filepath.Join(dir, "lento")
	os.WriteFile(slow, []byte("#!/bin/sh\nsleep 30\necho tarde\n"), 0o755)
	r := NewRunner()
	done := make(chan error, 1)
	go func() { _, err := r.Run("p", Command{Name: "Lento", Path: slow}, "x"); done <- err }()
	time.Sleep(300 * time.Millisecond)
	r.Cancel("p")
	select {
	case err := <-done:
		if err != ErrCanceled {
			t.Fatalf("cancelar: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("o cancelamento deveria matar o agente na hora")
	}
}

func TestResolve(t *testing.T) {
	split := func(s string) ([]string, error) { return strings.Fields(s), nil }
	if _, err := Resolve("off", "", split); err == nil {
		t.Fatal("desligado deveria recusar")
	}
	if _, err := Resolve("custom", "", split); err == nil {
		t.Fatal("custom sem comando deveria recusar")
	}
	if _, err := Resolve("custom", "/nao/existe/agente", split); err == nil || !strings.Contains(err.Error(), "não encontrado") {
		t.Fatalf("custom inexistente: %v", err)
	}
	if _, err := Resolve("inventado", "", split); err == nil {
		t.Fatal("id desconhecido")
	}
	if len(Detect()) != len(Known) {
		t.Fatal("Detect deveria listar todos os conhecidos")
	}
}
