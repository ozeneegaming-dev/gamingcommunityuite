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
};

type Props = {
  fields: GcsSettingsField[];
  action: (fd: FormData) => Promise<GcsResult<null>>;
  labels: { save: string; saved: string; secretSet: string; secretEmpty: string; on: string };
};

/**
 * Formularul unei secțiuni de setări, generat din definițiile modulelor (spec §5): `string` → input,
 * `number` → input numeric, `boolean` → comutator, `secret` → parolă care arată „••••” și se suprascrie
 * doar când e completată, opțiuni → listă.
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
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }} noValidate>
      {fields.map((f) => {
        const name = `setting:${f.key}`;
        const error = errors[f.key];
        if (f.type === "boolean") {
          return (
            <div key={f.key} id={f.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, minHeight: 44 }}>
                <input
                  type="checkbox"
                  role="switch"
                  name={name}
                  defaultChecked={f.value === true}
                  style={{ width: 20, height: 20, accentColor: "var(--gcs-accent)" }}
                />
                <span style={{ fontWeight: 600 }}>{f.label}</span>
              </label>
              {error && (
                <p className="gcs-field__error" role="alert">
                  {error}
                </p>
              )}
            </div>
          );
        }
        const props = error ? { error } : {};
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
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
