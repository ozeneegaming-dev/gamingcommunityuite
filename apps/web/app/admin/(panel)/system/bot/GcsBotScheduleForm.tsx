"use client";

import type { GcsResult } from "@gcs/core";
import { GCS_RICH_FIELDS } from "@gcs/core/rich-fields";
import { useId, useState } from "react";
import { GcsRichTextInput } from "@/app/(site)/_components/editor/GcsRichTextInput";
import { GcsActionForm } from "../../_components/GcsActionForm";

type Labels = { forum: string; title: string; content: string; publishAt: string; lock: string; pin: string; submit: string };

/**
 * Postarea programată a botului: forumul, titlul, conținutul (editorul complet, fără video), data în ora browserului
 * (diferența față de UTC merge cu formularul) și închis / fixat la publicare.
 */
export function GcsBotScheduleForm({ forums, labels, action }: { forums: { id: number; name: string }[]; labels: Labels; action: (fd: FormData) => Promise<GcsResult<unknown>> }) {
  const uid = useId();
  const [offset] = useState(() => (typeof window === "undefined" ? 0 : new Date().getTimezoneOffset()));
  return (
    <GcsActionForm action={action} submitLabel={labels.submit} submitKind="create">
      <label className="gcs-field">
        <span>{labels.forum}</span>
        <select className="gcs-input" name="forumId" required data-testid="gcs-bot-schedule-forum">
          {forums.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <label className="gcs-field">
        <span>{labels.title}</span>
        <input className="gcs-input" name="title" required minLength={3} maxLength={150} data-testid="gcs-bot-schedule-title" />
      </label>
      <div className="gcs-field">
        <span id={`${uid}-content`}>{labels.content}</span>
        <div data-testid="gcs-bot-schedule-content">
          <GcsRichTextInput name="content" initial="" allow={GCS_RICH_FIELDS.signature} maxLength={20_000} imageUrl labelledBy={`${uid}-content`} />
        </div>
      </div>
      <label className="gcs-field">
        <span>{labels.publishAt}</span>
        <input className="gcs-input" type="datetime-local" name="publishAt" required data-testid="gcs-bot-schedule-at" />
      </label>
      <input type="hidden" name="tzOffset" value={offset} />
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        <label className="gcs-check">
          <input type="checkbox" name="pin" /> {labels.pin}
        </label>
        <label className="gcs-check">
          <input type="checkbox" name="lock" /> {labels.lock}
        </label>
      </div>
    </GcsActionForm>
  );
}
