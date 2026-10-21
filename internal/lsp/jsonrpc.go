package lsp

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/textproto"
	"strconv"
	"strings"
)

// message é uma mensagem JSON-RPC 2.0 genérica. Os campos ficam crus para o hub repassar sem reinterpretar.
type message struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   json.RawMessage `json:"error,omitempty"`
}

func (m *message) isRequest() bool      { return m.Method != "" && len(m.ID) > 0 }
func (m *message) isNotification() bool { return m.Method != "" && len(m.ID) == 0 }
func (m *message) isResponse() bool     { return m.Method == "" && len(m.ID) > 0 }

// marshal garante "jsonrpc":"2.0" e, numa resposta sem erro, "result" presente (null é válido).
func (m *message) marshal() []byte {
	m.JSONRPC = "2.0"
	if m.isResponse() && m.Result == nil && m.Error == nil {
		m.Result = json.RawMessage("null")
	}
	b, _ := json.Marshal(m)
	return b
}

// readFrame lê uma mensagem com cabeçalho Content-Length (o enquadramento do LSP sobre stdio).
func readFrame(r *bufio.Reader) ([]byte, error) {
	tp := textproto.NewReader(r)
	hdr, err := tp.ReadMIMEHeader()
	if err != nil {
		return nil, err
	}
	n, err := strconv.Atoi(strings.TrimSpace(hdr.Get("Content-Length")))
	if err != nil || n < 0 {
		return nil, fmt.Errorf("Content-Length inválido: %q", hdr.Get("Content-Length"))
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, err
	}
	return buf, nil
}

// writeFrame escreve uma mensagem com cabeçalho Content-Length.
func writeFrame(w io.Writer, body []byte) error {
	if _, err := fmt.Fprintf(w, "Content-Length: %d\r\n\r\n", len(body)); err != nil {
		return err
	}
	_, err := w.Write(body)
	return err
}
