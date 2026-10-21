//go:build windows

package debug

import "os"

func ownedBy(os.FileInfo, int) bool { return false }
