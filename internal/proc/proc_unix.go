//go:build !linux && !windows

package proc

import "syscall"

// Attr devolve os atributos de um filho. Fora do Linux não há Pdeathsig: o shutdown do app é quem encerra.
// TODO(macos): kqueue NOTE_EXIT no filho ou um processo vigia.
func Attr(group bool) *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setpgid: group}
}
