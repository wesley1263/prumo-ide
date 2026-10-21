package gitx

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"goide/internal/workspace"
)

// ---------------------------------------------------------------- log (S24)

// LogFilter são os filtros do Log. Tudo vazio = todos os commits de todas as branches.
type LogFilter struct {
	Text   string `json:"text"`   // na mensagem (ou o começo do hash)
	Author string `json:"author"` // nome ou e-mail
	Branch string `json:"branch"` // "" = todas as branches e remotas
	Path   string `json:"path"`   // relativo ao projeto; arquivo ou pasta
	Follow bool   `json:"follow"` // histórico de um arquivo atravessando renomes
}

// Ref é um rótulo ao lado do commit.
type Ref struct {
	Name string `json:"name"`
	Kind string `json:"kind"` // head | local | remote | tag
}

// Seg é um trecho do grafo dentro da linha do commit. Colunas em X; Y: 0 = topo, 1 = meio, 2 = base.
type Seg struct {
	X1    int `json:"x1"`
	Y1    int `json:"y1"`
	X2    int `json:"x2"`
	Y2    int `json:"y2"`
	Color int `json:"color"`
}

// LogCommit é uma linha do Log.
type LogCommit struct {
	Hash    string   `json:"hash"`
	Short   string   `json:"short"`
	Parents []string `json:"parents"`
	Subject string   `json:"subject"`
	Author  string   `json:"author"`
	Email   string   `json:"email"`
	Date    int64    `json:"date"` // Unix ms (data do autor)
	Refs    []Ref    `json:"refs"`
	Node    int      `json:"node"`  // coluna do nó no grafo
	Color   int      `json:"color"` // cor da coluna do nó
	Lines   []Seg    `json:"lines"`
}

// LogPage é o pedaço pedido do histórico.
type LogPage struct {
	Commits []LogCommit `json:"commits"`
	HasMore bool        `json:"hasMore"`
	Width   int         `json:"width"` // colunas do grafo (a UI reserva o espaço)
}

// MaxLog é o máximo de commits por pedido (a UI pede mais rolando).
const MaxLog = 5000

const logFormat = "%H%x00%P%x00%an%x00%ae%x00%at%x00%D%x00%s%x1e"

// Log devolve os primeiros `limit` commits que passam no filtro, com o grafo.
// O grafo é calculado sobre a lista inteira devolvida: a UI pede mais aumentando o limit.
func (g *Git) Log(projectID string, f LogFilter, limit int) (LogPage, error) {
	ctx := context.Background()
	o, err := g.reg.Get(projectID)
	if err != nil {
		return LogPage{}, err
	}
	top, err := g.toplevel(ctx, o)
	if err != nil {
		return LogPage{}, err
	}
	if limit <= 0 || limit > MaxLog {
		limit = 500
	}
	args := []string{"log", "--date-order", "-z", "--format=" + logFormat, "--max-count=" + strconv.Itoa(limit+1)}
	if t := strings.TrimSpace(f.Text); t != "" {
		args = append(args, "--regexp-ignore-case", "--fixed-strings", "--grep="+t)
	}
	if a := strings.TrimSpace(f.Author); a != "" {
		args = append(args, "--regexp-ignore-case", "--fixed-strings", "--author="+a)
	}
	var pathArg string
	if f.Path != "" {
		abs, err := o.Abs(f.Path)
		if err != nil {
			return LogPage{}, err
		}
		rel, err := filepath.Rel(top, abs)
		if err != nil {
			return LogPage{}, err
		}
		pathArg = filepath.ToSlash(rel)
		if f.Follow {
			args = append(args, "--follow")
		}
	}
	switch {
	case f.Branch != "":
		if strings.HasPrefix(f.Branch, "-") {
			return LogPage{}, errors.New("branch inválida")
		}
		args = append(args, f.Branch)
	case !f.Follow:
		args = append(args, "--branches", "--remotes", "--tags", "HEAD")
	}
	if pathArg != "" {
		args = append(args, "--", pathArg)
	}
	out, err := g.run(ctx, top, true, args...)
	if err != nil {
		var ge *gitError
		// Repositório sem nenhum commit ainda: Log vazio, não erro.
		if errors.As(err, &ge) && (strings.Contains(ge.stderr, "does not have any commits") || strings.Contains(ge.stderr, "bad default revision") || strings.Contains(ge.stderr, "unknown revision")) && f.Branch == "" {
			return LogPage{Commits: []LogCommit{}}, nil
		}
		return LogPage{}, err
	}
	remotes := map[string]bool{}
	if rs, err := g.run(ctx, top, true, "remote"); err == nil {
		for _, r := range strings.Fields(string(rs)) {
			remotes[r] = true
		}
	}
	commits := parseLog(out, remotes)
	page := LogPage{Commits: commits}
	if len(commits) > limit {
		page.Commits, page.HasMore = commits[:limit], true
	}
	page.Width = layoutGraph(page.Commits)
	return page, nil
}

func parseLog(out []byte, remotes map[string]bool) []LogCommit {
	commits := []LogCommit{}
	for _, rec := range bytes.Split(out, []byte{0x1e}) {
		rec = bytes.TrimLeft(rec, "\x00\n")
		if len(rec) == 0 {
			continue
		}
		f := strings.SplitN(string(rec), "\x00", 7)
		if len(f) < 7 {
			continue
		}
		c := LogCommit{Hash: f[0], Author: f[2], Email: f[3], Subject: f[6], Refs: parseRefs(f[5], remotes), Parents: []string{}}
		if len(c.Hash) >= 7 {
			c.Short = c.Hash[:7]
		}
		if f[1] != "" {
			c.Parents = strings.Fields(f[1])
		}
		if s, err := strconv.ParseInt(f[4], 10, 64); err == nil {
			c.Date = s * 1000
		}
		commits = append(commits, c)
	}
	return commits
}

// parseRefs lê o %D: "HEAD -> main, origin/main, tag: v1.0".
func parseRefs(d string, remotes map[string]bool) []Ref {
	refs := []Ref{}
	for _, r := range strings.Split(d, ", ") {
		r = strings.TrimSpace(r)
		switch {
		case r == "":
		case r == "HEAD":
			refs = append(refs, Ref{Name: "HEAD", Kind: "head"})
		case strings.HasPrefix(r, "HEAD -> "):
			refs = append(refs, Ref{Name: strings.TrimPrefix(r, "HEAD -> "), Kind: "head"})
		case strings.HasPrefix(r, "tag: "):
			refs = append(refs, Ref{Name: strings.TrimPrefix(r, "tag: "), Kind: "tag"})
		case strings.HasSuffix(r, "/HEAD"):
			// origin/HEAD só repete a branch padrão do remoto
		default:
			kind := "local"
			if i := strings.IndexByte(r, '/'); i > 0 && remotes[r[:i]] {
				kind = "remote"
			}
			refs = append(refs, Ref{Name: r, Kind: kind})
		}
	}
	return refs
}

// laneColors é quantas cores o grafo alterna (a UI tem a paleta).
const laneColors = 8

// layoutGraph distribui os commits em colunas e calcula os trechos de cada linha. Cada coluna "espera" um
// hash; o commit ocupa a primeira coluna que o espera (ou uma nova), as outras que o esperavam convergem para
// ele, e a coluna passa a esperar o primeiro pai. Os outros pais (merge) reaproveitam uma coluna que já os
// espera ou abrem uma nova. Devolve a largura máxima.
func layoutGraph(commits []LogCommit) int {
	type lane = graphLane
	var lanes []lane // "" = coluna livre
	nextColor := 0
	width := 0
	newColor := func() int {
		c := nextColor % laneColors
		nextColor++
		return c
	}
	free := func() int {
		for i, l := range lanes {
			if l.hash == "" {
				return i
			}
		}
		lanes = append(lanes, lane{})
		return len(lanes) - 1
	}
	for i := range commits {
		c := &commits[i]
		before := append([]lane(nil), lanes...)
		node := -1
		for j, l := range lanes {
			if l.hash == c.Hash {
				node = j
				break
			}
		}
		if node < 0 {
			node = free()
			lanes[node] = lane{hash: c.Hash, color: newColor()}
			before = append([]lane(nil), lanes...)
			before[node] = lane{} // nasce aqui: nada chega de cima
		}
		c.Node, c.Color = node, lanes[node].color
		// Colunas que esperavam este commit convergem para o nó e ficam livres.
		for j := range lanes {
			if j != node && lanes[j].hash == c.Hash {
				lanes[j] = lane{}
			}
		}
		// A coluna do nó segue o primeiro pai; os outros pais ganham colunas.
		parentCol := map[string]int{}
		if len(c.Parents) == 0 {
			lanes[node] = lane{}
		} else {
			first := c.Parents[0]
			if j := indexLane(lanes, first, node); j >= 0 {
				// O pai já é esperado em outra coluna: esta termina nele.
				lanes[node] = lane{}
				parentCol[first] = j
			} else {
				lanes[node].hash = first
				parentCol[first] = node
			}
			for _, p := range c.Parents[1:] {
				if j := indexLane(lanes, p, -1); j >= 0 {
					parentCol[p] = j
					continue
				}
				j := free()
				lanes[j] = lane{hash: p, color: newColor()}
				parentCol[p] = j
			}
		}
		// Trechos: de cima (colunas de antes) para o meio ou para baixo (colunas de depois).
		after := lanes
		for j, l := range before {
			if l.hash == "" {
				continue
			}
			if l.hash == c.Hash {
				c.Lines = append(c.Lines, Seg{X1: j, Y1: 0, X2: node, Y2: 1, Color: l.color})
				continue
			}
			if k := indexLane(after, l.hash, -1); k >= 0 {
				c.Lines = append(c.Lines, Seg{X1: j, Y1: 0, X2: k, Y2: 2, Color: l.color})
			}
		}
		for _, p := range c.Parents {
			k, ok := parentCol[p]
			if !ok {
				continue
			}
			color := after[k].color
			if k == node || after[k].hash == "" {
				color = c.Color
			}
			c.Lines = append(c.Lines, Seg{X1: node, Y1: 1, X2: k, Y2: 2, Color: color})
		}
		if c.Lines == nil {
			c.Lines = []Seg{}
		}
		// Colunas livres no fim não contam na largura.
		for len(lanes) > 0 && lanes[len(lanes)-1].hash == "" {
			lanes = lanes[:len(lanes)-1]
		}
		width = max(width, len(before), len(after), node+1)
	}
	return width
}

// graphLane é uma coluna do grafo: o hash que ela espera ("" = livre) e a cor.
type graphLane struct {
	hash  string
	color int
}

func indexLane(lanes []graphLane, hash string, skip int) int {
	for j, l := range lanes {
		if j != skip && l.hash == hash {
			return j
		}
	}
	return -1
}

// ---------------------------------------------------------------- detalhes do commit

// CommitFile é um arquivo alterado num commit.
type CommitFile struct {
	Path    string `json:"path"`    // relativo ao projeto quando dentro dele; senão, relativo ao repositório
	OldPath string `json:"oldPath"` // renomes
	Kind    string `json:"kind"`    // added | modified | deleted | renamed
	Outside bool   `json:"outside"` // fora da pasta do projeto (repositório maior que o projeto)
}

// CommitDetails é o painel de detalhes do Log.
type CommitDetails struct {
	Hash      string       `json:"hash"`
	Parents   []string     `json:"parents"`
	Author    string       `json:"author"`
	Email     string       `json:"email"`
	Date      int64        `json:"date"`
	Committer string       `json:"committer"`
	Message   string       `json:"message"`
	Files     []CommitFile `json:"files"`
	Branches  []string     `json:"branches"` // locais que contêm o commit
}

func validRev(rev string) error {
	if rev == "" || strings.HasPrefix(rev, "-") || strings.ContainsAny(rev, " \t\n\x00") {
		return fmt.Errorf("revisão inválida: %q", rev)
	}
	return nil
}

// CommitDetails lê mensagem, autor e arquivos alterados (em relação ao primeiro pai).
func (g *Git) CommitDetails(projectID, hash string) (CommitDetails, error) {
	ctx := context.Background()
	if err := validRev(hash); err != nil {
		return CommitDetails{}, err
	}
	o, err := g.reg.Get(projectID)
	if err != nil {
		return CommitDetails{}, err
	}
	top, err := g.toplevel(ctx, o)
	if err != nil {
		return CommitDetails{}, err
	}
	out, err := g.run(ctx, top, true, "show", "-s", "--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%B", hash, "--")
	if err != nil {
		return CommitDetails{}, err
	}
	f := strings.SplitN(string(out), "\x00", 7)
	if len(f) < 7 {
		return CommitDetails{}, errors.New("saída inesperada do git show")
	}
	d := CommitDetails{Hash: f[0], Author: f[2], Email: f[3], Committer: f[5], Message: strings.TrimRight(f[6], "\n"), Parents: []string{}, Files: []CommitFile{}, Branches: []string{}}
	if f[1] != "" {
		d.Parents = strings.Fields(f[1])
	}
	if s, err := strconv.ParseInt(f[4], 10, 64); err == nil {
		d.Date = s * 1000
	}
	diffArgs := []string{"diff-tree", "-r", "-z", "-M", "--name-status", "--no-commit-id"}
	if len(d.Parents) == 0 {
		diffArgs = append(diffArgs, "--root", d.Hash)
	} else {
		diffArgs = append(diffArgs, d.Parents[0], d.Hash)
	}
	if out, err := g.run(ctx, top, true, diffArgs...); err == nil {
		d.Files = parseNameStatus(out, func(repoRel string) (string, bool) { return projectPath(o, top, repoRel) })
	}
	if out, err := g.run(ctx, top, true, "branch", "--format=%(refname:short)", "--contains", d.Hash); err == nil {
		for _, b := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			if b != "" {
				d.Branches = append(d.Branches, b)
			}
		}
	}
	return d, nil
}

// projectPath converte um caminho relativo ao repositório em relativo ao projeto (ok=false: fora do projeto).
func projectPath(o *workspace.Open, top, repoRel string) (string, bool) {
	rel, err := o.Rel(filepath.Join(top, filepath.FromSlash(repoRel)))
	if err != nil {
		return repoRel, false
	}
	return rel, true
}

func parseNameStatus(out []byte, conv func(string) (string, bool)) []CommitFile {
	files := []CommitFile{}
	f := strings.Split(strings.TrimRight(string(out), "\x00"), "\x00")
	for i := 0; i < len(f); i++ {
		st := f[i]
		if st == "" {
			continue
		}
		cf := CommitFile{}
		switch st[0] {
		case 'A':
			cf.Kind = "added"
		case 'D':
			cf.Kind = "deleted"
		case 'R', 'C':
			cf.Kind = "renamed"
			if i+1 < len(f) {
				i++
				cf.OldPath, _ = conv(f[i])
			}
		default:
			cf.Kind = "modified"
		}
		if i+1 >= len(f) {
			break
		}
		i++
		p, inside := conv(f[i])
		cf.Path, cf.Outside = p, !inside
		files = append(files, cf)
	}
	return files
}

// CommitDiff compara um arquivo antes e depois do commit (antes = primeiro pai).
func (g *Git) CommitDiff(projectID, hash, path, oldPath string) (DiffContents, error) {
	ctx := context.Background()
	if err := validRev(hash); err != nil {
		return DiffContents{}, err
	}
	o, err := g.reg.Get(projectID)
	if err != nil {
		return DiffContents{}, err
	}
	top, err := g.toplevel(ctx, o)
	if err != nil {
		return DiffContents{}, err
	}
	repoRel := func(p string) (string, error) {
		abs, err := o.Abs(p)
		if err != nil {
			return "", err
		}
		r, err := filepath.Rel(top, abs)
		return filepath.ToSlash(r), err
	}
	right, err := repoRel(path)
	if err != nil {
		return DiffContents{}, err
	}
	left := right
	if oldPath != "" {
		if left, err = repoRel(oldPath); err != nil {
			return DiffContents{}, err
		}
	}
	d := DiffContents{Path: path}
	if b, err := g.run(ctx, top, true, "show", hash+"^:"+left); err == nil {
		d.Left = string(b)
	}
	if b, err := g.run(ctx, top, true, "show", hash+":"+right); err == nil {
		d.Right = string(b)
	}
	d.Binary = strings.ContainsRune(d.Left, 0) || strings.ContainsRune(d.Right, 0)
	if d.Binary {
		d.Left, d.Right = "", ""
	}
	return d, nil
}

// ---------------------------------------------------------------- blame (S27)

// BlameCommit é um commit citado no blame.
type BlameCommit struct {
	Hash    string `json:"hash"`
	Short   string `json:"short"`
	Author  string `json:"author"`
	Date    int64  `json:"date"`
	Summary string `json:"summary"`
	Pending bool   `json:"pending"` // linha ainda não commitada
}

// Blame diz, por linha, de qual commit ela veio.
type Blame struct {
	Commits []BlameCommit `json:"commits"`
	Lines   []int         `json:"lines"` // índice em Commits para cada linha (1ª linha = Lines[0])
}

// Blame anota o arquivo como está no disco (as linhas não commitadas aparecem como pendentes).
// -w ignora mudanças só de espaço; -C acompanha código movido de outro arquivo do mesmo commit.
func (g *Git) Blame(projectID, path string) (Blame, error) {
	ctx := context.Background()
	o, err := g.reg.Get(projectID)
	if err != nil {
		return Blame{}, err
	}
	top, err := g.toplevel(ctx, o)
	if err != nil {
		return Blame{}, err
	}
	abs, err := o.Abs(path)
	if err != nil {
		return Blame{}, err
	}
	rel, err := filepath.Rel(top, abs)
	if err != nil {
		return Blame{}, err
	}
	out, err := g.run(ctx, top, true, "blame", "--porcelain", "-w", "-C", "--", filepath.ToSlash(rel))
	if err != nil {
		var ge *gitError
		if errors.As(err, &ge) && strings.Contains(ge.stderr, "no such path") {
			return Blame{}, errors.New("arquivo não versionado: ainda não há histórico para anotar")
		}
		return Blame{}, err
	}
	return parseBlame(out), nil
}

func parseBlame(out []byte) Blame {
	b := Blame{Commits: []BlameCommit{}, Lines: []int{}}
	index := map[string]int{}
	var cur string
	for _, line := range strings.Split(string(out), "\n") {
		if line == "" {
			continue
		}
		if line[0] == '\t' {
			b.Lines = append(b.Lines, index[cur])
			continue
		}
		f := strings.Fields(line)
		if len(f) >= 3 && len(f[0]) == 40 && isHex(f[0]) {
			cur = f[0]
			if _, ok := index[cur]; !ok {
				index[cur] = len(b.Commits)
				pending := strings.Trim(cur, "0") == ""
				b.Commits = append(b.Commits, BlameCommit{Hash: cur, Short: cur[:7], Pending: pending})
			}
			continue
		}
		c := &b.Commits[index[cur]]
		key, val, _ := strings.Cut(line, " ")
		switch key {
		case "author":
			c.Author = val
		case "author-time":
			if s, err := strconv.ParseInt(val, 10, 64); err == nil {
				c.Date = s * 1000
			}
		case "summary":
			c.Summary = val
		}
	}
	for i := range b.Commits {
		if b.Commits[i].Pending {
			b.Commits[i].Author = "você"
			b.Commits[i].Summary = "Ainda não commitado"
			b.Commits[i].Date = time.Now().UnixMilli()
		}
	}
	return b
}

func isHex(s string) bool {
	for _, c := range s {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}
