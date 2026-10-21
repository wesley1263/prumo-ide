//go:build windows

package proc

import "syscall"

// Attr devolve os atributos de um filho. TODO(windows): job object com KILL_ON_JOB_CLOSE.
func Attr(group bool) *syscall.SysProcAttr {
	if group {
		return &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
	}
	return &syscall.SysProcAttr{}
}
