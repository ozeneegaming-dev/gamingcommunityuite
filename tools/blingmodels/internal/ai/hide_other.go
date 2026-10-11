//go:build !windows

package ai

import "os/exec"

func hideWindow(cmd *exec.Cmd) {}
