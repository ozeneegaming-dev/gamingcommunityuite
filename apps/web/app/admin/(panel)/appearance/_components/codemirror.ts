/**
 * Editorul de cod (CodeMirror 6) al ACP → Aspect → CSS / Șabloane. Modulul se încarcă doar dinamic, din
 * `GcsCodeEditor` (`import()`), deci nu intră în bundle-ul celorlalte pagini.
 */
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type Completion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { liquid } from "@codemirror/lang-liquid";
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { highlightSelectionMatches, openSearchPanel, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export type GcsCodeLanguage = "css" | "liquid";

export type GcsCodeCompletions = {
  /** Căile variabilelor (`forum.name`, `forum.last.user.url`…), cu descrierea lor. */
  variables: { name: string; detail: string }[];
  tags: string[];
  filters: string[];
};

export type GcsCodeEditorHandle = {
  setValue(value: string): void;
  insert(text: string): void;
  setError(error: { line: number; column: number; message: string } | null): void;
  openSearch(): void;
  focus(): void;
  destroy(): void;
};

/** Culorile sintaxei, din tokenurile ACP (merg în ambele teme). */
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword], color: "var(--gcs-acp-c2)" },
  { tag: [t.tagName, t.angleBracket], color: "var(--gcs-acp-c6)" },
  { tag: [t.attributeName, t.propertyName], color: "var(--gcs-acp-c3)" },
  { tag: [t.string, t.attributeValue, t.special(t.string)], color: "var(--gcs-acp-c1)" },
  { tag: [t.number, t.bool, t.null, t.unit, t.atom, t.color], color: "var(--gcs-acp-c4)" },
  { tag: [t.variableName, t.definition(t.variableName)], color: "var(--gcs-text)" },
  { tag: [t.function(t.variableName), t.className, t.labelName], color: "var(--gcs-acp-c5)" },
  { tag: [t.comment, t.blockComment, t.lineComment], color: "var(--gcs-muted)", fontStyle: "italic" },
  { tag: [t.brace, t.bracket, t.paren, t.punctuation, t.separator], color: "var(--gcs-muted)" },
  { tag: t.invalid, color: "var(--gcs-acp-bad)" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--gcs-bg)", color: "var(--gcs-text)", fontSize: "13px" },
  ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", lineHeight: "1.55" },
  ".cm-content": { caretColor: "var(--gcs-text)" },
  ".cm-gutters": { backgroundColor: "var(--gcs-surface)", color: "var(--gcs-muted)", borderRight: "1px solid var(--gcs-border)" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--gcs-surface2) 60%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--gcs-surface2)", color: "var(--gcs-text)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "color-mix(in srgb, var(--gcs-acp-c3) 35%, transparent)" },
  ".cm-cursor": { borderLeftColor: "var(--gcs-text)" },
  ".cm-panels": { backgroundColor: "var(--gcs-surface)", color: "var(--gcs-text)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--gcs-border)" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--gcs-acp-c4) 35%, transparent)" },
  ".cm-tooltip": { backgroundColor: "var(--gcs-surface)", border: "1px solid var(--gcs-border)", color: "var(--gcs-text)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--gcs-surface2)", color: "var(--gcs-text)" },
  ".cm-foldGutter span": { color: "var(--gcs-muted)" },
});

/** Completările de proprietăți: copiii unei căi (`forum.last.` → `topicTitle`, `topicUrl`, `at`, `user`). */
function propertySource(variables: GcsCodeCompletions["variables"]) {
  return (path: readonly string[]): Completion[] => {
    const prefix = path.join(".");
    const seen = new Map<string, Completion>();
    for (const v of variables) {
      if (!v.name.startsWith(`${prefix}.`)) continue;
      const rest = v.name.slice(prefix.length + 1);
      const head = rest.split(".")[0]!;
      if (!seen.has(head)) seen.set(head, { label: head, type: "property", detail: rest.includes(".") ? "" : v.detail });
    }
    return [...seen.values()];
  };
}

export function createCodeEditor(
  parent: HTMLElement,
  opts: { value: string; language: GcsCodeLanguage; label: string; completions?: GcsCodeCompletions; onChange(value: string): void; onSave(): void },
): GcsCodeEditorHandle {
  const language: Extension =
    opts.language === "css"
      ? css()
      : liquid({
          variables: [...new Set((opts.completions?.variables ?? []).map((v) => v.name.split(".")[0]!))].map((label) => ({ label, type: "variable" })),
          properties: propertySource(opts.completions?.variables ?? []),
          tags: (opts.completions?.tags ?? []).map((label) => ({ label, type: "keyword" })),
          filters: (opts.completions?.filters ?? []).map((label) => ({ label, type: "function" })),
        });
  let silent = false;
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: opts.value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        indentOnInput(),
        syntaxHighlighting(highlight),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        lintGutter(),
        language,
        theme,
        EditorView.contentAttributes.of({ "aria-label": opts.label, "data-testid": "gcs-code-input" }),
        keymap.of([
          { key: "Mod-s", preventDefault: true, run: () => (opts.onSave(), true) },
          indentWithTab,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !silent) opts.onChange(u.state.doc.toString());
        }),
      ],
    }),
  });

  return {
    setValue(value) {
      if (value === view.state.doc.toString()) return;
      silent = true;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
      silent = false;
    },
    insert(text) {
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      view.focus();
    },
    setError(error) {
      if (!error) {
        view.dispatch(setDiagnostics(view.state, []));
        return;
      }
      const lineNo = Math.min(Math.max(1, error.line), view.state.doc.lines);
      const line = view.state.doc.line(lineNo);
      const from = Math.min(line.from + Math.max(0, error.column - 1), line.to);
      const diagnostic: Diagnostic = { from, to: Math.max(from, line.to), severity: "error", message: error.message };
      view.dispatch({ ...setDiagnostics(view.state, [diagnostic]), selection: { anchor: from }, scrollIntoView: true });
    },
    openSearch() {
      openSearchPanel(view);
    },
    focus() {
      view.focus();
    },
    destroy() {
      view.destroy();
    },
  };
}
