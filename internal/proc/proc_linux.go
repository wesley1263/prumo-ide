//go:build linux

package proc

import "syscall"

// Attr devolve os atributos de um filho. group: grupo de processos próprio (para parar a árvore toda).
// Pdeathsig: o kernel mata o filho quando o backend morre.
func Attr(group bool) *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setpgid: group, Pdeathsig: syscall.SIGKILL}
}
