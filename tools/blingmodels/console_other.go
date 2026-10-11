//go:build !windows

package main

import (
	"fmt"
	"os"
)

var hasConsole = true

func showError(msg string) { fmt.Fprintln(os.Stderr, msg) }
