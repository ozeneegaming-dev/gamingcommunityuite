import { gcsEdition, type GcsInstallStep } from "@gcs/core";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { stepIndex, WIZARD_STEPS } from "@/lib/install";

/** Cardul wizard-ului (macheta Install): pașii în stânga (✓ / curent / viitor), conținutul pasului în dreapta. */
export async function InstallShell({ step, children }: { step: GcsInstallStep; children: ReactNode }) {
  const t = await getTranslations("install");
  const current = stepIndex(step);
  // Ediția Lite (găzduire partajată) are, la unii pași, alt text (ex. baza creată în panoul gazdei).
  const lite = gcsEdition() === "lite";
  return (
    <div className="gcs-card" style={{ display: "flex", flexWrap: "wrap", overflow: "hidden" }}>
      <ol
        aria-label={t("stepsNav")}
        style={{
          flex: "1 1 260px",
          margin: 0,
          padding: "28px 24px",
          listStyle: "none",
          background: "var(--gcs-chrome2)",
          borderRight: "1px solid var(--gcs-border)",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {WIZARD_STEPS.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li
              key={s}
              aria-current={active ? "step" : undefined}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", borderRadius: "var(--gcs-radius-sm)", background: active ? "var(--gcs-surface2)" : "transparent" }}
            >
              <span
                className="gcs-display"
                aria-hidden="true"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 700,
                  flexShrink: 0,
                  background: done ? "color-mix(in srgb, var(--gcs-ok) 16%, transparent)" : active ? "var(--gcs-accent-fill)" : "var(--gcs-surface2)",
                  color: done ? "var(--gcs-ok)" : active ? "#fff" : "var(--gcs-muted)",
                }}
              >
                {done ? "✓" : i + 1}
              </span>
              <span style={{ fontSize: 14, fontWeight: 600, color: done ? "var(--gcs-text)" : active ? "var(--gcs-heading)" : "var(--gcs-muted)" }}>
                {t(`steps.${s}.label`)}
                {done && <span className="gcs-srOnly"> ({t("done")})</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <section style={{ flex: "999 1 520px", minWidth: 0, padding: "32px 36px", display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--gcs-accentInk)" }}>
            {t("stepOf", { n: current + 1, total: WIZARD_STEPS.length })}
          </span>
          <h1 className="gcs-display" style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "var(--gcs-heading)" }}>
            {t(`steps.${step}.title`)}
          </h1>
          <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14, lineHeight: 1.6 }}>{t(lite && t.has(`steps.${step}.bodyLite`) ? `steps.${step}.bodyLite` : `steps.${step}.body`)}</p>
        </div>
        {children}
      </section>
    </div>
  );
}
