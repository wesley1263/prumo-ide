// Package files é o serviço de arquivos do projeto: árvore, leitura e escrita com detecção de conflito.
package files

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"goide/internal/workspace"
)

// MaxEditableBytes: acima disso o arquivo abre read-only e sem LSP.
const MaxEditableBytes = 5 << 20

// hidden nunca aparece na árvore.
var hidden = map[string]bool{".git": true, ".DS_Store": true}

// Node é um item da árvore do projeto.
type Node struct {
	Name  string `json:"name"`
	Path  string `json:"path"` // relativo ao projeto, com '/'
	IsDir bool   `json:"isDir"`
	Size  int64  `json:"size"`
}

// FileContent é o que o editor precisa para abrir um arquivo.
type FileContent struct {
	Path       string `json:"path"`
	Content    string `json:"content"`
	Mtime      int64  `json:"mtime"` // Unix ms
	Size       int64  `json:"size"`
	LineEnding string `json:"lineEnding"` // "\n" | "\r\n"
	ReadOnly   bool   `json:"readOnly"`
	TooLarge   bool   `json:"tooLarge"` // conteúdo omitido
	Binary     bool   `json:"binary"`   // conteúdo omitido
}

// WriteResult diz se a escrita aconteceu ou se o disco mudou antes.
type WriteResult struct {
	Mtime     int64 `json:"mtime"`
	Conflict  bool  `json:"conflict"`
	DiskMtime int64 `json:"diskMtime"`
}

// Files é o serviço exposto à UI.
type Files struct {
	reg *workspace.Registry
}

// New cria o serviço.
func New(reg *workspace.Registry) *Files { return &Files{reg: reg} }

// Tree lista os filhos diretos de dir: pastas primeiro, depois arquivos, em ordem natural.
func (f *Files) Tree(projectID, dir string) ([]Node, error) {
	o, err := f.reg.Get(projectID)
	if err != nil {
		return nil, err
	}
	abs, err := o.Abs(dir)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		return nil, err
	}
	out := make([]Node, 0, len(entries))
	for _, e := range entries {
		if hidden[e.Name()] {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue // sumiu entre o ReadDir e o Info
		}
		isDir := e.IsDir()
		if e.Type()&fs.ModeSymlink != 0 {
			if st, err := os.Stat(filepath.Join(abs, e.Name())); err == nil {
				isDir = st.IsDir()
			}
		}
		rel := e.Name()
		if dir != "" {
			rel = strings.TrimSuffix(dir, "/") + "/" + e.Name()
		}
		out = append(out, Node{Name: e.Name(), Path: rel, IsDir: isDir, Size: info.Size()})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].IsDir != out[j].IsDir {
			return out[i].IsDir
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

// Read lê um arquivo para o editor.
func (f *Files) Read(projectID, path string) (FileContent, error) {
	o, err := f.reg.Get(projectID)
	if err != nil {
		return FileContent{}, err
	}
	abs, err := o.Abs(path)
	if err != nil {
		return FileContent{}, err
	}
	st, err := os.Stat(abs)
	if err != nil {
		return FileContent{}, err
	}
	if st.IsDir() {
		return FileContent{}, fmt.Errorf("%s é uma pasta", path)
	}
	fc := FileContent{Path: path, Mtime: st.ModTime().UnixMilli(), Size: st.Size(), LineEnding: "\n"}
	fc.ReadOnly = st.Mode().Perm()&0o200 == 0
	if st.Size() > MaxEditableBytes {
		fc.TooLarge, fc.ReadOnly = true, true
		return fc, nil
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return FileContent{}, err
	}
	head := data
	if len(head) > 8000 {
		head = head[:8000]
	}
	if bytes.IndexByte(head, 0) >= 0 || !utf8.Valid(data) {
		fc.Binary, fc.ReadOnly = true, true
		return fc, nil
	}
	if bytes.Contains(data, []byte("\r\n")) {
		fc.LineEnding = "\r\n"
	}
	fc.Content = string(data)
	return fc, nil
}

// ReadExternal lê, só para leitura, um arquivo fora do projeto que o gopls apontou (stdlib, dependências).
// Só aceita caminhos dentro de uma das raízes permitidas (GOROOT e GOMODCACHE do projeto).
func (f *Files) ReadExternal(projectID, absPath string, allowedRoots []string) (FileContent, error) {
	if _, err := f.reg.Get(projectID); err != nil {
		return FileContent{}, err
	}
	clean := filepath.Clean(absPath)
	if real, err := filepath.EvalSymlinks(clean); err == nil {
		clean = real
	}
	allowed := false
	for _, root := range allowedRoots {
		if root == "" {
			continue
		}
		if r, err := filepath.EvalSymlinks(root); err == nil {
			root = r
		}
		if isInside(root, clean) {
			allowed = true
			break
		}
	}
	if !allowed {
		return FileContent{}, fmt.Errorf("%w: só arquivos do Go SDK e do cache de módulos podem ser abertos fora do projeto", workspace.ErrOutsideProject)
	}
	st, err := os.Stat(clean)
	if err != nil {
		return FileContent{}, err
	}
	if st.IsDir() || st.Size() > MaxEditableBytes {
		return FileContent{}, fmt.Errorf("não é possível abrir %s", clean)
	}
	data, err := os.ReadFile(clean)
	if err != nil {
		return FileContent{}, err
	}
	return FileContent{Path: clean, Content: string(data), Mtime: st.ModTime().UnixMilli(), Size: st.Size(), LineEnding: "\n", ReadOnly: true}, nil
}

// isInside diz se p está estritamente dentro de root (a própria raiz não conta).
func isInside(root, p string) bool {
	r, err := filepath.Rel(root, p)
	return err == nil && r != "." && r != ".." && !strings.HasPrefix(r, ".."+string(filepath.Separator))
}

// Write grava o conteúdo se o arquivo no disco ainda tiver expectedMtime (0 = arquivo novo).
// A escrita é atômica (arquivo temporário + rename) e preserva as permissões.
func (f *Files) Write(projectID, path, content string, expectedMtime int64) (WriteResult, error) {
	o, err := f.reg.Get(projectID)
	if err != nil {
		return WriteResult{}, err
	}
	abs, err := o.Abs(path)
	if err != nil {
		return WriteResult{}, err
	}
	perm := fs.FileMode(0o644)
	st, err := os.Stat(abs)
	switch {
	case err == nil:
		perm = st.Mode().Perm()
		if disk := st.ModTime().UnixMilli(); expectedMtime != 0 && disk != expectedMtime {
			return WriteResult{Conflict: true, DiskMtime: disk}, nil
		}
	case errors.Is(err, fs.ErrNotExist):
		if expectedMtime != 0 {
			return WriteResult{Conflict: true}, nil
		}
	default:
		return WriteResult{}, err
	}
	tmp, err := os.CreateTemp(filepath.Dir(abs), "."+filepath.Base(abs)+".*.tmp")
	if err != nil {
		return WriteResult{}, err
	}
	defer os.Remove(tmp.Name()) // no-op depois do rename
	if _, err := tmp.WriteString(content); err != nil {
		tmp.Close()
		return WriteResult{}, err
	}
	if err := tmp.Chmod(perm); err != nil {
		tmp.Close()
		return WriteResult{}, err
	}
	if err := tmp.Close(); err != nil {
		return WriteResult{}, err
	}
	if err := os.Rename(tmp.Name(), abs); err != nil {
		return WriteResult{}, err
	}
	st, err = os.Stat(abs)
	if err != nil {
		return WriteResult{}, err
	}
	return WriteResult{Mtime: st.ModTime().UnixMilli()}, nil
}
