package bridge

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
)

// UnknownMethodError: o método pedido não existe na API.
type UnknownMethodError struct{ Name string }

func (e *UnknownMethodError) Error() string { return "método desconhecido: " + e.Name }

var errorType = reflect.TypeOf((*error)(nil)).Elem()

// Dispatcher chama métodos de serviços por nome ("Projects.Open"), com argumentos JSON posicionais.
// É o mesmo contrato dos bindings do Wails, para a UI rodar igual no navegador (modo dev).
type Dispatcher struct {
	methods map[string]reflect.Value
}

// NewDispatcher registra todos os métodos exportados de cada serviço, com o nome dado no mapa.
func NewDispatcher(services map[string]any) *Dispatcher {
	d := &Dispatcher{methods: map[string]reflect.Value{}}
	for name, svc := range services {
		v := reflect.ValueOf(svc)
		t := v.Type()
		for i := 0; i < t.NumMethod(); i++ {
			d.methods[name+"."+t.Method(i).Name] = v.Method(i)
		}
	}
	return d
}

// Methods lista os nomes registrados (para conferir contra o cliente TS).
func (d *Dispatcher) Methods() []string {
	out := make([]string, 0, len(d.methods))
	for k := range d.methods {
		out = append(out, k)
	}
	return out
}

// Call decodifica os argumentos nos tipos dos parâmetros e chama o método.
// Métodos devolvem (T, error), (error), (T) ou nada — como o Wails aceita.
func (d *Dispatcher) Call(name string, args []json.RawMessage) (any, error) {
	m, ok := d.methods[name]
	if !ok {
		return nil, &UnknownMethodError{Name: name}
	}
	mt := m.Type()
	if len(args) != mt.NumIn() {
		return nil, fmt.Errorf("%s espera %d argumentos, recebeu %d", name, mt.NumIn(), len(args))
	}
	in := make([]reflect.Value, mt.NumIn())
	for i := range in {
		p := reflect.New(mt.In(i))
		if err := json.Unmarshal(args[i], p.Interface()); err != nil {
			return nil, fmt.Errorf("%s: argumento %d inválido: %v", name, i+1, err)
		}
		in[i] = p.Elem()
	}
	out := m.Call(in)
	var result any
	for _, o := range out {
		if o.Type().Implements(errorType) && o.Type().Kind() == reflect.Interface {
			if !o.IsNil() {
				return nil, o.Interface().(error)
			}
			continue
		}
		result = o.Interface()
	}
	return result, nil
}

// ServiceOf separa "Projects.Open" em ("Projects", "Open").
func ServiceOf(full string) (string, string) {
	i := strings.LastIndexByte(full, '.')
	if i < 0 {
		return full, ""
	}
	return full[:i], full[i+1:]
}
