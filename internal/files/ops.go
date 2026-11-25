package files

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// ErrExists: o destino já existe.
var ErrExists = errors.New("já existe um arquivo ou pasta com esse nome")

// validName recusa nomes que escapariam da pasta ou não fazem sentido.
func validName(name string) error {
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, "/\\\x00") {
		return fmt.Errorf("nome inválido: %q", name)
	}
	if hidden[name] {
		return fmt.Errorf("nome reservado: %q", name)
	}
	return nil
}

// resolve devolve o caminho absoluto de rel, recusando a própria raiz do projeto e a pasta .git.
func (f *Files) resolve(projectID, rel string) (abs string, err error) {
	o, err := f.reg.Get(projectID)
	if err != nil {
		return "", err
	}
	rel = strings.Trim(rel, "/")
	if rel == "" {
		return "", errors.New("operação não permitida na raiz do projeto")
	}
	if rel == ".git" || strings.HasPrefix(rel, ".git/") {
		return "", errors.New("a pasta .git não pode ser alterada por aqui")
	}
	return o.Abs(rel)
}

// Create cria um arquivo vazio ou uma pasta (com os pais que faltarem) e devolve o caminho relativo criado.
func (f *Files) Create(projectID, path string, isDir bool) (string, error) {
	abs, err := f.resolve(projectID, path)
	if err != nil {
		return "", err
	}
	for part := range strings.SplitSeq(strings.Trim(path, "/"), "/") {
		if err := validName(part); err != nil {
			return "", err
		}
	}
	if _, err := os.Lstat(abs); err == nil {
		return "", ErrExists
	}
	if isDir {
		err = os.MkdirAll(abs, 0o755)
	} else {
		if err = os.MkdirAll(filepath.Dir(abs), 0o755); err == nil {
			var fh *os.File
			fh, err = os.OpenFile(abs, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
			if err == nil {
				err = fh.Close()
			}
		}
	}
	if err != nil {
		return "", err
	}
	return strings.Trim(path, "/"), nil
}

// Rename move um arquivo ou pasta para outro caminho do projeto (renomear e mover são a mesma coisa).
// Não sobrescreve nada.
func (f *Files) Rename(projectID, from, to string) error {
	src, err := f.resolve(projectID, from)
	if err != nil {
		return err
	}
	dst, err := f.resolve(projectID, to)
	if err != nil {
		return err
	}
	for part := range strings.SplitSeq(strings.Trim(to, "/"), "/") {
		if err := validName(part); err != nil {
			return err
		}
	}
	if _, err := os.Lstat(src); err != nil {
		return err
	}
	if src == dst {
		return nil
	}
	if isInside(src, dst) {
		return errors.New("não dá para mover uma pasta para dentro dela mesma")
	}
	// Só o nome muda de maiúsculas/minúsculas (foo → Foo): em sistemas de arquivos insensíveis a caixa
	// o destino "existe", mas é o mesmo arquivo.
	if st, err := os.Lstat(dst); err == nil {
		if ss, e2 := os.Lstat(src); e2 != nil || !os.SameFile(ss, st) {
			return ErrExists
		}
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	return os.Rename(src, dst)
}

// Delete apaga um arquivo ou uma pasta inteira. Não segue links simbólicos: apaga o link, não o alvo.
func (f *Files) Delete(projectID, path string) error {
	abs, err := f.resolve(projectID, path)
	if err != nil {
		return err
	}
	if _, err := os.Lstat(abs); err != nil {
		return err
	}
	return os.RemoveAll(abs)
}

// Copy copia um arquivo ou pasta para outro caminho do projeto. Não sobrescreve nada.
func (f *Files) Copy(projectID, from, to string) error {
	src, err := f.resolve(projectID, from)
	if err != nil {
		return err
	}
	dst, err := f.resolve(projectID, to)
	if err != nil {
		return err
	}
	for part := range strings.SplitSeq(strings.Trim(to, "/"), "/") {
		if err := validName(part); err != nil {
			return err
		}
	}
	if _, err := os.Lstat(dst); err == nil {
		return ErrExists
	}
	if isInside(src, dst) {
		return errors.New("não dá para copiar uma pasta para dentro dela mesma")
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	return copyTree(src, dst)
}

func copyTree(src, dst string) error {
	st, err := os.Lstat(src)
	if err != nil {
		return err
	}
	switch {
	case st.Mode()&fs.ModeSymlink != 0:
		target, err := os.Readlink(src)
		if err != nil {
			return err
		}
		return os.Symlink(target, dst)
	case st.IsDir():
		if err := os.Mkdir(dst, st.Mode().Perm()); err != nil {
			return err
		}
		entries, err := os.ReadDir(src)
		if err != nil {
			return err
		}
		for _, e := range entries {
			if hidden[e.Name()] && e.Name() == ".git" {
				continue // o repositório não vai junto numa cópia de pasta
			}
			if err := copyTree(filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())); err != nil {
				return err
			}
		}
		return nil
	case st.Mode().IsRegular():
		in, err := os.Open(src)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, st.Mode().Perm())
		if err != nil {
			return err
		}
		if _, err := io.Copy(out, in); err != nil {
			out.Close()
			return err
		}
		return out.Close()
	}
	return fmt.Errorf("tipo de arquivo não suportado: %s", src)
}
