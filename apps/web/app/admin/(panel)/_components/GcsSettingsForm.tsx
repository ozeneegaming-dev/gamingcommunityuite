"use client";

import type { GcsResult } from "@gcs/core";
import { GcsButton, GcsField } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

export type GcsSettingsField = {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "json" | "secret";
  value: unknown;
  /** Pentru secrete: dacă există deja o valoare salvată (valoarea nu ajunge niciodată în browser). */
  secretSet?: boolean;
  options?: { value: string; label: string }[];
  /** Text pe mai multe rânduri (ex. regulile chat-ului). */
  multiline?: boolean;
};

type Props = {
  fields: GcsSettingsField[];
  action: (fd: FormData) => Promise<GcsResult<null>>;
  labels: { save: string; saved: string; secretSet: string; secretEmpty: string; on: string };
};

/**
 * Formularul unei secțiuni de setări, generat din definițiile modulelor (spec §5): `string` → input,
 * `number` → input numeric, `boolean` → comutator, `secret` → parolă care arată „••••” și se suprascrie
 * doar când e completată, opțiuni → listă. Fiecare câmp e un rând (etapa 6 §1.1): eticheta la stânga, controlul la
 * dreapta, ajutorul dedesubt.
 */
export function GcsSettingsForm({ fields, action, labels }: Props) {
  const router = useRouter();
  const tErr = useTranslations("errors");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setPending(true);
    setStatus(null);
    const result = await action(new FormData(form));
    setPending(false);
    if (!result.ok) {
      const fieldErrors = Object.fromEntries(
        Object.entries(result.error.fields ?? {}).map(([k, code]) => [k, tErr.has(`fields.${code}`) ? tErr(`fields.${code}`) : code]),
      );
      setErrors(fieldErrors);
      const reason = result.error.params?.reason;
      setStatus({ ok: false, text: reason && tErr.has(`reasons.${reason}`) ? tErr(`reasons.${reason}`) : tErr(result.error.code) });
      return;
    }
    setErrors({});
    setStatus({ ok: true, text: labels.saved });
    // Secretele salvate nu se mai afișează: golim câmpurile de parolă.
    form.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((i) => (i.value = ""));
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="gcs-acpForm" noValidate>
      {fields.map((f) => {
        const name = `setting:${f.key}`;
        const error = errors[f.key];
        if (f.type === "boolean") {
          const id = `gcs-setting-${f.key}`;
          return (
            <div key={f.key} id={f.key} className="gcs-field gcs-field--row gcs-field--switch">
              <label className="gcs-field__label" htmlFor={id}>
                {f.label}
              </label>
              <input
                id={id}
                type="checkbox"
                role="switch"
                className="gcs-switch"
                name={name}
                defaultChecked={f.value === true}
                {...(error ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {})}
              />
              {error && (
                <p id={`${id}-error`} className="gcs-field__error" role="alert">
                  {error}
                </p>
              )}
            </div>
          );
        }
        const props = { className: "gcs-field--row", ...(error ? { error } : {}) };
        return (
          <div key={f.key} id={f.key}>
            {f.options ? (
              <GcsField label={f.label} {...props}>
                <select name={name} defaultValue={String(f.value ?? "")}>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </GcsField>
            ) : f.type === "secret" ? (
              <GcsField label={f.label} hint={f.secretSet ? labels.secretSet : labels.secretEmpty} {...props}>
                <input name={name} type="password" autoComplete="new-password" placeholder={f.secretSet ? "••••••••" : ""} />
              </GcsField>
            ) : f.multiline ? (
              <GcsField label={f.label} {...props}>
                <textarea name={name} rows={6} defaultValue={String(f.value ?? "")} />
              </GcsField>
            ) : f.type === "json" ? (
              <GcsField label={f.label} {...props}>
                <textarea name={name} defaultValue={JSON.stringify(f.value, null, 2)} />
              </GcsField>
            ) : (
              <GcsField label={f.label} {...props}>
                <input name={name} type={f.type === "number" ? "number" : "text"} defaultValue={String(f.value ?? "")} />
              </GcsField>
            )}
          </div>
        );
      })}
      <div className="gcs-acpForm__actions">
        <GcsButton variant="primary" type="submit" disabled={pending}>
          {labels.save}
        </GcsButton>
        {status && (
          <span role={status.ok ? "status" : "alert"} style={{ fontSize: 13, fontWeight: 600, color: status.ok ? "var(--gcs-ok)" : "#FF8A91" }}>
            {status.text}
          </span>
        )}
      </div>
    </form>
  );
}
