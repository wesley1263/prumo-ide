//go:build linux

package term

import (
	"os"
	"strconv"
	"strings"
	"syscall"
)

// killSession mata todos os processos da sessão sid (o shell é o líder: sid = pid dele), inclusive jobs
// em segundo plano, que ficam em grupos próprios.
func killSession(sid int) {
	_ = syscall.Kill(-sid, syscall.SIGKILL)
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return
	}
	for _, e := range entries {
		pid, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		b, err := os.ReadFile("/proc/" + e.Name() + "/stat")
		if err != nil {
			continue
		}
		// Campos depois do nome do comando (que pode ter espaços e parênteses): estado, ppid, pgrp, sessão...
		i := strings.LastIndexByte(string(b), ')')
		if i < 0 {
			continue
		}
		f := strings.Fields(string(b[i+1:]))
		if len(f) > 3 && f[3] == strconv.Itoa(sid) {
			_ = syscall.Kill(pid, syscall.SIGKILL)
		}
	}
}
