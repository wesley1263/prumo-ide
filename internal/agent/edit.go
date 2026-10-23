package agent

import (
	"fmt"
	"strings"
)

// EditContext é o que o agente recebe para gerar ou alterar um trecho de código no editor.
type EditContext struct {
	Path        string // arquivo, relativo ao projeto
	Language    string // linguagem do arquivo ("go", "typescript"...)
	Before      string // o arquivo antes do trecho
	Target      string // o trecho que a resposta vai substituir (vazio: inserir nessa posição)
	After       string // o arquivo depois do trecho
	Instruction string // o que o usuário pediu
}

// Quanto do arquivo vai junto: o suficiente para o agente seguir o estilo e os nomes, sem mandar arquivos enormes.
const contextBytes = 40 << 10

// tail e head cortam em limite de linha.
func tail(s string, n int) (string, bool) {
	if len(s) <= n {
		return s, false
	}
	s = s[len(s)-n:]
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[i+1:]
	}
	return s, true
}

func head(s string, n int) (string, bool) {
	if len(s) <= n {
		return s, false
	}
	s = s[:n]
	if i := strings.LastIndexByte(s, '\n'); i >= 0 {
		s = s[:i+1]
	}
	return s, true
}

// BuildEditPrompt monta o pedido de edição. Em inglês (os modelos seguem melhor); o agente responde só com o código.
func BuildEditPrompt(c EditContext) string {
	var b strings.Builder
	b.WriteString("You are a code generation engine inside a code editor. Apply the user's instruction to the target region of the file below.\n\n")
	b.WriteString("Rules:\n")
	b.WriteString("- Reply with the code that replaces the target region, and nothing else: no explanation, no preamble, no Markdown, no code fences.\n")
	if strings.TrimSpace(c.Target) == "" {
		b.WriteString("- The target region is empty: your reply is inserted at the <TARGET/> marker.\n")
	} else {
		b.WriteString("- Your reply replaces the text between <TARGET> and </TARGET> exactly. If the instruction only asks to add new code next to it, include the original target text unchanged in your reply.\n")
	}
	b.WriteString("- Match the file's indentation, naming, comment style and language. Keep the indentation of the target region.\n")
	b.WriteString("- Do not repeat code outside the target region. Do not add imports or declarations unless they belong inside the target region.\n")
	b.WriteString("- Write comments and identifiers in the language the file already uses.\n")
	fmt.Fprintf(&b, "\nFile: %s\n", c.Path)
	if c.Language != "" {
		fmt.Fprintf(&b, "Language: %s\n", c.Language)
	}
	before, bcut := tail(c.Before, contextBytes)
	after, acut := head(c.After, contextBytes)
	b.WriteString("\n--- file content ---\n")
	if bcut {
		b.WriteString("[... earlier lines omitted ...]\n")
	}
	b.WriteString(before)
	if strings.TrimSpace(c.Target) == "" {
		b.WriteString("<TARGET/>")
	} else {
		b.WriteString("<TARGET>" + c.Target + "</TARGET>")
	}
	b.WriteString(after)
	if !strings.HasSuffix(after, "\n") {
		b.WriteString("\n")
	}
	if acut {
		b.WriteString("[... later lines omitted ...]\n")
	}
	b.WriteString("--- end of file content ---\n\nInstruction from the user:\n")
	b.WriteString(strings.TrimSpace(c.Instruction))
	b.WriteString("\n")
	return b.String()
}

// CleanCode tira o que os agentes às vezes põem em volta do código (uma cerca ```), mantendo a indentação.
func CleanCode(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	lines := strings.Split(strings.TrimRight(s, " \t\n"), "\n")
	for len(lines) > 0 && strings.TrimSpace(lines[0]) == "" {
		lines = lines[1:]
	}
	if len(lines) >= 2 && strings.HasPrefix(strings.TrimSpace(lines[0]), "```") && strings.TrimSpace(lines[len(lines)-1]) == "```" {
		lines = lines[1 : len(lines)-1]
	}
	return strings.TrimRight(strings.Join(lines, "\n"), " \t\n")
}
