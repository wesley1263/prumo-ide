//go:build windows

package run

import (
	"errors"
	"os"
	"os/exec"
)

// startPTY: sem ConPTY ainda; a execução segue com pipes comuns. TODO(windows): ConPTY.
func startPTY(*exec.Cmd) (*os.File, error) {
	return nil, errors.New("emulação de terminal ainda não disponível no Windows")
}
