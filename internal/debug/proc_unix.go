//go:build !windows

package debug

import (
	"os/exec"
	"syscall"

	"goide/internal/proc"
)

func setProcessGroup(cmd *exec.Cmd) { cmd.SysProcAttr = proc.Attr(true) }

// killGroup mata o Delve e o programa depurado (que é filho dele).
func killGroup(cmd *exec.Cmd) {
	if cmd != nil && cmd.Process != nil {
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
}
