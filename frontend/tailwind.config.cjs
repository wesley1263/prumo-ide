// Paleta fechada: só existem as classes dos tokens (design/tokens.json).
/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('./design/tailwind.preset.js')],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
}
