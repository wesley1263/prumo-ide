// Abre um link no navegador do sistema (no app, pelo runtime do Wails; no modo dev, numa aba nova).
// Só http(s): nada de file:, javascript: ou esquemas de outros programas.
export function openUrl(url: string) {
  if (!/^https?:\/\//i.test(url)) return
  const rt = (window as unknown as { runtime?: { BrowserOpenURL?: (u: string) => void } }).runtime
  if (rt?.BrowserOpenURL) rt.BrowserOpenURL(url)
  else window.open(url, '_blank', 'noopener')
}
