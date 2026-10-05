"use client";

import { GcsButton } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState, type FormEvent, type ReactNode } from "react";
import type { GcsInstallActionResult } from "../actions";

/** Erorile pe câmpuri ale formularului curent (citite de `InstallField`). */
const FieldErrors = createContext<Record<string, string>>({});
export const useInstallFieldError = (name: string) => useContext(FieldErrors)[name];

type Props = {
  action: (fd: FormData) => Promise<GcsInstallActionResult>;
  backHref?: string;
  labels: { back: string; continue: string };
  /** Butoane în plus, lângă „Continuă” (ex. „Testează conexiunea”). */
  extra?: ReactNode;
  children?: ReactNode;
};

/** Formularul unui pas: „Înapoi” / „Continuă”, ca în machetă; la succes merge la pasul următor. */
export function InstallStepForm({ action, backHref, labels, extra, children }: Props) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const result = await action(new FormData(e.currentTarget));
    setPending(false);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    router.push(result.next);
  }

  return (
    <FieldErrors.Provider value={errors}>
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 22 }} noValidate>
        {children}
        {errors._ && (
          <p role="alert" className="gcs-field__error" style={{ fontSize: 13 }}>
            {errors._}
          </p>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", paddingTop: 8, borderTop: "1px solid var(--gcs-border)" }}>
          {backHref ? (
            <GcsButton variant="ghost" type="button" onClick={() => router.push(backHref)}>
              {labels.back}
            </GcsButton>
          ) : (
            <span />
          )}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {extra}
            <GcsButton variant="primary" type="submit" disabled={pending}>
              {labels.continue}
            </GcsButton>
          </div>
        </div>
      </form>
    </FieldErrors.Provider>
  );
}

/** Un câmp al wizard-ului, cu eroarea lui (`.gcs-field` + `.gcs-input`, ca în machetă). */
export function InstallField({
  name,
  label,
  type = "text",
  defaultValue,
  disabled,
  autoComplete,
  span,
  options,
}: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  disabled?: boolean;
  autoComplete?: string;
  span?: boolean;
  options?: { value: string; label: string }[];
}) {
  const error = useInstallFieldError(name);
  const id = `install-${name}`;
  const errorId = `${id}-error`;
  const common = {
    id,
    name,
    className: "gcs-input",
    defaultValue,
    disabled,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? errorId : undefined,
  };
  return (
    <div className="gcs-field" style={span ? { gridColumn: "1 / -1" } : undefined}>
      <label htmlFor={id}>{label}</label>
      {options ? (
        <select {...common}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input {...common} type={type} autoComplete={autoComplete} />
      )}
      {error && (
        <p id={errorId} className="gcs-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
