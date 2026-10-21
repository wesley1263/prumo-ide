// Tela de abertura (o #splash do index.html): some com um fade quando o app está pronto. Fica no mínimo um
// instante, para não ser só um piscar quando tudo carrega rápido.
const MIN_MS = 600
let gone = false

/** Esconde a tela de abertura (chamar quando o backend respondeu, com sucesso ou erro). */
export function hideSplash() {
  if (gone) return
  gone = true
  const el = document.getElementById('splash')
  if (!el) return
  const wait = Math.max(0, MIN_MS - performance.now())
  setTimeout(() => {
    el.classList.add('out')
    // Sem transição (movimento reduzido) o transitionend não vem: o timeout garante a saída.
    const remove = () => el.remove()
    el.addEventListener('transitionend', remove, { once: true })
    setTimeout(remove, 500)
  }, wait)
}

/** Rótulo para leitor de tela, no idioma da interface. */
export function labelSplash(text: string) {
  document.getElementById('splash')?.setAttribute('aria-label', text)
}
