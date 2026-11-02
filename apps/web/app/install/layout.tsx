import type { Metadata } from "next";
import { GcsMark } from "@gcs/ui";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { INSTALL_VERSION } from "@/lib/install";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("install"))("title"), robots: { index: false, follow: false } };
}

/** Pagina installer-ului (macheta Install): marca GCS, cardul cu pașii și nota de jos. Cromul produsului: brandul GCS. */
export default async function InstallLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("install");
  return (
    <div
      className="gcs-product"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "48px 16px",
        boxSizing: "border-box",
        background: "radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--gcs-accent) 16%, transparent), transparent 50%), var(--gcs-bg)",
        color: "var(--gcs-text)",
        fontFamily: "var(--gcs-font-text)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 1040, display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <GcsMark size={40} />
          <span className="gcs-display" style={{ fontSize: "clamp(18px, 5.4vw, 26px)", fontWeight: 800, letterSpacing: "-0.01em", color: "var(--gcs-heading)", minWidth: 0, overflowWrap: "anywhere" }}>
            Gaming<span style={{ color: "var(--gcs-accentInk)" }}>Community</span>Suite
          </span>
          <span style={{ fontSize: 13, color: "var(--gcs-muted)", marginLeft: 6 }}>{t("version", { version: INSTALL_VERSION })}</span>
        </div>
        {children}
        <span style={{ textAlign: "center", fontSize: 12, color: "var(--gcs-muted)" }}>{t("footer")}</span>
      </div>
    </div>
  );
}
