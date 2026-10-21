// Package debug depura programas e testes Go pelo Delve, falando DAP (Debug Adapter Protocol).
package debug

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"

	"github.com/google/go-dap"
)

// client é um cliente DAP mínimo sobre uma conexão: requisições com espera de resposta e eventos num callback.
type client struct {
	conn    net.Conn
	r       *bufio.Reader
	wmu     sync.Mutex
	mu      sync.Mutex
	seq     int
	pending map[int]chan dap.Message
	onEvent func(dap.EventMessage)
	closed  chan struct{}
	err     error
}

func newClient(conn net.Conn, onEvent func(dap.EventMessage)) *client {
	c := &client{conn: conn, r: bufio.NewReader(conn), pending: map[int]chan dap.Message{}, onEvent: onEvent, closed: make(chan struct{})}
	go c.readLoop()
	return c
}

func (c *client) readLoop() {
	defer close(c.closed)
	for {
		msg, err := dap.ReadProtocolMessage(c.r)
		if err != nil {
			if !errors.Is(err, io.EOF) && !errors.Is(err, net.ErrClosed) {
				c.err = err
			}
			c.mu.Lock()
			for seq, ch := range c.pending {
				close(ch)
				delete(c.pending, seq)
			}
			c.mu.Unlock()
			return
		}
		switch m := msg.(type) {
		case dap.ResponseMessage:
			seq := m.GetResponse().RequestSeq
			c.mu.Lock()
			ch := c.pending[seq]
			delete(c.pending, seq)
			c.mu.Unlock()
			if ch != nil {
				ch <- msg
			}
		case dap.EventMessage:
			c.onEvent(m)
		}
	}
}

// do manda a requisição (preenchendo seq e tipo) e espera a resposta. Falha de DAP vira erro com a mensagem do Delve.
func (c *client) do(ctx context.Context, req dap.RequestMessage) (dap.ResponseMessage, error) {
	r := req.GetRequest()
	c.mu.Lock()
	c.seq++
	r.Seq = c.seq
	r.Type = "request"
	ch := make(chan dap.Message, 1)
	c.pending[r.Seq] = ch
	c.mu.Unlock()

	c.wmu.Lock()
	err := dap.WriteProtocolMessage(c.conn, req)
	c.wmu.Unlock()
	if err != nil {
		return nil, err
	}
	select {
	case msg, ok := <-ch:
		if !ok {
			return nil, errors.New("o depurador encerrou")
		}
		resp := msg.(dap.ResponseMessage)
		if base := resp.GetResponse(); !base.Success {
			if e, ok := msg.(*dap.ErrorResponse); ok && e.Body.Error != nil && e.Body.Error.Format != "" {
				return nil, fmt.Errorf("%s: %s", r.Command, e.Body.Error.Format)
			}
			return nil, fmt.Errorf("%s: %s", r.Command, base.Message)
		}
		return resp, nil
	case <-ctx.Done():
		c.mu.Lock()
		delete(c.pending, r.Seq)
		c.mu.Unlock()
		return nil, ctx.Err()
	}
}

func (c *client) close() { _ = c.conn.Close() }

func req(command string) dap.Request {
	return dap.Request{Command: command}
}

func raw(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}
