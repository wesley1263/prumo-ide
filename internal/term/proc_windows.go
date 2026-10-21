//go:build windows

package term

import (
	"os"
	"syscall"
)

// TODO(windows): ConPTY. Hoje pty.Start devolve ErrUnsupported e a UI mostra o motivo.
func sysProcAttr() *syscall.SysProcAttr { return &syscall.SysProcAttr{} }

func hangup(p *os.Process) { _ = p.Kill() }

func killSession(int) {}
