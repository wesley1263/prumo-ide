package search

import (
	"strings"
	"unicode"
	"unicode/utf16"
)

// Pontuação do fuzzy. Valem mais: casar no nome do arquivo, no início de palavras (depois de / _ - . ou numa
// maiúscula de CamelCase) e em sequência. Assim "usrsvc" prefere user_service.go a um caminho comprido qualquer.
const (
	scoreChar        = 1
	scoreConsecutive = 5
	scoreWordStart   = 8
	scoreNameStart   = 12
	scoreInName      = 2
	scoreExactName   = 40
)

// matchPath casa a consulta com o caminho. Com '/' na consulta, cada parte casa em ordem ao longo do caminho;
// sem '/', a consulta casa só no nome do arquivo e, se não der, no caminho todo (valendo menos).
func matchPath(query, path string) (int, []int, bool) {
	q := []rune(query)
	p := []rune(path)
	nameStart := strings.LastIndexByte(path, '/') + 1
	nameStart = len([]rune(path[:nameStart]))
	if !strings.ContainsRune(query, '/') {
		if score, pos, ok := matchRunes(q, p, nameStart); ok {
			if strings.EqualFold(string(p[nameStart:]), query) || strings.EqualFold(strings.TrimSuffix(string(p[nameStart:]), extOf(path)), query) {
				score += scoreExactName
			}
			return score + 20, pos, true
		}
	}
	return matchRunes(q, p, 0)
}

func extOf(path string) string {
	i := strings.LastIndexByte(path, '.')
	if i < 0 || i < strings.LastIndexByte(path, '/') {
		return ""
	}
	return path[i:]
}

// matchRunes casa q em p a partir de from: guloso, mas preferindo inícios de palavra quando há escolha.
// Maiúscula na consulta pede início de palavra (como no GoLand: "US" acha UserService antes de users).
func matchRunes(q, p []rune, from int) (int, []int, bool) {
	if len(q) == 0 {
		return 0, nil, true
	}
	nameStart := 0
	for i := len(p) - 1; i >= 0; i-- {
		if p[i] == '/' {
			nameStart = i + 1
			break
		}
	}
	pos := make([]int, 0, len(q))
	score := 0
	j := from
	for qi := 0; qi < len(q); qi++ {
		c := unicode.ToLower(q[qi])
		hump := unicode.IsUpper(q[qi])
		if c == ' ' {
			continue
		}
		// Primeiro casamento possível e, se houver, um início de palavra antes do próximo caractere da consulta
		// casar de forma contígua: "os" em "order_service" deve casar o + s(ervice), não o + (orde)r... s.
		first := -1
		best := -1
		for k := j; k < len(p); k++ {
			if unicode.ToLower(p[k]) != c {
				continue
			}
			if first < 0 {
				first = k
				if len(pos) > 0 && k == pos[len(pos)-1]+1 && !hump {
					best = k // sequência: não troca
					break
				}
			}
			if isWordStart(p, k) && subseq(q[qi+1:], p[k+1:]) {
				best = k
				break
			}
		}
		if first < 0 {
			return 0, nil, false
		}
		if best < 0 {
			best = first
		}
		k := best
		score += scoreChar
		if len(pos) > 0 && k == pos[len(pos)-1]+1 {
			score += scoreConsecutive
		}
		if isWordStart(p, k) {
			score += scoreWordStart
		}
		if k == nameStart {
			score += scoreNameStart
		}
		if k >= nameStart {
			score += scoreInName
		}
		pos = append(pos, k)
		j = k + 1
	}
	// Caminhos curtos ganham no desempate natural; aqui só uma penalidade leve pelo espalhamento.
	if len(pos) > 1 {
		score -= (pos[len(pos)-1] - pos[0] - len(pos) + 1) / 4
	}
	return score, pos, true
}

// subseq diz se q (sem espaços) aparece em ordem dentro de p, ignorando maiúsculas.
func subseq(q, p []rune) bool {
	i := 0
	for _, c := range p {
		for i < len(q) && q[i] == ' ' {
			i++
		}
		if i == len(q) {
			return true
		}
		if unicode.ToLower(c) == unicode.ToLower(q[i]) {
			i++
		}
	}
	for i < len(q) && q[i] == ' ' {
		i++
	}
	return i == len(q)
}

func isWordStart(p []rune, k int) bool {
	if k == 0 {
		return true
	}
	prev := p[k-1]
	switch prev {
	case '/', '_', '-', '.', ' ':
		return true
	}
	return unicode.IsUpper(p[k]) && unicode.IsLower(prev)
}

// utf16Positions converte índices de runa em índices UTF-16 (o que o JS usa para fatiar strings).
func utf16Positions(s string, runes []int) []int {
	if len(runes) == 0 {
		return []int{}
	}
	conv := make([]int, 0, len(runes))
	r := []rune(s)
	u, ri := 0, 0
	for _, want := range runes {
		for ; ri < want; ri++ {
			u += len(utf16.Encode([]rune{r[ri]}))
		}
		conv = append(conv, u)
	}
	return conv
}
