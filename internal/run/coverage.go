package run

import (
	"bufio"
	"errors"
	"io"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"prumo/internal/workspace"
)

// CoverBlock é um trecho do perfil de cobertura: linhas/colunas (1-based) e se rodou.
type CoverBlock struct {
	StartLine int  `json:"startLine"`
	StartCol  int  `json:"startCol"`
	EndLine   int  `json:"endLine"`
	EndCol    int  `json:"endCol"`
	Stmts     int  `json:"stmts"`
	Covered   bool `json:"covered"`
}

// FileCoverage é a cobertura de um arquivo do projeto.
type FileCoverage struct {
	Path    string       `json:"path"` // relativo ao projeto
	Package string       `json:"package"`
	Covered int          `json:"covered"` // comandos executados
	Total   int          `json:"total"`
	Blocks  []CoverBlock `json:"blocks"`
}

// PackageCoverage é o resumo de um pacote.
type PackageCoverage struct {
	ImportPath string `json:"importPath"`
	Covered    int    `json:"covered"`
	Total      int    `json:"total"`
}

// Coverage é o resultado de uma execução com cobertura.
type Coverage struct {
	RunID    string            `json:"runId"`
	Covered  int               `json:"covered"`
	Total    int               `json:"total"`
	Packages []PackageCoverage `json:"packages"`
	Files    []FileCoverage    `json:"files"`
}

// ParseCoverProfile lê um -coverprofile. dirs leva o import path do pacote à pasta (do go list); arquivos fora
// do projeto (dependências, pacotes gerados) ficam de fora.
func ParseCoverProfile(r io.Reader, dirs map[string]string, o *workspace.Open) (Coverage, error) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64<<10), 4<<20)
	if !sc.Scan() || !strings.HasPrefix(sc.Text(), "mode:") {
		return Coverage{}, errors.New("perfil de cobertura vazio ou inválido")
	}
	files := map[string]*FileCoverage{}
	// O mesmo bloco pode aparecer mais de uma vez (vários binários de teste): vale se rodou em algum.
	seen := map[string]int{} // arquivo:bloco → índice em Blocks
	for sc.Scan() {
		line := sc.Text()
		// nome.go:linha.col,linha.col comandos contagem
		colon := strings.LastIndexByte(line, ':')
		if colon < 0 {
			continue
		}
		name, rest := line[:colon], line[colon+1:]
		f := strings.Fields(rest)
		if len(f) != 3 {
			continue
		}
		var b CoverBlock
		if !parsePos(strings.SplitN(f[0], ",", 2), &b) {
			continue
		}
		b.Stmts, _ = strconv.Atoi(f[1])
		count, _ := strconv.Atoi(f[2])
		b.Covered = count > 0
		pkg := path.Dir(name)
		dir, ok := dirs[pkg]
		if !ok {
			continue
		}
		rel, err := o.Rel(filepath.Join(dir, path.Base(name)))
		if err != nil {
			continue
		}
		fc := files[rel]
		if fc == nil {
			fc = &FileCoverage{Path: rel, Package: pkg, Blocks: []CoverBlock{}}
			files[rel] = fc
		}
		key := rel + ":" + f[0]
		if i, dup := seen[key]; dup {
			fc.Blocks[i].Covered = fc.Blocks[i].Covered || b.Covered
			continue
		}
		seen[key] = len(fc.Blocks)
		fc.Blocks = append(fc.Blocks, b)
	}
	if err := sc.Err(); err != nil {
		return Coverage{}, err
	}
	cov := Coverage{Packages: []PackageCoverage{}, Files: []FileCoverage{}}
	pkgs := map[string]*PackageCoverage{}
	for _, fc := range files {
		for _, b := range fc.Blocks {
			fc.Total += b.Stmts
			if b.Covered {
				fc.Covered += b.Stmts
			}
		}
		p := pkgs[fc.Package]
		if p == nil {
			p = &PackageCoverage{ImportPath: fc.Package}
			pkgs[fc.Package] = p
		}
		p.Covered += fc.Covered
		p.Total += fc.Total
		cov.Covered += fc.Covered
		cov.Total += fc.Total
		sort.Slice(fc.Blocks, func(i, j int) bool { return fc.Blocks[i].StartLine < fc.Blocks[j].StartLine })
		cov.Files = append(cov.Files, *fc)
	}
	for _, p := range pkgs {
		cov.Packages = append(cov.Packages, *p)
	}
	sort.Slice(cov.Files, func(i, j int) bool { return cov.Files[i].Path < cov.Files[j].Path })
	sort.Slice(cov.Packages, func(i, j int) bool { return cov.Packages[i].ImportPath < cov.Packages[j].ImportPath })
	return cov, nil
}

func parsePos(parts []string, b *CoverBlock) bool {
	if len(parts) != 2 {
		return false
	}
	var ok1, ok2 bool
	b.StartLine, b.StartCol, ok1 = lineCol(parts[0])
	b.EndLine, b.EndCol, ok2 = lineCol(parts[1])
	return ok1 && ok2
}

func lineCol(s string) (int, int, bool) {
	l, c, ok := strings.Cut(s, ".")
	if !ok {
		return 0, 0, false
	}
	li, err1 := strconv.Atoi(l)
	ci, err2 := strconv.Atoi(c)
	return li, ci, err1 == nil && err2 == nil
}
