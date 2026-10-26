/**
 * Monaco (VS Code engine) — slim, locally bundled setup.
 *
 * Two deliberate choices:
 *
 * 1. No CDN. @monaco-editor/react defaults to loading Monaco from jsDelivr;
 *    the arena must keep working offline, behind preview hosts and on
 *    locked-down campus networks, so everything is bundled by Vite instead.
 *
 * 2. No `monaco-editor` barrel import. That entry pulls all ~90 language
 *    definitions plus every editor contribution — it OOMs a small build box
 *    and ships megabytes students never use. We import the core API and then
 *    opt in to exactly the six arena languages and the editor features an
 *    online judge actually needs.
 *
 * Arena languages -> Monaco ids: c, cpp (both from the cpp definition),
 * java, python, javascript, sql. JavaScript uses the lightweight Monarch
 * definition rather than the full TypeScript language service: competitive
 * snippets read stdin via `require('fs')`, which the TS service would flag as
 * phantom errors, and it would drag in a second web worker for no benefit.
 */
import * as monaco from 'monaco-editor/editor/editor.api';
import { loader } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';

/* --- languages (cpp/register registers BOTH `c` and `cpp`) --------------- */
import 'monaco-editor/languages/definitions/cpp/register';
import 'monaco-editor/languages/definitions/java/register';
import 'monaco-editor/languages/definitions/python/register';
import 'monaco-editor/languages/definitions/javascript/register';
import 'monaco-editor/languages/definitions/sql/register';

/* --- editor features (curated; `editor.api` alone has none) -------------- */
import 'monaco-editor/features/bracketMatching/register';
import 'monaco-editor/features/caretOperations/register';
import 'monaco-editor/features/clipboard/register';
import 'monaco-editor/features/codeEditor/register';
import 'monaco-editor/features/comment/register';
import 'monaco-editor/features/cursorUndo/register';
import 'monaco-editor/features/find/register';
import 'monaco-editor/features/folding/register';
import 'monaco-editor/features/hover/register';
import 'monaco-editor/features/inPlaceReplace/register';
import 'monaco-editor/features/indentation/register';
import 'monaco-editor/features/linesOperations/register';
import 'monaco-editor/features/multicursor/register';
import 'monaco-editor/features/smartSelect/register';
import 'monaco-editor/features/snippet/register';
import 'monaco-editor/features/suggest/register';
import 'monaco-editor/features/wordHighlighter/register';
import 'monaco-editor/features/wordOperations/register';

// Only the core worker is needed — no language-service workers are registered.
self.MonacoEnvironment = { getWorker: () => new editorWorker() };

/* ---------------------------------------------------------------------------
 * Themes. Colours track styles.css so the editor never looks bolted on:
 * the dark surface matches `.editor-wrap` (#070b15) and the gutter matches
 * `.editor-gutter` (#0a0f1e).
 * ------------------------------------------------------------------------- */
/* LeetCode's editor is VS Code Dark+ on a #282828 surface. Token colours below
 * are the exact .mtk values read off leetcode.com (mtk1 #d4d4d4 default,
 * mtk3 #6a9955 comment, mtk4 #569cd6 keyword, mtk8 #ce9178 string,
 * mtk10 #4ec9b0 type, mtk11 #dcdcaa function, mtk13 #c586c0 control,
 * mtk14 #9cdcfe variable, mtk7 #b5cea8 number). */
const DARK = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'd4d4d4' },
    { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
    { token: 'keyword', foreground: '569cd6' },
    { token: 'keyword.control', foreground: 'c586c0' },
    { token: 'keyword.operator', foreground: 'd4d4d4' },
    { token: 'number', foreground: 'b5cea8' },
    { token: 'number.hex', foreground: 'b5cea8' },
    { token: 'string', foreground: 'ce9178' },
    { token: 'string.escape', foreground: 'd7ba7d' },
    { token: 'regexp', foreground: 'd16969' },
    { token: 'type', foreground: '4ec9b0' },
    { token: 'type.identifier', foreground: '4ec9b0' },
    { token: 'identifier', foreground: '9cdcfe' },
    { token: 'function', foreground: 'dcdcaa' },
    { token: 'variable', foreground: '9cdcfe' },
    { token: 'variable.predefined', foreground: '4fc1ff' },
    { token: 'constant', foreground: '4fc1ff' },
    { token: 'operator', foreground: 'd4d4d4' },
    { token: 'delimiter', foreground: 'd4d4d4' },
    { token: 'delimiter.bracket', foreground: 'd4d4d4' },
    { token: 'predefined', foreground: '4ec9b0' },
    { token: 'annotation', foreground: 'dcdcaa' },
    { token: 'tag', foreground: '569cd6' },
    { token: 'attribute.name', foreground: '9cdcfe' },
    { token: 'attribute.value', foreground: 'ce9178' },
  ],
  colors: {
    // Surface follows SmartODL's dark theme (styles.css institutional layer) rather than
    // LeetCode's #282828, so the editor sits inside the navy panels cleanly.
    // The syntax token colours stay VS Code Dark+ — they read well on navy.
    'editor.background': '#070f18',
    'editor.foreground': '#d4d4d4',
    'editorLineNumber.foreground': '#5b7183',
    'editorLineNumber.activeForeground': '#b7cad6',
    'editorGutter.background': '#070f18',
    'editor.lineHighlightBackground': '#0f1c27',
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': '#1d4a66',
    'editor.inactiveSelectionBackground': '#3a3d41',
    'editor.selectionHighlightBackground': '#add6ff26',
    'editor.wordHighlightBackground': '#575757b8',
    'editorCursor.foreground': '#aeafad',
    'editorIndentGuide.background1': '#1e3442',
    'editorIndentGuide.activeBackground1': '#365468',
    'editorBracketMatch.background': '#0064001a',
    'editorBracketMatch.border': '#ffc43d',
    'editorBracketHighlight.foreground1': '#ffd700',
    'editorBracketHighlight.foreground2': '#da70d6',
    'editorBracketHighlight.foreground3': '#179fff',
    'editorWhitespace.foreground': '#3b3b3b',
    'editorWidget.background': '#102130',
    'editorWidget.border': '#294454',
    'editorSuggestWidget.background': '#102130',
    'editorSuggestWidget.border': '#294454',
    'editorSuggestWidget.selectedBackground': '#1a3a4f',
    'editorHoverWidget.background': '#102130',
    'editorHoverWidget.border': '#294454',
    'scrollbarSlider.background': '#79797966',
    'scrollbarSlider.hoverBackground': '#646464b3',
    'scrollbarSlider.activeBackground': '#bfbfbf66',
    'editorOverviewRuler.border': '#00000000',
  },
};

const LIGHT = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: '', foreground: '1a2238' },
    { token: 'comment', foreground: '94a3b8', fontStyle: 'italic' },
    { token: 'keyword', foreground: '6d28d9' },
    { token: 'number', foreground: 'b45309' },
    { token: 'string', foreground: '15803d' },
    { token: 'type', foreground: '0369a1' },
    { token: 'function', foreground: '1d4ed8' },
    { token: 'operator', foreground: 'be185d' },
    { token: 'delimiter', foreground: '64748b' },
    { token: 'predefined', foreground: '0e7490' },
  ],
  colors: {
    'editor.background': '#f8fbfc',
    'editor.foreground': '#18303e',
    'editorLineNumber.foreground': '#94a3b8',
    'editorLineNumber.activeForeground': '#475569',
    'editor.lineHighlightBackground': '#f1f5f9',
    'editor.lineHighlightBorder': '#00000000',
    'editorCursor.foreground': '#15803d',
    'editorBracketMatch.background': '#15803d22',
    'editorBracketMatch.border': '#15803d',
  },
};

let registered = false;

/** Register themes once and point @monaco-editor/react at the bundled monaco. */
export function initMonaco() {
  if (registered) return monaco;
  monaco.editor.defineTheme('smartodl-dark', DARK);
  monaco.editor.defineTheme('smartodl-light', LIGHT);
  loader.config({ monaco });
  registered = true;
  return monaco;
}

/** App theme ('light' | 'dark') -> registered Monaco theme name. */
export const monacoThemeFor = (theme) => (theme === 'light' ? 'smartodl-light' : 'smartodl-dark');

export default monaco;
