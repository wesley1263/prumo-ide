// Command goide é a IDE desktop (Wails v2).
//
// Linux: precisa de libgtk-3-dev e libwebkit2gtk-4.1-dev; compile com -tags webkit2_41.
//
//	wails dev -tags webkit2_41
//	wails build -tags webkit2_41
package main

import (
	"context"
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"goide/internal/app"
	"goide/internal/events"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	core, err := app.New(context.Background(), app.Options{AllowedOrigins: app.WailsOrigins})
	if err != nil {
		log.Fatal(err)
	}
	services := core.Services()
	bind := []any{}
	for _, name := range []string{"App", "Projects", "Dialogs", "Workspace", "Settings", "Sdks", "Tools", "Files", "Git", "RunConfigs", "Runs", "Debug", "Breakpoints", "Tests", "Search", "Terminal"} {
		bind = append(bind, services[name])
	}

	err = wails.Run(&options.App{
		Title:            "goide",
		Width:            1440,
		Height:           900,
		MinWidth:         800,
		MinHeight:        500,
		AssetServer:      &assetserver.Options{Assets: assets},
		BackgroundColour: &options.RGBA{R: 0x1d, G: 0x1e, B: 0x21, A: 0xff}, // color.dark.bg dos tokens
		OnStartup: func(ctx context.Context) {
			core.Bus.SetSink(func(name string, data any) { wruntime.EventsEmit(ctx, name, data) })
			core.PickDir = func(title string) (string, error) {
				return wruntime.OpenDirectoryDialog(ctx, wruntime.OpenDialogOptions{Title: title})
			}
			core.QuitApp = func() { wruntime.Quit(ctx) }
		},
		// Fechar com arquivos não salvos: segura a janela, a UI salva tudo e chama App.Quit.
		OnBeforeClose: func(ctx context.Context) bool {
			if !core.HasUnsaved() {
				return false
			}
			core.Bus.Emit(events.BeforeClose, map[string]any{})
			return true
		},
		OnShutdown: func(context.Context) { app.Shutdown(core) },
		Bind:       bind,
	})
	if err != nil {
		log.Fatal(err)
	}
}
