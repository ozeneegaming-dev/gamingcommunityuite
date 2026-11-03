"use client";

import { useTranslations } from "next-intl";
import { useRef } from "react";
import type { GcsForumGroup } from "./forum-groups";

/**
 * Bifele forumurilor, grupate pe categorie, cu „Toate” pe fiecare grup (și pentru toată lista). `name` = numele
 * câmpului trimis (câte o valoare pe forum bifat).
 */
export function GcsForumChecks({ name, groups, selected, legend, hint, testId }: { name: string; groups: GcsForumGroup[]; selected: number[]; legend: string; hint?: string; testId?: string }) {
  const t = useTranslations("acp.forumChecks");
  const root = useRef<HTMLFieldSetElement>(null);
  const set = new Set(selected);
  const toggle = (scope: HTMLElement | null, on: boolean) => {
    for (const box of scope?.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`) ?? []) box.checked = on;
  };
  return (
    <fieldset ref={root} className="gcs-formSec gcs-forumChecks" data-testid={testId}>
      <legend>{legend}</legend>
      {hint && <p className="gcs-field__hint gcs-forumChecks__hint">{hint}</p>}
      <div className="gcs-forumChecks__tools">
        <button type="button" className="gcs-linkBtn" onClick={() => toggle(root.current, true)}>
          {t("all")}
        </button>
        <button type="button" className="gcs-linkBtn" onClick={() => toggle(root.current, false)}>
          {t("none")}
        </button>
      </div>
      {groups.map((g, i) => (
        <div key={i} className="gcs-forumChecks__group" role="group" aria-label={g.category ?? t("noCategory")}>
          <div className="gcs-forumChecks__head">
            <strong>{g.category ?? t("noCategory")}</strong>
            <button type="button" className="gcs-linkBtn" onClick={(e) => toggle(e.currentTarget.closest<HTMLElement>(".gcs-forumChecks__group"), true)}>
              {t("groupAll")}
            </button>
          </div>
          <div className="gcs-forumChecks__list">
            {g.forums.map((f) => (
              <label key={f.id} className="gcs-check">
                <input type="checkbox" name={name} value={f.id} defaultChecked={set.has(f.id)} />
                {f.name}
              </label>
            ))}
          </div>
        </div>
      ))}
    </fieldset>
  );
}
