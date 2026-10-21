package bridge

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"prumo/internal/events"
)

type calc struct{}

func (calc) Add(a, b int) (int, error) { return a + b, nil }
func (calc) Fail() error               { return errors.New("falhou de propósito") }
func (calc) Echo(m map[string]string) map[string]string {
	return m
}

func TestDispatcher(t *testing.T) {
	d := NewDispatcher(map[string]any{"Calc": calc{}})
	res, err := d.Call("Calc.Add", []json.RawMessage{json.RawMessage("2"), json.RawMessage("3")})
	if err != nil || res.(int) != 5 {
		t.Fatalf("Add = %v, %v", res, err)
	}
	if _, err := d.Call("Calc.Fail", nil); err == nil || err.Error() != "falhou de propósito" {
		t.Fatalf("Fail = %v", err)
	}
	if _, err := d.Call("Calc.Add", []json.RawMessage{json.RawMessage("2")}); err == nil {
		t.Fatal("aridade errada deveria falhar")
	}
	if _, err := d.Call("Calc.Add", []json.RawMessage{json.RawMessage(`"x"`), json.RawMessage("1")}); err == nil {
		t.Fatal("tipo errado deveria falhar")
	}
	var ue *UnknownMethodError
	if _, err := d.Call("Calc.Nope", nil); !errors.As(err, &ue) {
		t.Fatalf("desconhecido: %v", err)
	}
	res, _ = d.Call("Calc.Echo", []json.RawMessage{json.RawMessage(`{"a":"b"}`)})
	if res.(map[string]string)["a"] != "b" {
		t.Fatalf("Echo = %v", res)
	}
}

func TestGuard(t *testing.T) {
	if _, err := New(Config{Addr: "0.0.0.0:0"}, nil, nil, nil, nil); err == nil {
		t.Fatal("escutar fora de loopback deveria falhar")
	}
	s, err := New(Config{Addr: "127.0.0.1:0", AllowedOrigins: []string{"http://localhost:5173"}, Dev: true},
		nil, nil, events.NewBus(), NewDispatcher(map[string]any{"Calc": calc{}}))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Start(); err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	url := "http://127.0.0.1:" + strconv.Itoa(s.Port()) + "/rpc"
	body := `{"method":"Calc.Add","args":[1,2]}`

	do := func(token, origin, ctype string) (int, string) {
		req, _ := http.NewRequest("POST", url, bytes.NewBufferString(body))
		if token != "" {
			req.Header.Set(TokenHeader, token)
		}
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		req.Header.Set("Content-Type", ctype)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b)
	}
	if code, _ := do("", "", "application/json"); code != http.StatusUnauthorized {
		t.Errorf("sem token: %d", code)
	}
	if code, _ := do("errado", "", "application/json"); code != http.StatusUnauthorized {
		t.Errorf("token errado: %d", code)
	}
	if code, _ := do(s.Token(), "https://malicioso.example", "application/json"); code != http.StatusForbidden {
		t.Errorf("origem estranha: %d", code)
	}
	if code, _ := do(s.Token(), "", "text/plain"); code != http.StatusUnsupportedMediaType {
		t.Errorf("text/plain: %d", code)
	}
	code, out := do(s.Token(), "http://localhost:5173", "application/json")
	if code != 200 || !strings.Contains(out, `"result":3`) {
		t.Errorf("chamada válida: %d %s", code, out)
	}
}
