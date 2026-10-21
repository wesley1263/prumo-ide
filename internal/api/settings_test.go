package api

import (
	"encoding/json"
	"testing"
)

func TestValidateSetting(t *testing.T) {
	ok := map[string]string{
		"appearance.theme":    `"light"`,
		"editor.fontSize":     `14`,
		"editor.formatOnSave": `false`,
		"editor.inlayHints":   `true`,
		"terminal.shell":      `""`,
	}
	for k, v := range ok {
		if err := validateSetting(k, json.RawMessage(v)); err != nil {
			t.Errorf("%s=%s deveria valer: %v", k, v, err)
		}
	}
	bad := map[string]string{
		"appearance.theme":    `"azul"`,
		"editor.fontSize":     `13.5`,
		"editor.formatOnSave": `"sim"`,
		"terminal.shell":      `"/nao/existe/zsh"`,
		"qualquer.coisa":      `1`,
	}
	for k, v := range bad {
		if err := validateSetting(k, json.RawMessage(v)); err == nil {
			t.Errorf("%s=%s deveria ser recusado", k, v)
		}
	}
	if err := validateSetting("editor.fontSize", json.RawMessage(`40`)); err == nil {
		t.Error("fonte 40 deveria ser recusada")
	}
}
