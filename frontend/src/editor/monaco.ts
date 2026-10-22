// Monaco configurado para a IDE: worker do editor, temas a partir dos tokens e atalhos.
import * as monaco from './monaco-core'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import tokens from '../../design/tokens.json'

declare global {
  interface Window {
    MonacoEnvironment?: { getWorker: (id: string, label: string) => Worker }
  }
}
// Só o worker genérico: as linguagens com serviço próprio (TS, JSON...) não são carregadas.
window.MonacoEnvironment = { getWorker: () => new EditorWorker() }

type Palette = (typeof tokens.color)['dark']
const strip = (hex: string) => hex.replace('#', '')

function theme(base: 'vs' | 'vs-dark', c: Palette): monaco.editor.IStandaloneThemeData {
  return {
    base,
    inherit: true,
    rules: [
      { token: '', foreground: strip(c.text) },
      { token: 'keyword', foreground: strip(c['syntax-keyword']) },
      { token: 'type', foreground: strip(c['syntax-type']) },
      { token: 'type.identifier', foreground: strip(c['syntax-type']) },
      { token: 'string', foreground: strip(c['syntax-string']) },
      { token: 'string.escape', foreground: strip(c['syntax-constant']) },
      { token: 'number', foreground: strip(c['syntax-number']) },
      { token: 'comment', foreground: strip(c['syntax-comment']), fontStyle: 'italic' },
      { token: 'delimiter', foreground: strip(c['text-muted']) },
      { token: 'operator', foreground: strip(c['text-muted']) },
      // tokens semânticos do gopls
      { token: 'function', foreground: strip(c['syntax-function']) },
      { token: 'method', foreground: strip(c['syntax-function']) },
      { token: 'parameter', foreground: strip(c['syntax-param']) },
      { token: 'property', foreground: strip(c['syntax-field']) },
      { token: 'variable.readonly', foreground: strip(c['syntax-constant']) },
      { token: 'namespace', foreground: strip(c['text-muted']) },
      { token: 'typeParameter', foreground: strip(c['syntax-type']) },
      { token: 'interface', foreground: strip(c['syntax-type']) },
      { token: 'struct', foreground: strip(c['syntax-type']) },
    ],
    colors: {
      'editor.background': c.bg,
      'editor.foreground': c.text,
      'editorLineNumber.foreground': c['text-subtle'],
      'editorLineNumber.activeForeground': c['text-muted'],
      'editorCursor.foreground': c.text,
      'editor.selectionBackground': c.selection,
      'editor.inactiveSelectionBackground': c['selection-inactive'],
      'editor.lineHighlightBackground': c.hover + '80',
      'editor.lineHighlightBorder': '#00000000',
      'editor.findMatchHighlightBackground': c['search-match-bg'],
      'editor.findMatchBackground': c['search-match-bg'],
      'editor.wordHighlightBackground': c['selection-inactive'],
      'editor.wordHighlightStrongBackground': c['selection-inactive'],
      'editorGutter.background': c.bg,
      'editorGutter.addedBackground': c['vcs-added'],
      'editorGutter.modifiedBackground': c['vcs-modified'],
      'editorGutter.deletedBackground': c['vcs-deleted'],
      'editorError.foreground': c.danger,
      'editorWarning.foreground': c.warning,
      'editorInfo.foreground': c['accent-text'],
      'editorWidget.background': c['surface-raised'],
      'editorWidget.border': c.border,
      'editorWidget.foreground': c.text,
      'editorHoverWidget.background': c['surface-raised'],
      'editorHoverWidget.border': c.border,
      'editorSuggestWidget.background': c['surface-raised'],
      'editorSuggestWidget.border': c.border,
      'editorSuggestWidget.selectedBackground': c.selection,
      'editorSuggestWidget.highlightForeground': c['accent-text'],
      'editorSuggestWidget.focusHighlightForeground': c['accent-text'],
      'editorInlayHint.background': c.hover,
      'editorInlayHint.foreground': c['text-subtle'],
      'editorIndentGuide.background1': c.border,
      'editorIndentGuide.activeBackground1': c['border-strong'],
      'editorBracketMatch.background': c['selection-inactive'],
      'editorBracketMatch.border': c['border-strong'],
      'scrollbarSlider.background': c['border-strong'] + '99',
      'scrollbarSlider.hoverBackground': c['border-strong'],
      'scrollbarSlider.activeBackground': c['text-subtle'],
      'editorOverviewRuler.border': c.border,
      'diffEditor.insertedLineBackground': c['diff-added-bg'],
      'diffEditor.removedLineBackground': c['diff-deleted-bg'],
      'diffEditor.insertedTextBackground': c['vcs-added'] + '55',
      'diffEditor.removedTextBackground': c.danger + '44',
      'focusBorder': c.focus,
      'input.background': c.bg,
      'input.border': c['border-input'],
      'list.activeSelectionBackground': c.selection,
      'list.activeSelectionForeground': c.text,
      'list.hoverBackground': c.hover,
      'list.hoverForeground': c.text,
      // Menu do botão direito no editor: sem estas cores ele ficava transparente, com o texto escuro sobre o código.
      'menu.background': c['surface-raised'],
      'menu.foreground': c.text,
      'menu.border': c.border,
      'menu.selectionBackground': c.selection,
      'menu.selectionForeground': c.text,
      'menu.separatorBackground': c.border,
      'widget.shadow': '#00000066',
    },
  }
}

monaco.editor.defineTheme('prumo-dark', theme('vs-dark', tokens.color.dark))
monaco.editor.defineTheme('prumo-light', theme('vs', tokens.color.light))

/** Aplica o tema da IDE no Monaco. */
export function setMonacoTheme(mode: 'dark' | 'light') {
  monaco.editor.setTheme(mode === 'dark' ? 'prumo-dark' : 'prumo-light')
}

// Atalhos de editor no estilo das IDEs desktop. Os comandos são os do próprio Monaco.
const { KeyMod: M, KeyCode: K } = monaco
monaco.editor.addKeybindingRules([
  { keybinding: M.Alt | K.Enter, command: 'editor.action.quickFix', when: 'editorTextFocus' },
  { keybinding: M.Shift | K.F6, command: 'editor.action.rename', when: 'editorTextFocus' },
  { keybinding: M.CtrlCmd | K.KeyB, command: 'editor.action.revealDefinition', when: 'editorTextFocus' },
  // Alt+F7 (usos) e Ctrl+U (super) são da IDE (lib/keymap): abrem a janela de usos e saltam para a interface.
  // F7/Shift+F7 no diff são da IDE (DiffView); os do Monaco (leitor acessível) quebram antes de o diff existir.
  { keybinding: K.F7, command: '-editor.action.accessibleDiffViewer.next' },
  { keybinding: M.Shift | K.F7, command: '-editor.action.accessibleDiffViewer.prev' },
  { keybinding: M.CtrlCmd | M.Alt | K.KeyL, command: 'editor.action.formatDocument', when: 'editorTextFocus' },
  // Popups sem sair do arquivo: usos (Ctrl+Alt+F7) e definição (Ctrl+Shift+I), os "peek" do Monaco.
  { keybinding: M.CtrlCmd | M.Alt | K.F7, command: 'editor.action.referenceSearch.trigger', when: 'editorTextFocus' },
  { keybinding: M.CtrlCmd | M.Shift | K.KeyI, command: 'editor.action.peekDefinition', when: 'editorTextFocus' },
  // Ctrl+Q é da IDE (lib/keymap): balão de documentação e, apertando de novo, a janela Documentação.
  { keybinding: M.CtrlCmd | K.KeyP, command: 'editor.action.triggerParameterHints', when: 'editorTextFocus' },
  { keybinding: M.CtrlCmd | K.KeyD, command: 'editor.action.copyLinesDownAction', when: 'editorTextFocus' },
  { keybinding: M.CtrlCmd | K.KeyY, command: 'editor.action.deleteLines', when: 'editorTextFocus' },
  { keybinding: M.CtrlCmd | K.Slash, command: 'editor.action.commentLine', when: 'editorTextFocus' },
  // Mover a linha (ou as linhas selecionadas): Shift+Alt+↑/↓ e Ctrl+Shift+↑/↓. Alt+↑/↓ do Monaco continua.
  // No Linux o Monaco usa Shift+Alt+↑/↓ para cursor extra; aqui isso fica com Ctrl+Alt+↑/↓.
  { keybinding: M.Shift | M.Alt | K.UpArrow, command: '-editor.action.insertCursorAbove' },
  { keybinding: M.Shift | M.Alt | K.DownArrow, command: '-editor.action.insertCursorBelow' },
  { keybinding: M.Shift | M.Alt | K.UpArrow, command: 'editor.action.moveLinesUpAction', when: 'editorTextFocus && !editorReadonly' },
  { keybinding: M.Shift | M.Alt | K.DownArrow, command: 'editor.action.moveLinesDownAction', when: 'editorTextFocus && !editorReadonly' },
  { keybinding: M.CtrlCmd | M.Shift | K.UpArrow, command: 'editor.action.moveLinesUpAction', when: 'editorTextFocus && !editorReadonly' },
  { keybinding: M.CtrlCmd | M.Shift | K.DownArrow, command: 'editor.action.moveLinesDownAction', when: 'editorTextFocus && !editorReadonly' },
  // Vários cursores: Alt+J marca a próxima ocorrência (Ctrl+D é duplicar), Shift+Alt+J desfaz a última,
  // Ctrl+Alt+Shift+J marca todas; Ctrl+Alt+↑/↓ põe um cursor na linha de cima/baixo (Alt+clique também).
  { keybinding: M.Alt | K.KeyJ, command: 'editor.action.addSelectionToNextFindMatch', when: 'editorFocus' },
  { keybinding: M.Shift | M.Alt | K.KeyJ, command: 'cursorUndo', when: 'editorTextFocus' },
  { keybinding: M.CtrlCmd | M.Alt | M.Shift | K.KeyJ, command: 'editor.action.selectHighlights', when: 'editorFocus' },
  { keybinding: M.CtrlCmd | M.Alt | K.UpArrow, command: 'editor.action.insertCursorAbove', when: 'editorTextFocus' },
  { keybinding: M.CtrlCmd | M.Alt | K.DownArrow, command: 'editor.action.insertCursorBelow', when: 'editorTextFocus' },
])

export { monaco }
