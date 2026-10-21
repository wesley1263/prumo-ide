package gitx

import (
	"context"
	"path/filepath"
	"strconv"
	"strings"
)

// BranchCompare: o que a outra branch tem e a atual não (e vice-versa), e os arquivos que diferem entre as duas.
type BranchCompare struct {
	Current     string       `json:"current"`
	Other       string       `json:"other"`
	OnlyOther   []LogCommit  `json:"onlyOther"`   // current..other
	OnlyCurrent []LogCommit  `json:"onlyCurrent"` // other..current
	Files       []CommitFile `json:"files"`       // diferença de HEAD para other
	Truncated   bool         `json:"truncated"`
}

const compareMax = 300

// CompareBranches compara a branch atual (HEAD) com outra.
func (g *Git) CompareBranches(projectID, other string) (BranchCompare, error) {
	ctx := context.Background()
	if err := validRev(other); err != nil {
		return BranchCompare{}, err
	}
	o, err := g.reg.Get(projectID)
	if err != nil {
		return BranchCompare{}, err
	}
	top, err := g.toplevel(ctx, o)
	if err != nil {
		return BranchCompare{}, err
	}
	if _, err := g.run(ctx, top, true, "rev-parse", "--verify", "--quiet", other+"^{commit}"); err != nil {
		return BranchCompare{}, err
	}
	cur := "HEAD"
	if out, err := g.run(ctx, top, true, "symbolic-ref", "--short", "-q", "HEAD"); err == nil {
		cur = strings.TrimSpace(string(out))
	}
	remotes := map[string]bool{}
	if rs, err := g.run(ctx, top, true, "remote"); err == nil {
		for _, r := range strings.Fields(string(rs)) {
			remotes[r] = true
		}
	}
	res := BranchCompare{Current: cur, Other: other, OnlyOther: []LogCommit{}, OnlyCurrent: []LogCommit{}, Files: []CommitFile{}}
	side := func(rng string) []LogCommit {
		out, err := g.run(ctx, top, true, "log", "-z", "--format="+logFormat, "--max-count="+strconv.Itoa(compareMax+1), rng, "--")
		if err != nil {
			return []LogCommit{}
		}
		list := parseLog(out, remotes)
		if len(list) > compareMax {
			list, res.Truncated = list[:compareMax], true
		}
		return list
	}
	res.OnlyOther = side("HEAD.." + other)
	res.OnlyCurrent = side(other + "..HEAD")
	if out, err := g.run(ctx, top, true, "diff", "-z", "-M", "--name-status", "HEAD", other, "--"); err == nil {
		res.Files = parseNameStatus(out, func(repoRel string) (string, bool) { return projectPath(o, top, repoRel) })
	}
	return res, nil
}

// RefDiff compara um arquivo entre duas revisões (esquerda = base, direita = other).
func (g *Git) RefDiff(projectID, base, other, path, oldPath string) (DiffContents, error) {
	ctx := context.Background()
	for _, r := range []string{base, other} {
		if err := validRev(r); err != nil {
			return DiffContents{}, err
		}
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
	if b, err := g.run(ctx, top, true, "show", base+":"+left); err == nil {
		d.Left = string(b)
	}
	if b, err := g.run(ctx, top, true, "show", other+":"+right); err == nil {
		d.Right = string(b)
	}
	d.Binary = strings.ContainsRune(d.Left, 0) || strings.ContainsRune(d.Right, 0)
	if d.Binary {
		d.Left, d.Right = "", ""
	}
	return d, nil
}
