import { GcsCard } from "@gcs/ui";
import type { ReactNode } from "react";

/** Cardul centrat al paginilor de autentificare (stilul cardurilor din machete), cu iconița opțională din titlu. */
export function GcsAuthCard({ title, subtitle, icon, children }: { title: string; subtitle: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <GcsCard
      as="section"
      style={{ width: "100%", maxWidth: 440, margin: "24px auto", padding: "28px 28px 32px", boxSizing: "border-box" }}
    >
      <h1 className="gcs-display" style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: ".02em" }}>
        {icon && (
          <span className="gcs-hIcon" aria-hidden="true">
            {icon}
          </span>
        )}
        {title}
      </h1>
      <p style={{ margin: "6px 0 22px", color: "var(--gcs-muted)", fontSize: 14 }}>{subtitle}</p>
      {children}
    </GcsCard>
  );
}
