//go:build !windows

package run

import (
	"os"
	"os/exec"

	"github.com/creack/pty"

	"prumo/internal/proc"
)

// startPTY sobe o programa num pseudo-terminal ("Emular terminal no console"): isatty dá verdadeiro, então
// cores e barras de progresso aparecem como num terminal. A sessão própria (Setsid) também é um grupo de
// processos com o pid do programa, e o Stop continua alcançando os filhos.
func startPTY(cmd *exec.Cmd) (*os.File, error) {
	attr := proc.Attr(false)
	attr.Setsid, attr.Setctty = true, true
	cmd.Stdin, cmd.Stdout, cmd.Stderr = nil, nil, nil
	return pty.StartWithAttrs(cmd, &pty.Winsize{Cols: 120, Rows: 40}, attr)
}
