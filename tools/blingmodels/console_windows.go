package main

import "syscall"

// Windows consoles default to an old code page; switch to UTF-8 so Romanian letters show correctly.
func init() {
	syscall.NewLazyDLL("kernel32.dll").NewProc("SetConsoleOutputCP").Call(65001)
}
