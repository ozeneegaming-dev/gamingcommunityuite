"use client";

import type { GcsResult } from "@gcs/core";
import { GCS_RICH_FIELDS } from "@gcs/core/rich-fields";
import { useEffect, useId, useRef, useState } from "react";
import { GcsRichTextInput } from "@/app/(site)/_components/editor/GcsRichTextInput";
import { GcsActionForm } from "../../_components/GcsActionForm";
import type { GcsForumGroup } from "../../_components/forum-groups";

type Labels = { forum: string; title: string; content: string; publishAt: string; lock: string; pin: string; submit: string; noCategory: string; secPost: string; secWhen: string };

/** O postare programată existentă (la editare): data e ISO (UTC), afișată în ora browserului. */
export type GcsBotScheduleInitial = { forumId: number; title: string; content: unknown; publishAt: string; lock: boolean; pin: boolean };

/** `YYYY-MM-DDTHH:mm` în ora locală a browserului, pentru `datetime-local`. */
function localValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Postarea programată a botului: forumul (grupat pe categorii), titlul, conținutul (editorul complet, fără video), data
 * în ora browserului (diferența față de UTC merge cu formularul) și închis / fixat la publicare. Cu `initial`, formularul
 * editează o postare încă nepublicată.
 */
export function GcsBotScheduleForm({
  groups,
  labels,
  action,
  initial,
}: {
  groups: GcsForumGroup[];
  labels: Labels;
  action: (fd: FormData) => Promise<GcsResult<unknown>>;
  initial?: GcsBotScheduleInitial;
}) {
  const uid = useId();
  const [offset] = useState(() => (typeof window === "undefined" ? 0 : new Date().getTimezoneOffset()));
  const when = useRef<HTMLInputElement>(null);
  // Data existentă se pune după montare: pe server nu se știe ora browserului.
  useEffect(() => {
    if (initial && when.current && !when.current.value) when.current.value = localValue(initial.publishAt);
  }, [initial]);
  return (
    <GcsActionForm action={action} submitLabel={labels.submit} submitKind={initial ? "save" : "create"}>
      <fieldset className="gcs-formSec">
        <legend>{labels.secPost}</legend>
        <label className="gcs-field">
          <span>{labels.forum}</span>
          <select className="gcs-input" name="forumId" required defaultValue={initial ? String(initial.forumId) : undefined} data-testid="gcs-bot-schedule-forum">
            {groups.map((g, i) => (
              <optgroup key={i} label={g.category ?? labels.noCategory}>
                {g.forums.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="gcs-field">
          <span>{labels.title}</span>
          <input className="gcs-input" name="title" required minLength={3} maxLength={150} defaultValue={initial?.title ?? ""} data-testid="gcs-bot-schedule-title" />
        </label>
        <div className="gcs-field">
          <span id={`${uid}-content`}>{labels.content}</span>
          <div data-testid="gcs-bot-schedule-content">
            <GcsRichTextInput name="content" initial={initial?.content ?? ""} allow={GCS_RICH_FIELDS.signature} maxLength={20_000} imageUrl labelledBy={`${uid}-content`} />
          </div>
        </div>
      </fieldset>
      <fieldset className="gcs-formSec">
        <legend>{labels.secWhen}</legend>
        <label className="gcs-field">
          <span>{labels.publishAt}</span>
          <input ref={when} className="gcs-input" type="datetime-local" name="publishAt" required data-testid="gcs-bot-schedule-at" />
        </label>
        <input type="hidden" name="tzOffset" value={offset} />
        <label className="gcs-toggleRow">
          <span>{labels.pin}</span>
          <input type="checkbox" name="pin" defaultChecked={initial?.pin ?? false} />
        </label>
        <label className="gcs-toggleRow">
          <span>{labels.lock}</span>
          <input type="checkbox" name="lock" defaultChecked={initial?.lock ?? false} />
        </label>
      </fieldset>
    </GcsActionForm>
  );
}
