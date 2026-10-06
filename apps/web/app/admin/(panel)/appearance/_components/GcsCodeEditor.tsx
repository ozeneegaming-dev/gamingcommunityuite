"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { GcsCodeCompletions, GcsCodeEditorHandle, GcsCodeLanguage } from "./codemirror";

export type GcsCodeEditorApi = Pick<GcsCodeEditorHandle, "insert" | "openSearch" | "focus">;

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  language: GcsCodeLanguage;
  label: string;
  loadingLabel: string;
  completions?: GcsCodeCompletions;
  /** Eroarea de evidențiat (rândul și coloana, de la 1), sau `null`. */
  error?: { line: number; column: number; message: string } | null;
  ref?: Ref<GcsCodeEditorApi>;
  testId?: string;
};

/**
 * Editorul de cod din ACP (CSS și șabloane): CodeMirror 6 încărcat leneș (doar pe paginile editorului), cu evidențiere,
 * numerele rândurilor, căutare (Ctrl+F), salvare cu Ctrl+S, autocompletare și eroarea marcată pe rând. Până se
 * încarcă, arată conținutul ca text (doar citire).
 */
export function GcsCodeEditor({ value, onChange, onSave, language, label, loadingLabel, completions, error = null, ref, testId = "gcs-code-editor" }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<GcsCodeEditorHandle | null>(null);
  const [ready, setReady] = useState(false);
  // Callback-urile curente, fără să recreăm editorul la fiecare randare.
  const handlers = useRef({ onChange, onSave });
  handlers.current = { onChange, onSave };
  const initial = useRef({ value, language, label, completions });

  useEffect(() => {
    let cancelled = false;
    void import("./codemirror").then(({ createCodeEditor }) => {
      if (cancelled || !host.current) return;
      const { value: v, language: lang, label: l, completions: c } = initial.current;
      editor.current = createCodeEditor(host.current, {
        value: v,
        language: lang,
        label: l,
        ...(c ? { completions: c } : {}),
        onChange: (next) => handlers.current.onChange(next),
        onSave: () => handlers.current.onSave(),
      });
      setReady(true);
    });
    return () => {
      cancelled = true;
      editor.current?.destroy();
      editor.current = null;
    };
  }, []);

  // Valoarea venită din afară (restaurare, revenire la original): editorul se aliniază.
  useEffect(() => {
    editor.current?.setValue(value);
  }, [value, ready]);

  useEffect(() => {
    editor.current?.setError(error);
  }, [error, ready]);

  useImperativeHandle(ref, () => ({
    insert: (text) => editor.current?.insert(text),
    openSearch: () => editor.current?.openSearch(),
    focus: () => editor.current?.focus(),
  }));

  return (
    <div className="gcs-codeEditor" data-testid={testId} data-ready={ready ? "1" : "0"}>
      <div ref={host} className="gcs-codeEditor__host" />
      {!ready && (
        <pre className="gcs-codeEditor__fallback" aria-label={loadingLabel}>
          {value}
        </pre>
      )}
    </div>
  );
}
