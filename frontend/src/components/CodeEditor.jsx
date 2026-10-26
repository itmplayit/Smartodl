import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { LANGS, STARTER } from '../utils/constants';
import { useTheme } from '../context/ThemeContext';
import { initMonaco, monacoThemeFor } from '../utils/monacoSetup';

initMonaco();

/**
 * Code editor backed by Monaco (the VS Code engine), bundled locally.
 *
 * Drop-in replacement for the previous textarea editor — the prop contract is
 * unchanged (language, code, onLanguage, onCode, height, readOnly, actions,
 * languages, starter) so ProblemDetail and QuizAttempt need no edits.
 *
 * Two arena behaviours depend on this component and are deliberately preserved:
 *   1. Admin copy-paste block — ProblemDetail listens for copy/cut/paste/drop
 *      on `document`. Monaco's hidden textarea lets those events bubble, so we
 *      must never call stopPropagation here.
 *   2. AI typing analytics — the typed-vs-pasted ratio is derived from
 *      `onCode` deltas against counted keystrokes, so every content change has
 *      to be emitted exactly once.
 */
export default function CodeEditor({
  language = 'python', code = '', onLanguage, onCode, height, readOnly = false, actions,
  languages, starter, onPaste,
}) {
  const { theme } = useTheme();
  // `languages` restricts the picker (used by coding quiz questions) and `starter`
  // supplies the per-question template instead of the platform default.
  const options = useMemo(
    () => (Array.isArray(languages) && languages.length ? LANGS.filter((l) => languages.includes(l.slug)) : LANGS),
    [languages],
  );
  const templateFor = (slug) => (starter && starter[slug]) || STARTER[slug] || '';
  const knownTemplates = useMemo(
    () => new Set(Object.values(STARTER).concat(Object.values(starter || {}))),
    [starter],
  );
  const monacoLang = useMemo(
    () => (LANGS.find((l) => l.slug === language) || {}).mode || 'plaintext',
    [language],
  );

  const editorRef = useRef(null);
  const [value, setValue] = useState(code);
  const [cursor, setCursor] = useState({ ln: 1, col: 1 });
  const [ready, setReady] = useState(false);
  // The value we emitted to the parent, so the sync effect does not overwrite it.
  const lastEmitted = useRef(code);

  // Accept new `code` from the parent only when something else changed it
  // (Reset or a language template). Echoes of our own typing never move the cursor.
  useEffect(() => {
    if (code !== lastEmitted.current) {
      lastEmitted.current = code;
      setValue(code);
    }
  }, [code]);

  const emit = useCallback((next) => {
    const text = next ?? '';
    lastEmitted.current = text;
    setValue(text);
    onCode && onCode(text);
  }, [onCode]);

  // keep the latest onPaste without re-mounting the editor
  const onPasteRef = useRef(onPaste);
  useEffect(() => { onPasteRef.current = onPaste; }, [onPaste]);

  const handleMount = useCallback((editor) => {
    editorRef.current = editor;
    setReady(true);
    editor.onDidChangeCursorPosition((e) => {
      setCursor({ ln: e.position.lineNumber, col: e.position.column });
    });
    // Ground truth for the AI-use analytics. Monaco fires this only for a real
    // paste, so auto-closed brackets, auto-indent and accepted completions are
    // never mistaken for pasted code — inferring paste from
    // "characters appeared without enough keystrokes" flagged fast typists.
    editor.onDidPaste((e) => {
      if (!onPasteRef.current) return;
      const model = editor.getModel();
      const text = model ? model.getValueInRange(e.range) : '';
      if (text) onPasteRef.current(text.length, text);
    });
  }, []);

  const lineCount = value.split('\n').length;

  return (
    <div className="editor-wrap">
      <div className="editor-bar">
        <select
          className="select"
          aria-label="Programming language"
          style={{ width: 150, padding: '6px 10px' }}
          value={language}
          onChange={(e) => {
            const lang = e.target.value;
            onLanguage && onLanguage(lang);
            if (!value.trim() || knownTemplates.has(value)) emit(templateFor(lang));
          }}
        >
          {options.map((l) => (
            <option key={l.slug} value={l.slug}>{l.name} ({l.version})</option>
          ))}
        </select>
        <span className="tiny muted">Tab = 4 spaces • auto-indent</span>
        <div style={{ flex: 1 }} />
        {actions}
      </div>

      <div className="editor editor-monaco" style={height ? { height } : undefined}>
        <Editor
          language={monacoLang}
          theme={monacoThemeFor(theme)}
          value={value}
          onChange={emit}
          onMount={handleMount}
          loading={<span className="tiny muted" style={{ padding: 12 }}>Loading editor…</span>}
          options={{
            readOnly,
            fontFamily: 'var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
            fontSize: 13.5,
            lineHeight: 1.6,
            tabSize: 4,
            insertSpaces: true,
            detectIndentation: false,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            renderLineHighlight: 'line',
            roundedSelection: false,
            padding: { top: 12, bottom: 12 },
            // With the minimap off the overview ruler just leaves stray marks
            // against the right edge — drop it and reclaim the gutter.
            overviewRulerLanes: 0,
            overviewRulerBorder: false,
            hideCursorInOverviewRuler: true,
            renderWhitespace: 'selection',
            lineNumbersMinChars: 3,
            glyphMargin: false,
            folding: true,
            foldingHighlight: false,
            matchBrackets: 'always',
            autoClosingBrackets: 'languageDefined',
            autoClosingQuotes: 'languageDefined',
            autoSurround: 'languageDefined',
            scrollbar: {
              verticalScrollbarSize: 10,
              horizontalScrollbarSize: 10,
              useShadows: false,
              alwaysConsumeMouseWheel: false,
            },
            bracketPairColorization: { enabled: true },
            guides: { indentation: true, bracketPairs: false },
            suggestOnTriggerCharacters: true,
            quickSuggestions: { other: true, comments: false, strings: false },
            wordBasedSuggestions: 'currentDocument',
            fixedOverflowWidgets: true,
            contextmenu: false,
            // The arena grades stdin/stdout programs; a stray trailing newline
            // must never change a verdict, so keep the buffer exactly as typed.
            trimAutoWhitespace: false,
          }}
        />
      </div>

      <div className="editor-status">
        <span>{ready ? 'Saved' : 'Loading…'}</span>
        <span>Ln {cursor.ln}, Col {cursor.col} • {lineCount} lines</span>
      </div>
    </div>
  );
}
