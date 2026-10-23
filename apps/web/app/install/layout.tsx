import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { INSTALL_VERSION } from "@/lib/install";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("install"))("title"), robots: { index: false, follow: false } };
}

/** Pagina installer-ului (macheta Install): logo, cardul cu pașii și nota de jos. */
export default async function InstallLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("install");
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "48px 16px",
        boxSizing: "border-box",
        background: "radial-gradient(circle at 50% 0%, rgba(214,40,57,.18), transparent 50%), var(--gcs-bg)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 1040, display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <span
            aria-hidden="true"
            style={{
              width: 40,
              height: 40,
              borderRadius: 9,
              background: "var(--gcs-accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: "skewX(-12deg)",
            }}
          >
            <span className="gcs-display" style={{ fontWeight: 700, fontSize: 20, color: "#fff", transform: "skewX(12deg)" }}>
              G
            </span>
          </span>
          <span className="gcs-display" style={{ fontSize: "clamp(18px, 5.4vw, 26px)", fontWeight: 700, letterSpacing: ".02em", minWidth: 0, overflowWrap: "anywhere" }}>
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
