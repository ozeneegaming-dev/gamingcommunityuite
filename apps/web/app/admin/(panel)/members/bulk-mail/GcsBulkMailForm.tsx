"use client";

import { GCS_RICH_FIELDS } from "@gcs/core/rich-fields";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { GcsRichTextInput } from "@/app/(site)/_components/editor/GcsRichTextInput";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { countBulkAudience, saveBulkMail } from "./actions";

export type GcsBulkMailFormValue = { id: number | null; subject: string; body: unknown; groupIds: number[]; primaryOnly: boolean; activeDays: number | null };

/**
 * Ciorna unui email în masă: subiectul, mesajul (editorul anunțurilor, cu `{name}` și `{site}`), apoi publicul (grupuri,
 * doar grupul principal, activi recent) cu numărul destinatarilor calculat pe loc.
 */
export function GcsBulkMailForm({ value, groups }: { value: GcsBulkMailFormValue; groups: { id: number; name: string }[] }) {
  const t = useTranslations("acp.bulkMail");
  const uid = useId();
  const form = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState<number | null>(null);

  const recount = useCallback(async () => {
    const root = form.current?.closest("form");
    if (!root) return;
    const fd = new FormData(root);
    const days = String(fd.get("activeDays") ?? "").trim();
    const result = await countBulkAudience({
      groupIds: fd.getAll("groupId").map(Number).filter((n) => Number.isInteger(n) && n > 0),
      primaryOnly: fd.get("primaryOnly") === "on",
      activeDays: days === "" || !/^\d+$/.test(days) || Number(days) <= 0 ? null : Number(days),
    });
    setCount(result.ok ? result.data : null);
  }, []);

  useEffect(() => {
    void recount();
  }, [recount]);

  return (
    <GcsActionForm action={saveBulkMail.bind(null, value.id)} submitLabel={value.id ? t("save") : t("create")} submitKind={value.id ? "save" : "create"}>
      <div ref={form} style={{ display: "contents" }}>
        <fieldset className="gcs-formSec">
          <legend>{t("secMessage")}</legend>
          <label className="gcs-field">
            {t("subject")}
            <input className="gcs-input" name="subject" required minLength={3} maxLength={150} defaultValue={value.subject} data-testid="gcs-bulk-subject" />
          </label>
          <div className="gcs-field">
            <span id={`${uid}-body`}>{t("body")}</span>
            <div data-testid="gcs-bulk-body">
              <GcsRichTextInput name="body" initial={value.body ?? ""} allow={GCS_RICH_FIELDS.announcement} maxLength={20_000} imageUrl labelledBy={`${uid}-body`} />
            </div>
            <span className="gcs-field__hint">{t("bodyHint")}</span>
          </div>
        </fieldset>
        <fieldset className="gcs-formSec" onChange={() => void recount()}>
          <legend>{t("secAudience")}</legend>
          <p className="gcs-field__hint" style={{ margin: 0 }}>
            {t("groupsHint")}
          </p>
          <div className="gcs-forumChecks__list">
            {groups.map((g) => (
              <label key={g.id} className="gcs-check">
                <input type="checkbox" name="groupId" value={g.id} defaultChecked={value.groupIds.includes(g.id)} />
                {g.name}
              </label>
            ))}
          </div>
          <label className="gcs-toggleRow">
            <span>{t("primaryOnly")}</span>
            <input type="checkbox" name="primaryOnly" defaultChecked={value.primaryOnly} />
          </label>
          <label className="gcs-field">
            {t("activeDays")}
            <input className="gcs-input" name="activeDays" type="number" min={1} max={3650} defaultValue={value.activeDays ?? ""} placeholder={t("activeAny")} />
          </label>
          <p className="gcs-bulkCount" role="status" data-testid="gcs-bulk-count">
            {count === null ? t("countLoading") : t("count", { count })}
          </p>
          <p className="gcs-field__hint" style={{ margin: 0 }}>
            {t("excludedHint")}
          </p>
        </fieldset>
      </div>
    </GcsActionForm>
  );
}
