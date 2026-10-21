//go:build windows

package agent

import "os/exec"

func setGroup(*exec.Cmd) {}
