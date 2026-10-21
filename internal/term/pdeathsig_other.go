//go:build !linux && !windows

package term

import "syscall"

func setPdeathsig(*syscall.SysProcAttr) {}
