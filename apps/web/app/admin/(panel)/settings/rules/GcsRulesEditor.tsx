"use client";

import { faFloppyDisk, faTrash } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { GcsEditor, type GcsEditorHandle } from "@gcs/ui/editor";
import type { JSONContent } from "@tiptap/core";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { useEditorLabels } from "../../../../(site)/_components/topic/useEditorLabels";
import { saveCommunityRules } from "./actions";

/**
 * Editorul regulilor comunității: editorul standard al postărilor (fără încărcări și mențiuni), „Salvează” și
 * „Șterge regulile”. Un editor gol la salvare înseamnă tot ștergere.
 */
export function GcsRulesEditor({ initial, labels }: { initial: JSONContent | null; labels: { save: string; clear: string; saved: string; cleared: string; confirmClear: string } }) {
  const editorLabels = useEditorLabels();
  const editor = useRef<GcsEditorHandle>(null);
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const save = (content: JSONContent | null) =>
    start(async () => {
      const res = await saveCommunityRules({ content });
      setStatus(res.ok ? { ok: true, text: content ? labels.saved : labels.cleared } : { ok: false, text: errorMessage(res.error) });
      if (!res.ok) return;
      if (!content) editor.current?.clear();
      router.refresh();
    });
  return (
    <div className="gcs-settingsForm" data-testid="gcs-rules-form">
      <GcsEditor ref={editor} id="gcs-rules-editor" labels={editorLabels} forumId={0} initialContent={initial} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <GcsButton
          variant="primary"
          icon={<GcsIconSvg icon={faFloppyDisk} />}
          disabled={pending}
          onClick={() => save(editor.current?.isEmpty() ? null : (editor.current?.getJSON() ?? null))}
          data-testid="gcs-rules-save"
        >
          {labels.save}
        </GcsButton>
        <GcsButton
          variant="ghost"
          icon={<GcsIconSvg icon={faTrash} />}
          disabled={pending}
          onClick={() => {
            if (window.confirm(labels.confirmClear)) save(null);
          }}
        >
          {labels.clear}
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
