//go:build !windows

package windows

import (
	"os/exec"
	"syscall"
)

// detach põe a janela nova numa sessão própria: fechar esta (ou o terminal que a abriu) não leva a outra junto.
func detach(c *exec.Cmd) { c.SysProcAttr = &syscall.SysProcAttr{Setsid: true} }
