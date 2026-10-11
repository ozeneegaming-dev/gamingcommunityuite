package main

import (
	"os"
	"syscall"
	"unsafe"
)

var (
	kernel32 = syscall.NewLazyDLL("kernel32.dll")
	user32   = syscall.NewLazyDLL("user32.dll")
)

// hasConsole: the exe is built as a windowed program (no black terminal on double-click). Started from a command
// prompt, it attaches to that console so the command-line mode still prints its messages.
var hasConsole = attachParentConsole()

func attachParentConsole() bool {
	const attachParent = ^uintptr(0) // ATTACH_PARENT_PROCESS
	if r, _, _ := kernel32.NewProc("AttachConsole").Call(attachParent); r == 0 {
		// Built as a console program (or no parent console): keep whatever stdout we have.
		return consoleOnStdout()
	}
	if f, err := os.OpenFile("CONOUT$", os.O_WRONLY, 0); err == nil {
		os.Stdout, os.Stderr = f, f
		out = f
	}
	if f, err := os.OpenFile("CONIN$", os.O_RDONLY, 0); err == nil {
		os.Stdin = f
	}
	kernel32.NewProc("SetConsoleOutputCP").Call(65001)
	return true
}

// consoleOnStdout reports whether stdout is a real console (a console-subsystem build started by double-click).
func consoleOnStdout() bool {
	var mode uint32
	r, _, _ := kernel32.NewProc("GetConsoleMode").Call(uintptr(syscall.Stdout), uintptr(unsafe.Pointer(&mode)))
	if r != 0 {
		kernel32.NewProc("SetConsoleOutputCP").Call(65001)
	}
	return r != 0
}

// showError displays a message box (a windowed program has nowhere else to write).
func showError(msg string) {
	t, _ := syscall.UTF16PtrFromString(msg)
	c, _ := syscall.UTF16PtrFromString("blingmodels")
	user32.NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), 0x10)
}
