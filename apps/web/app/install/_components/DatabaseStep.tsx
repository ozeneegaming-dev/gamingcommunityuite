"use client";

import { cx, GcsButton } from "@gcs/ui";
import { useRef, useState } from "react";
import { saveDatabase, testDatabaseConnection } from "../actions";
import { InstallField, InstallStepForm } from "./InstallStepForm";

type Engine = "mysql" | "postgresql";

type Props = {
  initial: { mode: "included" | "external"; engine: Engine; host: string; port: string; user: string; database: string };
  included: { host: string; port: string; user: string; database: string } | null;
  /** Ediția Lite: baza e mereu creată în panoul gazdei (fără varianta „inclusă”), MySQL / MariaDB sau PostgreSQL. */
  lite: boolean;
  labels: Record<
    | "group"
    | "included"
    | "includedHint"
    | "external"
    | "externalHint"
    | "engineGroup"
    | "mysql"
    | "mysqlHint"
    | "postgresql"
    | "postgresqlHint"
    | "host"
    | "port"
    | "user"
    | "password"
    | "name"
    | "test"
    | "back"
    | "continue",
    string
  >;
};

const DEFAULT_PORT: Record<Engine, string> = { mysql: "3306", postgresql: "5432" };

function Option<T extends string>({ name, value, current, onSelect, label, hint }: { name: string; value: T; current: T; onSelect: (v: T) => void; label: string; hint: string }) {
  return (
    <label className={cx("gcs-option", current === value && "gcs-option--active")}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={current === value}
        onChange={() => onSelect(value)}
        style={{ marginTop: 3, accentColor: "var(--gcs-accent)", width: 18, height: 18 }}
      />
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>{label}</span>
        <span style={{ fontSize: 13, color: "var(--gcs-muted)" }}>{hint}</span>
      </span>
    </label>
  );
}

/** Pasul „Baza de date” (macheta Install): PostgreSQL inclus sau extern (VPS), MySQL sau PostgreSQL (Lite), cu „Testează conexiunea”. */
export function DatabaseStep({ initial, included, lite, labels }: Props) {
  const [mode, setMode] = useState(lite ? "external" : initial.mode);
  const [engine, setEngine] = useState<Engine>(lite ? initial.engine : "postgresql");
  const [port, setPort] = useState(initial.port || DEFAULT_PORT[initial.engine]);
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
      backHref="/install/apps"
      labels={{ back: labels.back, continue: labels.continue }}
      extra={
        <GcsButton variant="ghost" type="button" onClick={runTest} disabled={testing}>
          {labels.test}
        </GcsButton>
      }
    >
      <div ref={formRef} role="radiogroup" aria-label={lite ? labels.engineGroup : labels.group} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {lite ? (
          <>
            <input type="hidden" name="mode" value="external" />
            {(["mysql", "postgresql"] as const).map((e) => (
              <Option
                key={e}
                name="engine"
                value={e}
                current={engine}
                onSelect={(next) => {
                  // Portul urmează motorul, cât timp e cel implicit (nu unul scris de admin).
                  if (port === DEFAULT_PORT[engine]) setPort(DEFAULT_PORT[next]);
                  setEngine(next);
                  setTest(null);
                }}
                label={labels[e]}
                hint={labels[`${e}Hint`]}
              />
            ))}
          </>
        ) : (
          (["included", "external"] as const).map((m) => (
            <Option
              key={m}
              name="mode"
              value={m}
              current={mode}
              onSelect={(next) => {
                setMode(next);
                setTest(null);
              }}
              label={labels[m]}
              hint={labels[`${m}Hint`]}
            />
          ))
        )}
      </div>
      <div key={mode} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, opacity: external ? 1 : 0.55 }}>
        <InstallField name="host" label={labels.host} defaultValue={values.host} disabled={!external} />
        {external ? (
          <InstallField name="port" label={labels.port} value={port} onChange={(e) => setPort(e.currentTarget.value)} />
        ) : (
          <InstallField name="port" label={labels.port} defaultValue={values.port} disabled />
        )}
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
