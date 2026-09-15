//go:build darwin

package main

import "os/exec"

// pbpaste ships with macOS, so no extra install is needed.
func readClipboard() (string, error) {
	out, err := exec.Command("pbpaste").Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}
