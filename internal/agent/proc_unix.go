//go:build !windows

package agent

import (
	"os/exec"
	"syscall"

	"prumo/internal/proc"
)

// setGroup: grupo próprio e morte junto com o backend; o cancelamento mata o agente e o que ele abriu.
func setGroup(c *exec.Cmd) {
	c.SysProcAttr = proc.Attr(true)
	c.Cancel = func() error { return syscall.Kill(-c.Process.Pid, syscall.SIGKILL) }
}
