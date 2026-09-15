//go:build windows

package main

import (
	"errors"
	"syscall"
	"time"
	"unsafe"
)

var (
	user32                     = syscall.NewLazyDLL("user32.dll")
	kernel32                   = syscall.NewLazyDLL("kernel32.dll")
	procOpenClipboard          = user32.NewProc("OpenClipboard")
	procCloseClipboard         = user32.NewProc("CloseClipboard")
	procGetClipboardData       = user32.NewProc("GetClipboardData")
	procIsClipboardFormatAvail = user32.NewProc("IsClipboardFormatAvailable")
	procGlobalLock             = kernel32.NewProc("GlobalLock")
	procGlobalUnlock           = kernel32.NewProc("GlobalUnlock")
)

const cfUnicodeText = 13

// readClipboard reads CF_UNICODETEXT via Win32 directly, so it needs no cgo and
// no PowerShell spawn per poll.
func readClipboard() (string, error) {
	if r, _, _ := procIsClipboardFormatAvail.Call(cfUnicodeText); r == 0 {
		return "", nil
	}
	opened := false
	for i := 0; i < 5; i++ {
		if r, _, _ := procOpenClipboard.Call(0); r != 0 {
			opened = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !opened {
		return "", errors.New("OpenClipboard failed")
	}
	defer procCloseClipboard.Call()

	h, _, _ := procGetClipboardData.Call(cfUnicodeText)
	if h == 0 {
		return "", errors.New("GetClipboardData failed")
	}
	p, _, _ := procGlobalLock.Call(h)
	if p == 0 {
		return "", errors.New("GlobalLock failed")
	}
	defer procGlobalUnlock.Call(h)

	var buf []uint16
	for i := uintptr(0); ; i++ {
		ch := *(*uint16)(unsafe.Pointer(p + i*2))
		if ch == 0 {
			break
		}
		buf = append(buf, ch)
	}
	return syscall.UTF16ToString(buf), nil
}
