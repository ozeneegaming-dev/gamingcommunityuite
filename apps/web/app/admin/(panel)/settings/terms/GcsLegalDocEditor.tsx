"use client";

import { faFloppyDisk } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsField, GcsIconSvg } from "@gcs/ui";
import { GcsEditor, type GcsEditorHandle } from "@gcs/ui/editor";
import type { JSONContent } from "@tiptap/core";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { useEditorLabels } from "../../../../(site)/_components/topic/useEditorLabels";
import { saveLegalDoc } from "./actions";

type Mode = "none" | "page" | "external";

/**
 * Un document legal în ACP (termenii sau confidențialitatea): modul (niciunul, pagina de pe site, adresă externă),
 * adresa externă și textul scris cu editorul postărilor. Editorul rămâne montat (ascuns) când modul nu e „pagină”, ca
 * textul să nu se piardă la o schimbare de mod.
 */
export function GcsLegalDocEditor({
  kind,
  initial,
  labels,
}: {
  kind: "terms" | "privacy";
  initial: { mode: Mode; url: string; doc: JSONContent | null };
  labels: { mode: string; modes: Record<Mode, string>; url: string; urlHint: string; content: string; save: string; saved: string };
}) {
  const editorLabels = useEditorLabels();
  const editor = useRef<GcsEditorHandle>(null);
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const id = useId();
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [url, setUrl] = useState(initial.url);
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const save = () =>
    start(async () => {
      const content = editor.current?.isEmpty() ? null : (editor.current?.getJSON() ?? null);
      const res = await saveLegalDoc({ kind, mode, url, content });
      setStatus(res.ok ? { ok: true, text: labels.saved } : { ok: false, text: errorMessage(res.error) });
      if (res.ok) router.refresh();
    });

  return (
    <div className="gcs-settingsForm" data-testid={`gcs-legal-${kind}`}>
      <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: "8px 18px" }}>
        <legend className="gcs-field__label" style={{ marginBottom: 6 }}>
          {labels.mode}
        </legend>
        {(["none", "page", "external"] as const).map((m) => (
          <label key={m} className="gcs-checkRow">
            <input type="radio" name={`${id}-mode`} value={m} checked={mode === m} onChange={() => setMode(m)} data-testid={`gcs-legal-${kind}-mode-${m}`} />
            {labels.modes[m]}
          </label>
        ))}
      </fieldset>
      {mode === "external" && (
        <GcsField label={labels.url} hint={labels.urlHint}>
          <input type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" maxLength={500} data-testid={`gcs-legal-${kind}-url`} />
        </GcsField>
      )}
      <div hidden={mode !== "page"} style={{ display: mode === "page" ? "flex" : "none", flexDirection: "column", gap: 8 }}>
        <span className="gcs-field__label">{labels.content}</span>
        <GcsEditor ref={editor} id={`gcs-legal-${kind}-editor`} labels={editorLabels} forumId={0} initialContent={initial.doc} />
      </div>
      <div>
        <GcsButton variant="primary" icon={<GcsIconSvg icon={faFloppyDisk} />} disabled={pending} onClick={save} data-testid={`gcs-legal-${kind}-save`}>
          {labels.save}
        </GcsButton>
      </div>
      {status && (
        <p role={status.ok ? "status" : "alert"} className={status.ok ? "gcs-notice" : "gcs-notice gcs-notice--error"} style={{ margin: 0 }}>
          {status.text}
        </p>
      )}
    </div>
  );
}
