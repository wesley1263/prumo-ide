// Paleta fechada: só existem as classes dos tokens (replica/design/tokens.json).
/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('../replica/design/tailwind.preset.js')],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
}
