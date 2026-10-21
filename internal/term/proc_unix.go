//go:build !windows

package term

import (
	"os"
	"syscall"
)

// O shell é líder de uma sessão nova com o pty como terminal de controle (Ctrl+C, job control).
// No Linux, ainda morre se o backend morrer.
func sysProcAttr() *syscall.SysProcAttr {
	a := &syscall.SysProcAttr{Setsid: true, Setctty: true}
	setPdeathsig(a)
	return a
}

// hangup avisa o grupo do shell como se a janela tivesse fechado (o shell repassa aos jobs).
func hangup(p *os.Process) { _ = syscall.Kill(-p.Pid, syscall.SIGHUP) }
