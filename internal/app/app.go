// Package app monta o backend: banco, serviços, hub do gopls e a ponte local.
package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"goide/internal/api"
	"goide/internal/bridge"
	"goide/internal/debug"
	"goide/internal/events"
	"goide/internal/files"
	"goide/internal/gitx"
	"goide/internal/lsp"
	"goide/internal/run"
	"goide/internal/sdk"
	"goide/internal/search"
	"goide/internal/store"
	"goide/internal/term"
	"goide/internal/tools"
	"goide/internal/workspace"
)

// Name é o nome provisório do produto (o /replica-brand troca).
const Name = "goide"

// Options configura a montagem.
type Options struct {
	DataDir        string   // "" = os.UserConfigDir()/goide
	CacheDir       string   // "" = os.UserCacheDir()/goide
	BridgeAddr     string   // "" = 127.0.0.1:0
	AllowedOrigins []string // Origins da UI
	Dev            bool
}

// WailsOrigins são as Origins da página do app nos três sistemas.
var WailsOrigins = []string{"wails://wails", "wails://wails.localhost", "http://wails.localhost"}

// New monta o Core e liga a ponte.
func New(ctx context.Context, opt Options) (*api.Core, error) {
	if opt.DataDir == "" {
		base, err := os.UserConfigDir()
		if err != nil {
			return nil, err
		}
		opt.DataDir = filepath.Join(base, Name)
	}
	if opt.CacheDir == "" {
		base, err := os.UserCacheDir()
		if err != nil {
			return nil, err
		}
		opt.CacheDir = filepath.Join(base, Name)
	}
	if opt.BridgeAddr == "" {
		opt.BridgeAddr = "127.0.0.1:0"
	}
	buildDir := filepath.Join(opt.CacheDir, "builds")
	if err := os.MkdirAll(buildDir, 0o700); err != nil {
		return nil, fmt.Errorf("criar cache: %w", err)
	}
	// Restos de builds de uma sessão que caiu.
	if old, err := filepath.Glob(filepath.Join(buildDir, "build-*")); err == nil {
		for _, d := range old {
			os.RemoveAll(d)
		}
	}

	db, err := store.Open(ctx, filepath.Join(opt.DataDir, "state.db"))
	if err != nil {
		return nil, err
	}
	finder := &tools.Finder{AppToolsDir: filepath.Join(opt.DataDir, "tools", "bin")}
	find := func(name string) func() string { return func() string { return finder.Find(name) } }
	bus := events.NewBus()
	reg := workspace.NewRegistry(db)
	hub := lsp.NewHub(reg, bus, find("gopls"))
	runs := run.NewManager(db, reg, bus, find("go"), buildDir)
	dbg := debug.NewManager(db, reg, bus, find("dlv"), find("go"))

	fl := files.New(reg)
	c := &api.Core{
		DB: db, Bus: bus, Reg: reg, Tools: finder, Hub: hub, Runs: runs, Debug: dbg,
		RunCfgs: run.NewRunConfigs(db, reg),
		Files:   fl,
		Search:  search.New(reg, bus, fl, find("git")),
		Terms:   term.NewManager(reg, bus),
		Git:     gitx.New(reg, bus, find("git")),
		Sdks:    sdk.New(db, finder),
		Dev:     opt.Dev,
	}
	var rpc *bridge.Dispatcher
	if opt.Dev {
		rpc = bridge.NewDispatcher(c.Services())
	}
	br, err := bridge.New(bridge.Config{Addr: opt.BridgeAddr, AllowedOrigins: opt.AllowedOrigins, Dev: opt.Dev}, hub, outputs{runs, dbg}, bus, rpc)
	if err != nil {
		db.Close()
		return nil, err
	}
	br.SetTerminals(c.Terms)
	if err := br.Start(); err != nil {
		db.Close()
		return nil, fmt.Errorf("abrir a ponte local: %w", err)
	}
	c.Bridge = br
	return c, nil
}

// outputs junta as saídas de execuções e de sessões de depuração (os ids não colidem: UUID v7).
type outputs struct {
	runs *run.Manager
	dbg  *debug.Manager
}

func (o outputs) Output(id string) (*run.Output, error) {
	if out, err := o.runs.Output(id); err == nil {
		return out, nil
	}
	return o.dbg.Output(id)
}

// Shutdown encerra tudo: processos do usuário, gopls, ponte e banco.
func Shutdown(c *api.Core) {
	c.Terms.StopAll()
	c.Debug.StopAll()
	c.Runs.StopAll()
	c.Hub.StopAll()
	_ = c.Bridge.Close()
	_ = c.DB.Close()
}
