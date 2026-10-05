import { runChecks, type GcsInstallStep } from "@gcs/core";
import { GcsButton } from "@gcs/ui";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { gcsConfigDir } from "@/lib/config";
import { hasInstallSession, includedConnection, installState, isWizardStep, stepIndex, stepPath } from "@/lib/install";
import { continueFromChecks, saveAdmin, saveData, saveEmail, saveSite, submitInstallCode } from "../actions";
import { DatabaseStep } from "../_components/DatabaseStep";
import { InstallField, InstallStepForm } from "../_components/InstallStepForm";
import { InstallShell } from "../_components/InstallShell";

export const dynamic = "force-dynamic";

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback);

/** Un pas al wizard-ului de instalare (spec §17.1). Nu se poate sări peste pași; progresul se reia după refresh. */
export default async function InstallStepPage({ params }: { params: Promise<{ step: string }> }) {
  const { step } = await params;
  if (!isWizardStep(step) || step === "done") notFound();
  const state = installState();
  const progress = await state.progress();

  if (step !== "code") {
    if (!(await hasInstallSession())) redirect("/install/code");
    // Un pas viitor (nesalvat încă) duce înapoi la pasul curent.
    if (stepIndex(step) > Math.max(stepIndex(progress.step), stepIndex("checks"))) redirect(stepPath(progress.step));
  }

  const t = await getTranslations("install");
  const nav = { back: t("back"), continue: t("continue") };
  const data = progress.data;
  const back = (s: GcsInstallStep) => `/install/${s}`;

  let content: ReactNode;
  switch (step) {
    case "code":
      content = (
        <InstallStepForm action={submitInstallCode} labels={nav}>
          <InstallField name="code" label={t("steps.code.field")} autoComplete="one-time-code" />
        </InstallStepForm>
      );
      break;

    case "checks": {
      const results = await runChecks({
        databaseUrl: process.env.DATABASE_URL,
        redisUrl: process.env.REDIS_URL,
        s3Endpoint: process.env.S3_ENDPOINT,
        configDir: gcsConfigDir(),
      });
      const optional = new Set(["minio", "postgres", "extensions"]);
      content = (
        <>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }} data-testid="gcs-install-checks">
            {results.map((r) => (
              <li key={r.id} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 14px", borderRadius: 12, background: "var(--gcs-surface2)", border: "1px solid var(--gcs-border)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
                  <span style={{ color: r.ok ? "var(--gcs-ok)" : "#FF4D57", fontWeight: 800, width: 16 }} aria-hidden="true">
                    {r.ok ? "✓" : "✗"}
                  </span>
                  <span style={{ fontWeight: 600 }}>{t(`checks.${r.id}`)}</span>
                  <span style={{ marginLeft: "auto", color: "var(--gcs-muted)", fontSize: 12, textAlign: "right" }}>
                    {r.detail}
                    {!r.ok && optional.has(r.id) ? ` · ${t("steps.checks.optional")}` : ""}
                  </span>
                </span>
                {!r.ok && r.fixKey && <span style={{ fontSize: 12.5, color: "var(--gcs-muted)", paddingLeft: 26 }}>{t(`fix.${r.id}`)}</span>}
              </li>
            ))}
          </ul>
          <InstallStepForm
            action={continueFromChecks}
            backHref={back("code")}
            labels={nav}
            extra={
              <GcsButton variant="ghost" asChild>
                <Link href="/install/checks">{t("steps.checks.retry")}</Link>
              </GcsButton>
            }
          />
        </>
      );
      break;
    }

    case "database": {
      const db = data.database ?? {};
      const inc = includedConnection();
      content = (
        <DatabaseStep
          initial={{
            mode: db.mode === "external" ? "external" : "included",
            host: str(db.host, "localhost"),
            port: str(db.port, "5432"),
            user: str(db.user, "redline"),
            database: str(db.database, "redline"),
          }}
          included={inc ? { host: inc.host, port: String(inc.port), user: inc.user, database: inc.database } : null}
          labels={{
            group: t("steps.database.group"),
            included: t("steps.database.included"),
            includedHint: t("steps.database.includedHint"),
            external: t("steps.database.external"),
            externalHint: t("steps.database.externalHint"),
            host: t("steps.database.host"),
            port: t("steps.database.port"),
            user: t("steps.database.user"),
            password: t("steps.database.password"),
            name: t("steps.database.name"),
            test: t("steps.database.test"),
            ...nav,
          }}
        />
      );
      break;
    }

    case "site": {
      const site = data.site ?? {};
      const tc = await getTranslations("settings.choices");
      content = (
        <InstallStepForm action={saveSite} backHref={back("database")} labels={nav}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
            <InstallField name="name" label={t("steps.site.name")} defaultValue={str(site.name, "RED-LINE")} span />
            <InstallField name="url" label={t("steps.site.url")} type="url" defaultValue={str(site.url, process.env.GCS_BASE_URL ?? "")} span />
            <InstallField name="locale" label={t("steps.site.locale")} defaultValue={str(site.locale, "ro")} options={[{ value: "ro", label: tc("ro") }, { value: "en", label: tc("en") }]} />
            <InstallField name="timezone" label={t("steps.site.timezone")} defaultValue={str(site.timezone, "Europe/Bucharest")} />
          </div>
        </InstallStepForm>
      );
      break;
    }

    case "email": {
      const email = data.email ?? {};
      content = (
        <InstallStepForm action={saveEmail} backHref={back("site")} labels={nav}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
            <InstallField name="host" label={t("steps.email.host")} defaultValue={str(email.host)} />
            <InstallField name="port" label={t("steps.email.port")} defaultValue={str(email.port, "587")} />
            <InstallField name="user" label={t("steps.email.user")} defaultValue={str(email.user)} autoComplete="off" />
            <InstallField name="pass" label={t("steps.email.pass")} type="password" autoComplete="new-password" />
            <InstallField name="from" label={t("steps.email.from")} type="email" defaultValue={str(email.from)} span />
          </div>
        </InstallStepForm>
      );
      break;
    }

    case "admin": {
      const admin = data.admin ?? {};
      content = (
        <InstallStepForm action={saveAdmin} backHref={back("email")} labels={nav}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
            <InstallField name="name" label={t("steps.admin.name")} defaultValue={str(admin.name)} autoComplete="username" />
            <InstallField name="email" label={t("steps.admin.email")} type="email" defaultValue={str(admin.email)} autoComplete="email" />
            <InstallField name="password" label={t("steps.admin.password")} type="password" autoComplete="new-password" />
            <InstallField name="confirm" label={t("steps.admin.confirm")} type="password" autoComplete="new-password" />
          </div>
        </InstallStepForm>
      );
      break;
    }

    case "data": {
      const kind = str(data.data?.kind, "demo");
      content = (
        <InstallStepForm action={saveData} backHref={back("admin")} labels={nav}>
          <div role="radiogroup" aria-label={t("steps.data.group")} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {(["demo", "empty", "import"] as const).map((k) => (
              <label key={k} className="gcs-option" style={k === "import" ? { opacity: 0.55, cursor: "not-allowed" } : undefined}>
                <input
                  type="radio"
                  name="kind"
                  value={k}
                  defaultChecked={kind === k}
                  disabled={k === "import"}
                  style={{ marginTop: 3, accentColor: "var(--gcs-accent)", width: 18, height: 18 }}
                />
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{t(`steps.data.${k}`)}</span>
                  <span style={{ fontSize: 13, color: "var(--gcs-muted)" }}>{t(`steps.data.${k}Hint`)}</span>
                </span>
              </label>
            ))}
          </div>
        </InstallStepForm>
      );
      break;
    }

    case "run":
      redirect(stepPath("run"));
  }

  return <InstallShell step={step}>{content}</InstallShell>;
}
