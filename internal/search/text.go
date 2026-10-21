package search

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path"
	"regexp"
	"regexp/syntax"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"goide/internal/events"
	"goide/internal/store"
	"goide/internal/workspace"
)

// Options é o que o usuário marcou no diálogo "Buscar nos arquivos".
type Options struct {
	Query         string `json:"query"`
	Regex         bool   `json:"regex"`
	CaseSensitive bool   `json:"caseSensitive"`
	WholeWords    bool   `json:"wholeWords"`
	Mask          string `json:"mask"` // "*.go, !*_test.go"; "" = todos
	Dir           string `json:"dir"`  // escopo: pasta relativa ao projeto; "" = projeto todo
}

// Match é uma ocorrência. Colunas em unidades UTF-16 (as do Monaco), começando em 1.
type Match struct {
	Path    string `json:"path"`
	Line    int    `json:"line"`
	Col     int    `json:"col"`
	Len     int    `json:"len"`
	Preview string `json:"preview"` // a linha (cortada se for longa)
	Start   int    `json:"start"`   // trecho casado dentro de Preview (UTF-16)
	End     int    `json:"end"`
}

// TextResults é uma fatia dos resultados de uma busca.
type TextResults struct {
	Matches   []Match `json:"matches"`
	Next      int     `json:"next"` // passe de volta em from para continuar
	Done      bool    `json:"done"`
	Truncated bool    `json:"truncated"` // parou em MaxMatches
	Files     int     `json:"files"`     // arquivos com ocorrência até agora
	Error     string  `json:"error,omitempty"`
}

type textRun struct {
	id        string
	projectID string
	cancel    context.CancelFunc

	mu        sync.Mutex
	matches   []Match
	files     int
	done      bool
	truncated bool
	err       string
}

// previewMax: linhas maiores são cortadas em volta da ocorrência.
const previewMax = 240

// compile monta a regex da busca (o texto literal vira regex escapada).
func compile(o Options) (*regexp.Regexp, error) {
	if o.Query == "" {
		return nil, errors.New("digite o que buscar")
	}
	expr := o.Query
	if !o.Regex {
		expr = regexp.QuoteMeta(expr)
	}
	if o.WholeWords {
		expr = `\b(?:` + expr + `)\b`
	}
	if !o.CaseSensitive {
		expr = `(?i)` + expr
	}
	re, err := regexp.Compile(expr)
	if err != nil {
		var se *syntax.Error
		if errors.As(err, &se) {
			return nil, fmt.Errorf("expressão regular inválida: %s", se.Code)
		}
		return nil, fmt.Errorf("expressão regular inválida: %w", err)
	}
	return re, nil
}

// maskFilter: padrões separados por vírgula; "!" exclui. Sem '/', o padrão vale para o nome do arquivo.
func maskFilter(mask string) func(rel string) bool {
	var inc, exc []string
	for _, m := range strings.Split(mask, ",") {
		m = strings.TrimSpace(m)
		switch {
		case m == "":
		case strings.HasPrefix(m, "!"):
			exc = append(exc, strings.TrimSpace(m[1:]))
		default:
			inc = append(inc, m)
		}
	}
	match := func(pat, rel string) bool {
		target := rel
		if !strings.Contains(pat, "/") {
			target = path.Base(rel)
		}
		ok, _ := path.Match(pat, target)
		return ok
	}
	return func(rel string) bool {
		for _, p := range exc {
			if match(p, rel) {
				return false
			}
		}
		if len(inc) == 0 {
			return true
		}
		for _, p := range inc {
			if match(p, rel) {
				return true
			}
		}
		return false
	}
}

// Text começa uma busca e devolve o id. Os resultados vêm por Results; o evento search:update avisa quando há
// novos. Uma busca nova no mesmo projeto cancela a anterior (o usuário continuou digitando).
func (s *Service) Text(projectID string, opt Options) (string, error) {
	o, err := s.reg.Get(projectID)
	if err != nil {
		return "", err
	}
	re, err := compile(opt)
	if err != nil {
		return "", err
	}
	dir := strings.Trim(opt.Dir, "/")
	if dir != "" {
		if _, err := o.Abs(dir); err != nil {
			return "", err
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	r := &textRun{id: store.NewID(), projectID: projectID, cancel: cancel}
	s.mu.Lock()
	if prev := s.runs[s.latest[projectID]]; prev != nil {
		prev.cancel()
		delete(s.runs, prev.id)
	}
	s.runs[r.id] = r
	s.latest[projectID] = r.id
	s.mu.Unlock()

	go func() {
		defer cancel()
		list, err := s.paths(ctx, o)
		if err != nil {
			r.finish(err.Error())
			s.notify(r)
			return
		}
		keep := maskFilter(opt.Mask)
		todo := list[:0:0]
		for _, p := range list {
			if (dir == "" || p == dir || strings.HasPrefix(p, dir+"/")) && keep(p) {
				todo = append(todo, p)
			}
		}
		s.scan(ctx, r, o.RootPath, todo, re)
		r.finish("")
		s.notify(r)
	}()
	return r.id, nil
}

func (r *textRun) finish(errMsg string) {
	r.mu.Lock()
	r.done = true
	r.err = errMsg
	r.mu.Unlock()
}

func (s *Service) notify(r *textRun) {
	r.mu.Lock()
	data := map[string]any{"id": r.id, "projectId": r.projectID, "count": len(r.matches), "done": r.done}
	r.mu.Unlock()
	s.bus.Emit(events.SearchUpdate, data)
}

// scan lê os arquivos em paralelo e junta os resultados na ordem da lista (a UI não "pula" enquanto chega).
func (s *Service) scan(ctx context.Context, r *textRun, root string, list []string, re *regexp.Regexp) {
	type slot struct {
		matches []Match
		ready   bool
	}
	slots := make([]slot, len(list))
	var mu sync.Mutex
	cond := sync.NewCond(&mu)
	next := make(chan int)
	workers := min(runtime.NumCPU(), 8)
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range next {
				var ms []Match
				if ctx.Err() == nil {
					ms = searchFile(root, list[i], re)
				}
				mu.Lock()
				slots[i] = slot{matches: ms, ready: true}
				cond.Broadcast()
				mu.Unlock()
			}
		}()
	}
	go func() {
		defer close(next)
		for i := range list {
			select {
			case next <- i:
			case <-ctx.Done():
				// Os que não saíram contam como prontos e vazios: o coletor não fica esperando por eles.
				mu.Lock()
				for k := i; k < len(list); k++ {
					slots[k].ready = true
				}
				cond.Broadcast()
				mu.Unlock()
				return
			}
		}
	}()

	lastNotify := time.Now()
	for i := range list {
		mu.Lock()
		for !slots[i].ready {
			cond.Wait()
		}
		ms := slots[i].matches
		slots[i].matches = nil
		mu.Unlock()
		if ctx.Err() != nil {
			continue
		}
		if len(ms) == 0 {
			continue
		}
		r.mu.Lock()
		room := MaxMatches - len(r.matches)
		if len(ms) > room {
			ms = ms[:room]
			r.truncated = true
		}
		r.matches = append(r.matches, ms...)
		r.files++
		full := r.truncated
		r.mu.Unlock()
		if full {
			r.cancel()
		}
		if time.Since(lastNotify) > 100*time.Millisecond {
			s.notify(r)
			lastNotify = time.Now()
		}
	}
	wg.Wait()
}

// searchFile acha as ocorrências num arquivo. Binários e grandes demais ficam de fora.
func searchFile(root, rel string, re *regexp.Regexp) []Match {
	data, ok := readText(root, rel)
	if !ok {
		return nil
	}
	var out []Match
	line := 0
	for len(data) > 0 || line == 0 {
		line++
		var text []byte
		if i := bytes.IndexByte(data, '\n'); i >= 0 {
			text, data = data[:i], data[i+1:]
		} else {
			text, data = data, nil
		}
		text = bytes.TrimSuffix(text, []byte{'\r'})
		for _, loc := range re.FindAllIndex(text, -1) {
			if loc[0] == loc[1] {
				continue // regex que casa vazio (^, a*): não é uma ocorrência útil
			}
			out = append(out, makeMatch(rel, line, text, loc[0], loc[1]))
		}
		if data == nil {
			break
		}
	}
	return out
}

func readText(root, rel string) ([]byte, bool) {
	abs, err := workspace.SafeJoin(root, rel)
	if err != nil {
		return nil, false
	}
	st, err := os.Lstat(abs)
	if err != nil || !st.Mode().IsRegular() || st.Size() > MaxFileBytes {
		return nil, false
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return nil, false
	}
	head := data[:min(len(data), 8000)]
	if bytes.IndexByte(head, 0) >= 0 {
		return nil, false
	}
	return data, true
}

func makeMatch(rel string, line int, text []byte, a, b int) Match {
	col := u16len(text[:a])
	n := u16len(text[a:b])
	// Corta a linha longa em volta da ocorrência, sem quebrar um caractere no meio.
	from, to := 0, len(text)
	if len(text) > previewMax {
		from = max(0, a-previewMax/3)
		to = min(len(text), max(b, from+previewMax))
		for from > 0 && !utf8.RuneStart(text[from]) {
			from--
		}
		for to < len(text) && !utf8.RuneStart(text[to]) {
			to++
		}
	}
	pv := text[from:to]
	start := u16len(text[from:a])
	return Match{
		Path: rel, Line: line, Col: col + 1, Len: n,
		Preview: strings.ToValidUTF8(string(pv), "�"),
		Start:   start, End: start + n,
	}
}

func u16len(b []byte) int {
	n := 0
	for len(b) > 0 {
		r, size := utf8.DecodeRune(b)
		b = b[size:]
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

// Results devolve as ocorrências a partir de from (no máximo max) e o estado da busca.
func (s *Service) Results(searchID string, from, max int) (TextResults, error) {
	s.mu.Lock()
	r := s.runs[searchID]
	s.mu.Unlock()
	if r == nil {
		return TextResults{}, errors.New("busca não encontrada (foi substituída por outra)")
	}
	if max <= 0 || max > 2000 {
		max = 2000
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	from = min(max0(from), len(r.matches))
	to := min(from+max, len(r.matches))
	out := make([]Match, to-from)
	copy(out, r.matches[from:to])
	return TextResults{Matches: out, Next: to, Done: r.done && to == len(r.matches), Truncated: r.truncated, Files: r.files, Error: r.err}, nil
}

func max0(n int) int { return max(n, 0) }

// Cancel interrompe a busca. Os resultados já achados continuam disponíveis.
func (s *Service) Cancel(searchID string) {
	s.mu.Lock()
	r := s.runs[searchID]
	s.mu.Unlock()
	if r != nil {
		r.cancel()
	}
}

// ---------------------------------------------------------------- substituir

// Target é uma ocorrência que o usuário quer substituir.
type Target struct {
	Path string `json:"path"`
	Line int    `json:"line"`
	Col  int    `json:"col"` // UTF-16, começando em 1 (como em Match)
}

// ReplaceResult diz o que mudou. Skipped: ocorrências que não estavam mais lá (o arquivo mudou depois da busca).
type ReplaceResult struct {
	Paths    []string `json:"paths"`
	Replaced int      `json:"replaced"`
	Skipped  int      `json:"skipped"`
}

// Replace troca as ocorrências escolhidas. Cada uma é conferida de novo no disco: se a linha mudou desde a busca,
// ela é pulada em vez de estragar o arquivo. Com regex, $1/${nome} no texto novo usam os grupos.
// A UI salva os editores antes e recarrega do disco os arquivos devolvidos.
func (s *Service) Replace(projectID string, opt Options, replacement string, targets []Target) (ReplaceResult, error) {
	o, err := s.reg.Get(projectID)
	if err != nil {
		return ReplaceResult{}, err
	}
	re, err := compile(opt)
	if err != nil {
		return ReplaceResult{}, err
	}
	byPath := map[string]map[[2]int]bool{}
	for _, t := range targets {
		if byPath[t.Path] == nil {
			byPath[t.Path] = map[[2]int]bool{}
		}
		byPath[t.Path][[2]int{t.Line, t.Col}] = true
	}
	paths := make([]string, 0, len(byPath))
	for p := range byPath {
		paths = append(paths, p)
	}
	sort.Strings(paths)

	res := ReplaceResult{Paths: []string{}}
	for _, rel := range paths {
		want := byPath[rel]
		if _, err := o.Abs(rel); err != nil {
			return res, err
		}
		data, ok := readText(o.RootPath, rel)
		if !ok {
			res.Skipped += len(want)
			continue
		}
		out, n := replaceIn(data, re, opt.Regex, replacement, want)
		res.Replaced += n
		res.Skipped += len(want) - n
		if n == 0 {
			continue
		}
		abs, _ := o.Abs(rel)
		st, err := os.Stat(abs)
		if err != nil {
			return res, err
		}
		w, err := s.files.Write(projectID, rel, string(out), st.ModTime().UnixMilli())
		if err != nil {
			return res, err
		}
		if w.Conflict {
			res.Replaced -= n
			res.Skipped += n
			continue
		}
		res.Paths = append(res.Paths, rel)
	}
	if len(res.Paths) > 0 {
		s.bus.Emit(events.FsChanged, map[string]any{"projectId": projectID, "paths": res.Paths})
		s.bus.Emit(events.GitStatus, map[string]string{"projectId": projectID})
	}
	return res, nil
}

// replaceIn refaz a busca linha a linha e troca só as ocorrências em (linha, coluna) pedidas.
func replaceIn(data []byte, re *regexp.Regexp, isRegex bool, repl string, want map[[2]int]bool) ([]byte, int) {
	var out bytes.Buffer
	out.Grow(len(data))
	n := 0
	line := 0
	for {
		line++
		var text []byte
		rest := []byte(nil)
		eol := ""
		if i := bytes.IndexByte(data, '\n'); i >= 0 {
			text, rest, eol = data[:i], data[i+1:], "\n"
		} else {
			text = data
		}
		cr := bytes.HasSuffix(text, []byte{'\r'})
		if cr {
			text = text[:len(text)-1]
		}
		last := 0
		for _, loc := range re.FindAllSubmatchIndex(text, -1) {
			if loc[0] == loc[1] || !want[[2]int{line, u16len(text[:loc[0]]) + 1}] {
				continue
			}
			out.Write(text[last:loc[0]])
			if isRegex {
				out.Write(re.Expand(nil, []byte(repl), text, loc))
			} else {
				out.WriteString(repl)
			}
			last = loc[1]
			n++
		}
		out.Write(text[last:])
		if cr {
			out.WriteByte('\r')
		}
		out.WriteString(eol)
		if eol == "" {
			break
		}
		data = rest
	}
	return out.Bytes(), n
}
