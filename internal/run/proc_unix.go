//go:build !windows

package run

import (
	"os"
	"os/exec"
	"syscall"

	"goide/internal/proc"
)

// setProcessGroup põe o programa num grupo próprio (Stop alcança também os filhos que ele criar)
// e garante que ele morre se o backend morrer.
func setProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = proc.Attr(true)
}

func interruptGroup(p *os.Process) { _ = syscall.Kill(-p.Pid, syscall.SIGINT) }

func killGroup(p *os.Process) { _ = syscall.Kill(-p.Pid, syscall.SIGKILL) }
