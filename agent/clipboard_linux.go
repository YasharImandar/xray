//go:build linux

package main

import (
	"errors"
	"os/exec"
)

// Falls back across Wayland and X11 tools; one of these must be installed.
var clipboardReaders = [][]string{
	{"wl-paste", "--no-newline"},
	{"xclip", "-selection", "clipboard", "-o"},
	{"xsel", "-b"},
}

func readClipboard() (string, error) {
	for _, cmd := range clipboardReaders {
		if _, err := exec.LookPath(cmd[0]); err != nil {
			continue
		}
		out, err := exec.Command(cmd[0], cmd[1:]...).Output()
		if err == nil {
			return string(out), nil
		}
	}
	return "", errors.New("no clipboard tool found (install wl-clipboard, xclip, or xsel)")
}
