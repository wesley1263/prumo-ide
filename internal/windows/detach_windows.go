//go:build windows

package windows

import (
	"os/exec"
	"syscall"
)

// detach: grupo de processos próprio, para o Ctrl+C de um console não chegar à janela nova.
func detach(c *exec.Cmd) {
	c.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000200} // CREATE_NEW_PROCESS_GROUP
}
