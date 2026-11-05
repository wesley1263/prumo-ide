package agent

import (
	"fmt"
	"strings"
)

// MergeRequestContext é o que o agente recebe para escrever o título e a descrição do merge request.
type MergeRequestContext struct {
	Source    string
	Target    string
	Commits   []string // mensagens completas, da mais antiga para a mais nova
	Stat      string
	Diff      string
	Truncated bool
	Template  string // modelo de descrição do repositório (.gitlab/merge_request_templates/Default.md)
}

// BuildMergeRequestPrompt monta o pedido. A resposta esperada: o título na primeira linha, uma linha em
// branco e a descrição em Markdown.
func BuildMergeRequestPrompt(c MergeRequestContext, lang, uiLang, extra string) string {
	var b strings.Builder
	b.WriteString("You write GitLab merge request titles and descriptions. Write them for the branch below.\n\n")
	b.WriteString("Rules:\n")
	b.WriteString("- Reply with the title on the first line, then a blank line, then the description. Nothing else: no preamble, no code fences around the reply.\n")
	b.WriteString("- Title: at most 72 characters, says what the merge request does, without a trailing period. If the commits use a prefix convention (like \"feat:\"), follow it.\n")
	b.WriteString("- Description in Markdown: a short summary of what changes and why, then the notable changes as a list. Mention anything a reviewer should test or watch out for, if the diff shows it.\n")
	b.WriteString("- Describe what the diff actually does. Do not invent issue numbers, links, screenshots or test results.\n")
	if strings.TrimSpace(c.Template) != "" {
		b.WriteString("- The repository has a description template (below). Fill it in, keeping its headings; leave a section empty if the diff says nothing about it.\n")
	}
	switch name, ok := langNames[lang]; {
	case ok:
		fmt.Fprintf(&b, "- Write in %s.\n", name)
	default:
		fallback := langNames[uiLang]
		if fallback == "" {
			fallback = "English"
		}
		fmt.Fprintf(&b, "- Write in the same language as the commit messages (if they are mixed, use %s).\n", fallback)
	}
	if extra = strings.TrimSpace(extra); extra != "" {
		b.WriteString("\nExtra instructions from the user:\n")
		b.WriteString(extra)
		b.WriteString("\n")
	}
	fmt.Fprintf(&b, "\nSource branch: %s\nTarget branch: %s\n", c.Source, c.Target)
	if strings.TrimSpace(c.Template) != "" {
		b.WriteString("\nDescription template:\n")
		b.WriteString(strings.TrimSpace(c.Template))
		b.WriteString("\n")
	}
	b.WriteString("\nCommits (oldest first):\n")
	for _, m := range c.Commits {
		b.WriteString("---\n")
		b.WriteString(m)
		b.WriteString("\n")
	}
	if s := strings.TrimSpace(c.Stat); s != "" {
		b.WriteString("\nFiles changed:\n")
		b.WriteString(s)
		b.WriteString("\n")
	}
	b.WriteString("\nDiff:\n")
	b.WriteString(c.Diff)
	if !strings.HasSuffix(c.Diff, "\n") {
		b.WriteString("\n")
	}
	if c.Truncated {
		b.WriteString("[The diff was truncated because it is large. Summarize from what is shown, the commits and the file list.]\n")
	}
	return b.String()
}

// SplitTitle separa a resposta do agente em título (primeira linha) e descrição (o resto).
func SplitTitle(reply string) (title, description string) {
	reply = strings.TrimSpace(reply)
	title, description, _ = strings.Cut(reply, "\n")
	title = strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(title), "#"))
	title = strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(title, "Title:"), "Título:"))
	return title, strings.TrimSpace(description)
}

// CleanMarkdown só tira a cerca de código que às vezes envolve a resposta inteira (a descrição é Markdown).
func CleanMarkdown(s string) string {
	s = strings.TrimSpace(strings.ReplaceAll(s, "\r\n", "\n"))
	if m := fence.FindStringSubmatch(s); m != nil {
		s = strings.TrimSpace(m[1])
	}
	return s
}
