// Command prumo é a IDE desktop (Wails v2).
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
	"os"
	"sort"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"prumo/internal/app"
	"prumo/internal/events"
	"prumo/internal/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

// Ícone do app (gerado de assets/brand/prumo-icon.svg): janela no Linux e "Sobre" no macOS. O wails build também
// gera daqui os ícones de pacote de cada sistema.
//
//go:embed build/appicon.png
var appIcon []byte

func main() {
	// --project <pasta>: esta janela foi aberta por outra para um projeto (cada janela é um processo).
	core, err := app.New(context.Background(), app.Options{AllowedOrigins: app.WailsOrigins, InitialProject: windows.ProjectArg(os.Args[1:])})
	if err != nil {
		log.Fatal(err)
	}
	// Todos os serviços que a UI chama (os mesmos do modo dev): um serviço novo não fica de fora do app.
	services := core.Services()
	names := make([]string, 0, len(services))
	for name := range services {
		names = append(names, name)
	}
	sort.Strings(names)
	bind := make([]any, 0, len(names))
	for _, name := range names {
		bind = append(bind, services[name])
	}

	err = wails.Run(&options.App{
		Title:            "Prumo",
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
			core.SetTitle = func(title string) { wruntime.WindowSetTitle(ctx, title) }
			// Outra janela pediu esta para a frente (o projeto já está aberto aqui). "Sempre no topo" por um
			// instante vence a proteção contra roubo de foco de alguns gerenciadores de janela.
			core.FocusWindow = func() {
				wruntime.WindowUnminimise(ctx)
				wruntime.WindowShow(ctx)
				wruntime.WindowSetAlwaysOnTop(ctx, true)
				time.AfterFunc(400*time.Millisecond, func() { wruntime.WindowSetAlwaysOnTop(ctx, false) })
			}
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
		Linux:      &linux.Options{Icon: appIcon, ProgramName: "prumo"},
		Mac:        &mac.Options{About: &mac.AboutInfo{Title: "Prumo", Message: "A desktop IDE for Go, built from open parts", Icon: appIcon}},
	})
	if err != nil {
		log.Fatal(err)
	}
}
