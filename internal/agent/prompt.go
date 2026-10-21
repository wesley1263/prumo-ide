package agent

import (
	"fmt"
	"strings"
)

// CommitContext é o que o agente recebe sobre as mudanças que vão para o commit.
type CommitContext struct {
	Branch    string
	Recent    []string // assuntos dos últimos commits (para seguir o estilo do repositório)
	Files     []string // "M path", "A path", "D path"...
	Diff      string   // só do que está marcado para o commit (trechos e linhas incluídos)
	Truncated bool
}

// Langs que a UI manda; "auto" segue os commits recentes.
var langNames = map[string]string{"pt-BR": "Brazilian Portuguese", "en": "English"}

// BuildPrompt monta o pedido. Em inglês (os modelos seguem melhor), pedindo a mensagem no idioma escolhido.
// lang: "auto" (o dos commits recentes; sem eles, uiLang), "pt-BR" ou "en". extra: instruções do usuário.
func BuildPrompt(c CommitContext, lang, uiLang, extra string) string {
	var b strings.Builder
	b.WriteString("You write git commit messages. Write one for the staged changes below.\n\n")
	b.WriteString("Rules:\n")
	b.WriteString("- Reply with the commit message only: no preamble, no explanation, no Markdown, no code fences.\n")
	b.WriteString("- First line: a summary of at most 72 characters, in the imperative mood, without a trailing period.\n")
	b.WriteString("- If the change needs it, add a blank line and a short body (wrapped at 72 columns) that explains why, not how.\n")
	b.WriteString("- Describe what the diff actually does. Do not invent changes, issue numbers or co-authors.\n")
	if len(c.Recent) > 0 {
		b.WriteString("- Follow the style of the recent commits of this repository (for example, a Conventional Commits prefix like \"feat:\" or \"fix:\" if they use one).\n")
	}
	switch name, ok := langNames[lang]; {
	case ok:
		fmt.Fprintf(&b, "- Write the message in %s.\n", name)
	default:
		fallback := langNames[uiLang]
		if fallback == "" {
			fallback = "English"
		}
		if len(c.Recent) > 0 {
			fmt.Fprintf(&b, "- Write the message in the same language as the recent commits (if they are mixed, use %s).\n", fallback)
		} else {
			fmt.Fprintf(&b, "- Write the message in %s.\n", fallback)
		}
	}
	if extra = strings.TrimSpace(extra); extra != "" {
		b.WriteString("\nExtra instructions from the user:\n")
		b.WriteString(extra)
		b.WriteString("\n")
	}
	if c.Branch != "" {
		fmt.Fprintf(&b, "\nBranch: %s\n", c.Branch)
	}
	if len(c.Recent) > 0 {
		b.WriteString("\nRecent commits:\n")
		for _, s := range c.Recent {
			fmt.Fprintf(&b, "- %s\n", s)
		}
	}
	b.WriteString("\nFiles in this commit:\n")
	for _, f := range c.Files {
		fmt.Fprintf(&b, "%s\n", f)
	}
	b.WriteString("\nDiff:\n")
	b.WriteString(c.Diff)
	if !strings.HasSuffix(c.Diff, "\n") {
		b.WriteString("\n")
	}
	if c.Truncated {
		b.WriteString("[The diff was truncated because it is large. Summarize from what is shown and from the file list.]\n")
	}
	return b.String()
}
