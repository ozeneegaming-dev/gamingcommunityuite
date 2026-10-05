"use client";

import { cx, GcsButton } from "@gcs/ui";
import { useRef, useState } from "react";
import { saveDatabase, testDatabaseConnection } from "../actions";
import { InstallField, InstallStepForm } from "./InstallStepForm";

type Props = {
  initial: { mode: "included" | "external"; host: string; port: string; user: string; database: string };
  included: { host: string; port: string; user: string; database: string } | null;
  labels: Record<
    "group" | "included" | "includedHint" | "external" | "externalHint" | "host" | "port" | "user" | "password" | "name" | "test" | "back" | "continue",
    string
  >;
};

/** Pasul „Baza de date” (macheta Install): PostgreSQL inclus sau extern, cu „Testează conexiunea”. */
export function DatabaseStep({ initial, included, labels }: Props) {
  const [mode, setMode] = useState(initial.mode);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  async function runTest() {
    const form = formRef.current?.closest("form");
    if (!form) return;
    setTesting(true);
    setTest(await testDatabaseConnection(new FormData(form)));
    setTesting(false);
  }

  const external = mode === "external";
  const values = external ? initial : { ...initial, ...(included ?? {}) };

  return (
    <InstallStepForm
      action={saveDatabase}
      backHref="/install/checks"
      labels={{ back: labels.back, continue: labels.continue }}
      extra={
        <GcsButton variant="ghost" type="button" onClick={runTest} disabled={testing}>
          {labels.test}
        </GcsButton>
      }
    >
      <div ref={formRef} role="radiogroup" aria-label={labels.group} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {(["included", "external"] as const).map((m) => (
          <label key={m} className={cx("gcs-option", mode === m && "gcs-option--active")}>
            <input
              type="radio"
              name="mode"
              value={m}
              checked={mode === m}
              onChange={() => {
                setMode(m);
                setTest(null);
              }}
              style={{ marginTop: 3, accentColor: "var(--gcs-accent)", width: 18, height: 18 }}
            />
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{labels[m]}</span>
              <span style={{ fontSize: 13, color: "var(--gcs-muted)" }}>{labels[`${m}Hint`]}</span>
            </span>
          </label>
        ))}
      </div>
      <div key={mode} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, opacity: external ? 1 : 0.55 }}>
        <InstallField name="host" label={labels.host} defaultValue={values.host} disabled={!external} />
        <InstallField name="port" label={labels.port} defaultValue={values.port} disabled={!external} />
        <InstallField name="user" label={labels.user} defaultValue={values.user} disabled={!external} />
        <InstallField name="password" label={labels.password} type="password" disabled={!external} autoComplete="new-password" />
        <InstallField name="database" label={labels.name} defaultValue={values.database} disabled={!external} span />
      </div>
      {test && (
        <p
          role={test.ok ? "status" : "alert"}
          style={{
            margin: 0,
            padding: "12px 16px",
            borderRadius: 12,
            fontSize: 13,
            fontWeight: 600,
            background: test.ok ? "rgba(61,220,151,.08)" : "rgba(255,77,87,.08)",
            border: `1px solid ${test.ok ? "rgba(61,220,151,.3)" : "rgba(255,77,87,.3)"}`,
            color: test.ok ? "var(--gcs-ok)" : "#FF8A91",
          }}
        >
          {test.ok ? "✓ " : "✗ "}
          {test.message}
        </p>
      )}
    </InstallStepForm>
  );
}
