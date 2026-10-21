import { readFileSync, existsSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Modo dev: o backend roda em `go run ./cmd/devserver` e grava o token em .dev-token.
// A UI fala com ele por /bridge (proxy), igual fala com a ponte local dentro do app.
const tokenFile = process.env.GOIDE_TOKEN_FILE ?? '.dev-token'
const devToken = existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : ''
const devserver = process.env.GOIDE_DEVSERVER ?? 'http://127.0.0.1:7788'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Monaco por arquivo (ver scripts/gen-monaco-entry.mjs); o mapa de exports do pacote não cobre o CSS.
    alias: [{ find: /^monaco-esm\//, replacement: fileURLToPath(new URL('./node_modules/monaco-editor/esm/', import.meta.url)) }],
  },
  // O Monaco é ESM puro e grande: pré-empacotar quebra o worker e não ganha nada.
  optimizeDeps: { exclude: ['monaco-editor'] },
  define: {
    __DEV_TOKEN__: JSON.stringify(devToken),
  },
  server: {
    port: Number(process.env.GOIDE_VITE_PORT ?? 5173),
    strictPort: true,
    fs: { allow: ['..'] }, // tokens em ../replica/design
    proxy: {
      '/bridge': {
        target: devserver,
        ws: true,
        rewrite: (p) => p.replace(/^\/bridge/, ''),
        // O token é lido a cada requisição: o devserver pode subir depois do Vite (e2e) ou reiniciar.
        configure: (proxy) => {
          const inject = (req: { setHeader: (k: string, v: string) => void }) => {
            const tok = existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : ''
            if (tok) req.setHeader('X-Goide-Token', tok)
          }
          proxy.on('proxyReq', inject)
          proxy.on('proxyReqWs', inject)
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 6000, // o Monaco é grande e vai embutido no app desktop
  },
})
