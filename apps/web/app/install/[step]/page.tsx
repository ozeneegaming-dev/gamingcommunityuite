import { GCS_DEV_LICENSE_TOKEN, gcsEdition, installAppChoices, runChecks, type GcsInstallStep } from "@gcs/core";
import { GcsBadge, GcsButton } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { gcsConfigDir } from "@/lib/config";
import { eulaText, hasInstallSession, includedConnection, installState, isWizardStep, savedLicense, stepIndex, stepPath } from "@/lib/install";
import { services } from "@/lib/services";
import { continueFromChecks, saveAdmin, saveApps, saveData, saveEmail, saveLicense, saveSite, submitInstallCode } from "../actions";
import { DatabaseStep } from "../_components/DatabaseStep";
import { InstallCheck, InstallField, InstallStepForm } from "../_components/InstallStepForm";
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
        edition: gcsEdition(),
      });
      const optional = new Set(["minio", "postgres", "extensions", "database"]);
      content = (
        <>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }} data-testid="gcs-install-checks">
            {results.map((r) => (
              <li key={r.id} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 14px", borderRadius: "var(--gcs-radius-sm)", background: "var(--gcs-surface2)", border: "1px solid var(--gcs-border)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
                  <span style={{ color: r.ok ? "var(--gcs-ok)" : "var(--gcs-danger)", fontWeight: 800, width: 16 }} aria-hidden="true">
                    {r.ok ? "✓" : "✗"}
                  </span>
                  <span style={{ fontWeight: 600 }}>{t(`checks.${r.id}`)}</span>
                  <span style={{ marginLeft: "auto", color: "var(--gcs-muted)", fontSize: 12, textAlign: "right" }}>
                    {r.detail}
                    {!r.ok && optional.has(r.id) ? ` · ${t("steps.checks.optional")}` : ""}
                  </span>
                </span>
                {!r.ok && r.fixKey && <span style={{ fontSize: 12.5, color: "var(--gcs-muted)", paddingLeft: 26 }}>{t(r.fixKey.replace(/^install\./, ""))}</span>}
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

    case "license": {
      const [eula, current] = await Promise.all([eulaText(), savedLicense()]);
      content = (
        <InstallStepForm action={saveLicense} backHref={back("checks")} labels={nav}>
          <InstallField name="token" label={t("steps.license.field")} defaultValue={current?.token ?? ""} autoComplete="off" />
          <p style={{ margin: "-12px 0 0", fontSize: 13, color: "var(--gcs-muted)" }}>
            {current ? t("steps.license.saved", { licensee: current.license.licensee }) : t("steps.license.fieldHint")}
            {process.env.NODE_ENV !== "production" && <> · {t("steps.license.devHint", { token: GCS_DEV_LICENSE_TOKEN })}</>}
          </p>
          <section aria-labelledby="gcs-install-eula" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h2 id="gcs-install-eula" style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
              {t("steps.license.eula")}
            </h2>
            <div
              tabIndex={0}
              data-testid="gcs-install-eula"
              style={{ maxHeight: 220, overflowY: "auto", whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.6, padding: "12px 14px", borderRadius: "var(--gcs-radius-sm)", background: "var(--gcs-surface2)", border: "1px solid var(--gcs-border)", color: "var(--gcs-muted)" }}
            >
              {eula || t("steps.license.eulaMissing")}
            </div>
          </section>
          <InstallCheck name="eula" label={t("steps.license.accept")} defaultChecked={current !== null} />
        </InstallStepForm>
      );
      break;
    }

    case "apps": {
      const current = await savedLicense();
      if (!current) redirect(stepPath("license"));
      const tr = await getTranslations();
      const label = (key: string) => (tr.has(key) ? tr(key) : key);
      const choices = installAppChoices(services().registry, current.license);
      const saved = data.apps ?? {};
      const picked = new Set(Array.isArray(saved.selected) ? (saved.selected as string[]) : choices.filter((c) => c.tier === "standard").map((c) => c.key));
      const landing = str(saved.landing, choices.find((c) => c.locked)?.key ?? "");
      const group = (tier: "standard" | "premium") => (
        <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }} data-testid={`gcs-install-apps-${tier}`}>
          <legend style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--gcs-muted)", marginBottom: 6 }}>{t(`steps.apps.${tier}`)}</legend>
          {choices
            .filter((c) => c.tier === tier)
            .map((c) => (
              <InstallCheck
                key={c.key}
                name="app"
                value={c.key}
                label={label(c.labelKey)}
                defaultChecked={c.locked || (c.available && picked.has(c.key))}
                disabled={c.locked || !c.available}
                badge={
                  c.locked ? (
                    <GcsBadge tone="neutral">{t("steps.apps.locked")}</GcsBadge>
                  ) : c.tier === "premium" ? (
                    <GcsBadge tone={c.available ? "accent" : "neutral"} icon={c.available ? undefined : <GcsIcon name="fa-solid fa-lock" />}>
                      {c.available ? t("steps.apps.premiumBadge") : t("steps.apps.notLicensed")}
                    </GcsBadge>
                  ) : null
                }
                hint={
                  <>
                    {c.descriptionKey ? label(c.descriptionKey) : null}
                    {c.requires.length > 0 && <> · {t("steps.apps.requires", { apps: c.requires.map((r) => label(choices.find((x) => x.key === r)?.labelKey ?? r)).join(", ") })}</>}
                  </>
                }
              />
            ))}
        </fieldset>
      );
      content = (
        <InstallStepForm action={saveApps} backHref={back("license")} labels={nav}>
          {group("standard")}
          {choices.some((c) => c.tier === "premium") && group("premium")}
          <InstallField
            name="landing"
            label={t("steps.apps.landing")}
            defaultValue={landing}
            options={choices.filter((c) => c.canLand && (c.locked || c.available)).map((c) => ({ value: c.key, label: label(c.labelKey) }))}
          />
          <p style={{ margin: "-12px 0 0", fontSize: 13, color: "var(--gcs-muted)" }}>{t("steps.apps.landingHint")}</p>
        </InstallStepForm>
      );
      break;
    }

    case "database": {
      const db = data.database ?? {};
      const inc = includedConnection();
      const lite = gcsEdition() === "lite";
      const engine = lite && db.engine !== "postgresql" ? "mysql" : "postgresql";
      content = (
        <DatabaseStep
          lite={lite}
          initial={{
            mode: db.mode === "external" ? "external" : "included",
            engine,
            host: str(db.host, "localhost"),
            port: str(db.port, engine === "mysql" ? "3306" : "5432"),
            user: str(db.user, "gcs"),
            database: str(db.database, "gcs"),
          }}
          included={inc ? { host: inc.host, port: String(inc.port), user: inc.user, database: inc.database } : null}
          labels={{
            group: t("steps.database.group"),
            included: t("steps.database.included"),
            includedHint: t("steps.database.includedHint"),
            external: t("steps.database.external"),
            externalHint: t("steps.database.externalHint"),
            engineGroup: t("steps.database.engineGroup"),
            mysql: t("steps.database.mysql"),
            mysqlHint: t("steps.database.mysqlHint"),
            postgresql: t("steps.database.postgresql"),
            postgresqlHint: t("steps.database.postgresqlHint"),
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
            <InstallField name="name" label={t("steps.site.name")} defaultValue={str(site.name, "Comunitatea mea")} span />
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
