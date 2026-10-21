//go:build windows

package run

import (
	"os"
	"os/exec"
	"syscall"
)

// No Windows o grupo de processos é aproximado por CREATE_NEW_PROCESS_GROUP.
// TODO(windows): job object para matar os netos também.
func setProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
}

func interruptGroup(p *os.Process) { _ = p.Kill() }

func killGroup(p *os.Process) { _ = p.Kill() }
