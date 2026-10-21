package api

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Nome de pasta e caminho de módulo aceitos (o go mod init valida de novo; aqui é para dar um erro em português).
var (
	moduleName = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)
	modulePath = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._~/-]*$`)
)

const mainGo = `package main

import "fmt"

func main() {
	fmt.Println("Olá, mundo!")
}
`

// CreateModule (S02 Novo projeto) cria parent/name, roda "go mod init path" e, se pedido, escreve um main.go.
// O projeto nasce confiável: foi o próprio usuário quem criou.
func (p *Projects) CreateModule(parent, name, path string, withMain bool) (OpenResult, error) {
	parent = strings.TrimSpace(parent)
	if strings.HasPrefix(parent, "~") {
		if home, err := os.UserHomeDir(); err == nil {
			parent = filepath.Join(home, strings.TrimPrefix(parent, "~"))
		}
	}
	if !filepath.IsAbs(parent) {
		return OpenResult{}, errors.New("a pasta-mãe precisa ser um caminho absoluto")
	}
	if st, err := os.Stat(parent); err != nil || !st.IsDir() {
		return OpenResult{}, fmt.Errorf("pasta não encontrada: %s", parent)
	}
	name = strings.TrimSpace(name)
	if !moduleName.MatchString(name) || name == "." || name == ".." {
		return OpenResult{}, errors.New("nome de pasta inválido: use letras, números, ponto, hífen ou sublinhado")
	}
	path = strings.TrimSpace(path)
	if path == "" {
		path = name
	}
	if !modulePath.MatchString(path) || strings.Contains(path, "..") || strings.HasSuffix(path, "/") {
		return OpenResult{}, errors.New("caminho de módulo inválido (ex.: github.com/org/app)")
	}
	target := filepath.Join(parent, name)
	if entries, err := os.ReadDir(target); err == nil && len(entries) > 0 {
		return OpenResult{}, fmt.Errorf("a pasta %s já existe e não está vazia", target)
	}
	goExe := p.goExe()
	if goExe == "" {
		return OpenResult{}, errors.New("go não encontrado: configure um Go SDK")
	}
	if err := os.MkdirAll(target, 0o755); err != nil {
		return OpenResult{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, goExe, "mod", "init", path)
	cmd.Dir = target
	if out, err := cmd.CombinedOutput(); err != nil {
		return OpenResult{}, fmt.Errorf("go mod init falhou: %s", strings.TrimSpace(string(out)))
	}
	if withMain {
		if err := os.WriteFile(filepath.Join(target, "main.go"), []byte(mainGo), 0o644); err != nil {
			return OpenResult{}, err
		}
	}
	res, err := p.Open(target)
	if err != nil {
		return OpenResult{}, err
	}
	if res.NeedsTrust {
		o, err := p.SetTrusted(res.Project.ID, true)
		if err != nil {
			return OpenResult{}, err
		}
		res = OpenResult{Project: o}
	}
	return res, nil
}

// goExe: o go do SDK padrão; sem ele, o do PATH.
func (p *Projects) goExe() string {
	if list, err := p.c.Sdks.List(); err == nil {
		for _, s := range list {
			if s.IsDefault {
				exe := filepath.Join(s.Goroot, "bin", "go")
				if _, err := os.Stat(exe); err == nil {
					return exe
				}
			}
		}
	}
	return p.c.Tools.Find("go")
}
