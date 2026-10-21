//go:build !linux && !windows

package term

import "syscall"

// killSession: fora do Linux só alcança o grupo do shell (jobs em segundo plano podem escapar).
func killSession(sid int) { _ = syscall.Kill(-sid, syscall.SIGKILL) }
