import { GcsCard } from "@gcs/ui";
import type { ReactNode } from "react";

/**
 * Cardul centrat al paginilor de autentificare (stilul cardurilor din machete), cu iconița opțională din titlu. Titlul
 * și subtitlul stau pe banda cardului (specul 2026-10-07-antete-titluri).
 */
export function GcsAuthCard({ title, subtitle, icon, children }: { title: string; subtitle: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <GcsCard as="section" className="gcs-titledBox gcs-authCard" style={{ width: "100%", maxWidth: 440, margin: "24px auto", boxSizing: "border-box" }}>
      <header className="gcs-titleBand">
        <h1 className="gcs-display" style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: ".02em" }}>
          {icon && (
            <span className="gcs-hIcon" aria-hidden="true">
              {icon}
            </span>
          )}
          {title}
        </h1>
        <p style={{ margin: "6px 0 0", color: "var(--gcs-muted)", fontSize: 14 }}>{subtitle}</p>
      </header>
      {children}
    </GcsCard>
  );
}
