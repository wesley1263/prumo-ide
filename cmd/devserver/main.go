// Command devserver roda o backend sem janela, para a UI rodar no navegador via Vite.
//
//	go run ./cmd/devserver            # porta 7788, token em frontend/.dev-token
//	cd frontend && npm run dev        # http://localhost:5173
//
// Usa uma pasta de dados separada (goide-dev) para não misturar com o app instalado.
package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"goide/internal/app"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:7788", "endereço da ponte (só loopback)")
	tokenFile := flag.String("token-file", "frontend/.dev-token", "onde gravar o token para o Vite")
	dataDir := flag.String("data", "", "pasta de dados (padrão: <config>/goide-dev)")
	origins := flag.String("origins", "http://localhost:5173,http://127.0.0.1:5173", "Origins da UI aceitas, separadas por vírgula")
	flag.Parse()

	if *dataDir == "" {
		base, err := os.UserConfigDir()
		if err != nil {
			log.Fatal(err)
		}
		*dataDir = filepath.Join(base, app.Name+"-dev")
	}
	ctx := context.Background()
	core, err := app.New(ctx, app.Options{
		DataDir:        *dataDir,
		BridgeAddr:     *addr,
		AllowedOrigins: strings.Split(*origins, ","),
		Dev:            true,
	})
	if err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile(*tokenFile, []byte(core.Bridge.Token()), 0o600); err != nil {
		log.Fatalf("gravar token: %v", err)
	}
	log.Printf("devserver em http://%s (dados em %s)", *addr, *dataDir)

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	log.Print("encerrando")
	app.Shutdown(core)
}
