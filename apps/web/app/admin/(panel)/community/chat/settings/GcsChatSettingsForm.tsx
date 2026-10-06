"use client";

import { faFloppyDisk } from "@fortawesome/free-solid-svg-icons";
import type { GcsResult } from "@gcs/core";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent, type ReactNode } from "react";

type Base = { key: string; label: string; hint?: string };
/** Un rând al formularului: eticheta în stânga, controlul în dreapta, explicația dedesubt (ca în referință). */
export type GcsChatSettingRow =
  | { kind: "section"; title: string }
  | (Base & { kind: "switch"; value: boolean; name?: string; disabled?: boolean })
  | (Base & { kind: "select"; value: string; options: { value: string; label: string }[]; required?: string })
  | (Base & {
      kind: "number";
      value: number;
      min: number;
      max: number;
      step?: number;
      name?: string;
      unit?: string;
      /** „sau [ ] Nelimitat”: bifat → valoarea 0 (câmpul numeric se dezactivează). */
      none?: { or: string; label: string; fallback: number };
    })
  | (Base & { kind: "text"; value: string; multiline?: boolean; maxLength?: number })
  | (Base & { kind: "secret"; set: boolean; placeholderSet: string });

type Props = {
  rows: GcsChatSettingRow[];
  action: (fd: FormData) => Promise<GcsResult<null>>;
  labels: { save: string; saved: string };
  /** Câmpuri ascunse în plus (ex. marcajul că aplicația se poate comuta). */
  hidden?: Record<string, string>;
  children?: ReactNode;
};

/**
 * Formularul unui tab din ACP → Chat → Setări: comutatoare (nu bife), liste, numere cu „sau Nelimitat / Niciunul”,
 * text și secrete. Câmpurile se numesc `setting:<cheie>` (ca formularul generic de setări), deci salvarea folosește
 * `saveSettingDefs`; erorile vin pe câmpuri.
 */
export function GcsChatSettingsForm({ rows, action, labels, hidden, children }: Props) {
  const router = useRouter();
  const tErr = useTranslations("errors");
  const id = useId();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  // „Nelimitat” / „Niciunul” bifat pe câmpurile numerice care au opțiunea.
  const [none, setNone] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(rows.flatMap((r) => (r.kind === "number" && r.none ? [[r.key, r.value === 0]] : []))),
  );

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setPending(true);
    setStatus(null);
    const result = await action(new FormData(form));
    setPending(false);
    if (!result.ok) {
      setErrors(Object.fromEntries(Object.entries(result.error.fields ?? {}).map(([k, code]) => [k, tErr.has(`fields.${code}`) ? tErr(`fields.${code}`) : code])));
      const reason = result.error.params?.reason;
      setStatus({ ok: false, text: reason && tErr.has(`reasons.${reason}`) ? tErr(`reasons.${reason}`) : tErr(result.error.code) });
      return;
    }
    setErrors({});
    setStatus({ ok: true, text: labels.saved });
    form.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((i) => (i.value = ""));
    router.refresh();
  }

  const fieldId = (key: string) => `${id}-${key.replace(/[^a-z0-9_-]/gi, "_")}`;

  const control = (r: Exclude<GcsChatSettingRow, { kind: "section" }>, fid: string, described: string | undefined): ReactNode => {
    const aria = { id: fid, "aria-describedby": described, "aria-invalid": errors[r.key] ? true : undefined };
    switch (r.kind) {
      case "switch":
        return <input type="checkbox" role="switch" className="gcs-chat__switch" name={r.name ?? `setting:${r.key}`} defaultChecked={r.value} disabled={r.disabled} {...aria} />;
      case "select":
        return (
          <select className="gcs-input" name={`setting:${r.key}`} defaultValue={r.value} required={r.required !== undefined} {...aria}>
            {r.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      case "number": {
        const off = r.none ? none[r.key] === true : false;
        return (
          <span className="gcs-chatAcp__inline">
            <input
              className="gcs-input gcs-chatAcp__number"
              type="number"
              inputMode="numeric"
              name={r.name ?? `setting:${r.key}`}
              min={r.min}
              max={r.max}
              step={r.step ?? 1}
              defaultValue={r.value === 0 && r.none ? r.none.fallback : r.value}
              disabled={off}
              {...aria}
            />
            {r.unit && <span>{r.unit}</span>}
            {r.none && (
              <>
                <span className="gcs-muted">{r.none.or}</span>
                <label className="gcs-chatAcp__check">
                  <input
                    type="checkbox"
                    name={`none:${r.key}`}
                    checked={off}
                    aria-label={`${r.label}: ${r.none.label}`}
                    onChange={(e) => setNone((s) => ({ ...s, [r.key]: e.target.checked }))}
                  />
                  <span aria-hidden="true">{r.none.label}</span>
                </label>
              </>
            )}
          </span>
        );
      }
      case "text":
        return r.multiline ? (
          <textarea className="gcs-input" name={`setting:${r.key}`} rows={6} defaultValue={r.value} maxLength={r.maxLength} {...aria} />
        ) : (
          <input className="gcs-input" name={`setting:${r.key}`} defaultValue={r.value} maxLength={r.maxLength} {...aria} />
        );
      case "secret":
        return <input className="gcs-input" type="password" autoComplete="new-password" name={`setting:${r.key}`} placeholder={r.set ? r.placeholderSet : ""} {...aria} />;
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate>
      {hidden && Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      {rows.map((r, i) => {
        if (r.kind === "section") {
          return (
            <h3 key={`section-${i}`} className="gcs-chatAcp__section">
              {r.title}
            </h3>
          );
        }
        const fid = fieldId(r.key);
        const error = errors[r.key];
        const hintId = r.hint ? `${fid}-hint` : undefined;
        const errorId = error ? `${fid}-error` : undefined;
        const described = [hintId, errorId].filter(Boolean).join(" ") || undefined;
        return (
          <div key={r.key} className={`gcs-chatAcp__row${r.kind === "switch" ? " gcs-chatAcp__row--switch" : ""}`} id={r.key}>
            <label className="gcs-chatAcp__label" htmlFor={fid}>
              {r.label}
              {r.kind === "select" && r.required && (
                <>
                  <br />
                  <small className="gcs-chatAcp__required">{r.required}</small>
                </>
              )}
            </label>
            <div className="gcs-chatAcp__control">
              <div>{control(r, fid, described)}</div>
              {r.hint && (
                <p id={hintId} className="gcs-chatAcp__hint">
                  {r.hint}
                </p>
              )}
              {error && (
                <p id={errorId} className="gcs-chatAcp__error" role="alert">
                  {error}
                </p>
              )}
            </div>
          </div>
        );
      })}
      {children}
      <div className="gcs-chatAcp__footer">
        <GcsButton variant="primary" type="submit" disabled={pending} icon={<GcsIconSvg icon={faFloppyDisk} />}>
          {labels.save}
        </GcsButton>
        {status && (
          <span role={status.ok ? "status" : "alert"} className={status.ok ? "gcs-chatAcp__saved" : "gcs-chatAcp__error"}>
            {status.text}
          </span>
        )}
      </div>
    </form>
  );
}
