package debug

import (
	"bufio"
	"context"
	"net"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestAttachRemoteHeadless(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	// Porta livre para o dlv headless.
	l, _ := net.Listen("tcp", "127.0.0.1:0")
	port := l.Addr().(*net.TCPAddr).Port
	l.Close()
	addr := "127.0.0.1:" + strconv.Itoa(port)
	head := exec.Command(find("dlv"), "debug", "--headless", "--listen="+addr, "--api-version=2", "--accept-multiclient")
	head.Dir = f.root
	head.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	stdout, _ := head.StdoutPipe()
	if err := head.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = syscall.Kill(-head.Process.Pid, syscall.SIGKILL); _ = head.Wait() })
	ready := make(chan struct{})
	go func() {
		sc := bufio.NewScanner(stdout)
		for sc.Scan() {
			if strings.Contains(sc.Text(), "API server listening") {
				close(ready)
				break
			}
		}
		for sc.Scan() {
		}
	}()
	select {
	case <-ready:
	case <-time.After(2 * time.Minute):
		t.Fatal("o dlv headless não subiu")
	}

	if _, err := f.m.AttachRemote(f.p.ID, "sem-porta"); err == nil {
		t.Fatal("endereço sem porta deveria ser recusado")
	}
	if on, err := f.db.ToggleLineBreakpoint(ctx, f.p.ID, "main.go", 13); err != nil || !on {
		t.Fatalf("toggle: %v %v", on, err)
	}
	info, err := f.m.AttachRemote(f.p.ID, addr)
	if err != nil {
		t.Fatal(err)
	}
	// O headless começa parado na entrada: continua até o breakpoint.
	deadline := time.After(2 * time.Minute)
	for {
		cur := f.m.List(f.p.ID)
		var s Info
		for _, x := range cur {
			if x.ID == info.ID {
				s = x
			}
		}
		if s.State == StateStopped && s.Line == 13 {
			break
		}
		if s.State == StateTerminated {
			t.Fatalf("a sessão terminou: %+v\n%s", s, outText(f, info.ID))
		}
		if s.State == StateRunning || (s.State == StateStopped && s.Line != 13) {
			_ = f.m.Control(info.ID, "resume", 0)
		}
		select {
		case <-deadline:
			t.Fatalf("não parou no breakpoint: %+v", s)
		case <-time.After(300 * time.Millisecond):
		}
	}
	v, err := f.m.Evaluate(info.ID, firstFrame(t, f, info.ID), "it.Name")
	if err != nil || !strings.Contains(v.Value, "café") {
		t.Fatalf("avaliar: %+v %v", v, err)
	}
	// Parar só desconecta: o headless continua de pé.
	if err := f.m.Stop(info.ID); err != nil {
		t.Fatal(err)
	}
	time.Sleep(300 * time.Millisecond)
	if err := head.Process.Signal(syscall.Signal(0)); err != nil {
		t.Fatal("o dlv headless deveria continuar rodando depois de desconectar")
	}
}

func firstFrame(t *testing.T, f *fixture, id string) int {
	t.Helper()
	frames, err := f.m.Stack(id, 0)
	if err != nil || len(frames) == 0 {
		t.Fatalf("pilha: %v", err)
	}
	return frames[0].ID
}

func outText(f *fixture, id string) string {
	o, err := f.m.Output(id)
	if err != nil {
		return ""
	}
	cur := o.Subscribe()
	defer cur.Close()
	batch, _, _ := cur.Next(1 << 20)
	var b strings.Builder
	for _, c := range batch {
		b.WriteString(c.D)
	}
	return b.String()
}
