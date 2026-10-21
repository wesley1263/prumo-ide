package sdk

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

// Baixar um Go SDK (S28): a lista vem do go.dev/dl, o arquivo é conferido pelo sha256 publicado e vai para
// ~/sdk/goX.Y.Z (onde o "go install golang.org/dl/goX.Y.Z" também põe, e onde o Detect já procura).

// Release é uma versão disponível para este sistema.
type Release struct {
	Version string `json:"version"`
	Stable  bool   `json:"stable"`
	File    string `json:"file"`
	Size    int64  `json:"size"`
	sha256  string
}

// DownloadState é o andamento de um download.
type DownloadState struct {
	Version string `json:"version"`
	Done    int64  `json:"done"`
	Total   int64  `json:"total"`
	Phase   string `json:"phase"` // baixando | conferindo | extraindo | pronto | erro
	Error   string `json:"error,omitempty"`
	Goroot  string `json:"goroot,omitempty"`
}

var versionRe = regexp.MustCompile(`^go\d+\.\d+(\.\d+)?((rc|beta)\d+)?$`)

// downloads: base do go.dev (trocável nos testes) e o andamento de cada versão.
type downloads struct {
	mu     sync.Mutex
	base   string
	client *http.Client
	state  map[string]*DownloadState
	dest   func() (string, error)
}

func (s *Sdks) dl() *downloads {
	s.once.Do(func() {
		s.downloads = &downloads{base: "https://go.dev/dl/", client: &http.Client{Timeout: 30 * time.Minute}, state: map[string]*DownloadState{}, dest: func() (string, error) {
			home, err := os.UserHomeDir()
			return filepath.Join(home, "sdk"), err
		}}
	})
	return s.downloads
}

type goRelease struct {
	Version string `json:"version"`
	Stable  bool   `json:"stable"`
	Files   []struct {
		Filename string `json:"filename"`
		OS       string `json:"os"`
		Arch     string `json:"arch"`
		Sha256   string `json:"sha256"`
		Size     int64  `json:"size"`
		Kind     string `json:"kind"`
	} `json:"files"`
}

// Available lista as versões estáveis (as mais novas primeiro) com arquivo para este sistema.
func (s *Sdks) Available() ([]Release, error) {
	d := s.dl()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, d.base+"?mode=json", nil)
	res, err := d.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("não foi possível ler a lista do go.dev: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("go.dev respondeu %s", res.Status)
	}
	var list []goRelease
	if err := json.NewDecoder(io.LimitReader(res.Body, 8<<20)).Decode(&list); err != nil {
		return nil, fmt.Errorf("lista do go.dev ilegível: %w", err)
	}
	out := []Release{}
	for _, r := range list {
		if !versionRe.MatchString(r.Version) {
			continue
		}
		for _, f := range r.Files {
			if f.OS == runtime.GOOS && f.Arch == runtime.GOARCH && f.Kind == "archive" {
				out = append(out, Release{Version: r.Version, Stable: r.Stable, File: f.Filename, Size: f.Size, sha256: f.Sha256})
			}
		}
	}
	return out, nil
}

// Download começa a baixar a versão; o andamento vem por DownloadStatus.
func (s *Sdks) Download(version string) (DownloadState, error) {
	if !versionRe.MatchString(version) {
		return DownloadState{}, errors.New("versão inválida")
	}
	d := s.dl()
	d.mu.Lock()
	if st, ok := d.state[version]; ok && st.Phase != "erro" && st.Phase != "pronto" {
		cp := *st
		d.mu.Unlock()
		return cp, nil
	}
	d.mu.Unlock()
	list, err := s.Available()
	if err != nil {
		return DownloadState{}, err
	}
	var rel *Release
	for i := range list {
		if list[i].Version == version {
			rel = &list[i]
		}
	}
	if rel == nil {
		return DownloadState{}, fmt.Errorf("%s não está disponível para %s/%s", version, runtime.GOOS, runtime.GOARCH)
	}
	root, err := d.dest()
	if err != nil {
		return DownloadState{}, err
	}
	target := filepath.Join(root, version)
	if Version(target) == version {
		return DownloadState{}, fmt.Errorf("%s já está em %s", version, target)
	}
	st := &DownloadState{Version: version, Total: rel.Size, Phase: "baixando"}
	d.mu.Lock()
	d.state[version] = st
	d.mu.Unlock()
	go s.fetch(d, *rel, root, target, st)
	return *st, nil
}

// DownloadStatus devolve o andamento.
func (s *Sdks) DownloadStatus(version string) (DownloadState, error) {
	d := s.dl()
	d.mu.Lock()
	defer d.mu.Unlock()
	st, ok := d.state[version]
	if !ok {
		return DownloadState{}, errors.New("nenhum download dessa versão")
	}
	return *st, nil
}

func (d *downloads) set(st *DownloadState, f func(*DownloadState)) {
	d.mu.Lock()
	f(st)
	d.mu.Unlock()
}

type counter struct {
	d  *downloads
	st *DownloadState
}

func (c counter) Write(p []byte) (int, error) {
	c.d.set(c.st, func(s *DownloadState) { s.Done += int64(len(p)) })
	return len(p), nil
}

func (s *Sdks) fetch(d *downloads, rel Release, root, target string, st *DownloadState) {
	fail := func(err error) { d.set(st, func(s *DownloadState) { s.Phase, s.Error = "erro", err.Error() }) }
	if err := os.MkdirAll(root, 0o755); err != nil {
		fail(err)
		return
	}
	tmp, err := os.CreateTemp(root, ".download-*")
	if err != nil {
		fail(err)
		return
	}
	defer os.Remove(tmp.Name())
	res, err := d.client.Get(d.base + rel.File)
	if err != nil {
		tmp.Close()
		fail(err)
		return
	}
	h := sha256.New()
	_, err = io.Copy(io.MultiWriter(tmp, h, counter{d, st}), res.Body)
	res.Body.Close()
	tmp.Close()
	if err == nil && res.StatusCode != http.StatusOK {
		err = fmt.Errorf("download respondeu %s", res.Status)
	}
	if err != nil {
		fail(err)
		return
	}
	d.set(st, func(s *DownloadState) { s.Phase = "conferindo" })
	if got := hex.EncodeToString(h.Sum(nil)); got != rel.sha256 {
		fail(errors.New("o arquivo baixado não confere com o sha256 publicado: nada foi instalado"))
		return
	}
	d.set(st, func(s *DownloadState) { s.Phase = "extraindo" })
	work, err := os.MkdirTemp(root, ".extract-*")
	if err != nil {
		fail(err)
		return
	}
	defer os.RemoveAll(work)
	if strings.HasSuffix(rel.File, ".zip") {
		err = unzip(tmp.Name(), work)
	} else {
		err = untar(tmp.Name(), work)
	}
	if err != nil {
		fail(fmt.Errorf("extrair: %w", err))
		return
	}
	_ = os.RemoveAll(target) // sobra de uma tentativa que não terminou
	if err := os.Rename(filepath.Join(work, "go"), target); err != nil {
		fail(err)
		return
	}
	if Version(target) != rel.Version {
		fail(errors.New("o arquivo não tem um Go SDK válido"))
		return
	}
	if _, err := s.db.UpsertSdk(context.Background(), target, rel.Version, "downloaded"); err != nil {
		fail(err)
		return
	}
	d.set(st, func(s *DownloadState) { s.Phase, s.Goroot = "pronto", target })
}

// safePath recusa entradas do arquivo que escapariam da pasta (".." ou caminho absoluto).
func safePath(dir, name string) (string, error) {
	p := filepath.Join(dir, filepath.FromSlash(name))
	if !strings.HasPrefix(p, filepath.Clean(dir)+string(os.PathSeparator)) {
		return "", fmt.Errorf("caminho inválido no arquivo: %s", name)
	}
	return p, nil
}

func untar(file, dir string) error {
	f, err := os.Open(file)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	tr := tar.NewReader(gz)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		p, err := safePath(dir, h.Name)
		if err != nil {
			return err
		}
		switch h.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(p, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
				return err
			}
			out, err := os.OpenFile(p, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, os.FileMode(h.Mode)&0o777)
			if err != nil {
				return err
			}
			_, err = io.Copy(out, tr)
			out.Close()
			if err != nil {
				return err
			}
		default:
			// links e outros tipos: o Go SDK não usa; ignorar evita link apontando para fora
		}
	}
}

func unzip(file, dir string) error {
	zr, err := zip.OpenReader(file)
	if err != nil {
		return err
	}
	defer zr.Close()
	for _, f := range zr.File {
		p, err := safePath(dir, f.Name)
		if err != nil {
			return err
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(p, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(p, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, f.Mode()&0o777)
		if err != nil {
			rc.Close()
			return err
		}
		_, err = io.Copy(out, rc)
		out.Close()
		rc.Close()
		if err != nil {
			return err
		}
	}
	return nil
}
