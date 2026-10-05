import { GcsCard } from "@gcs/ui";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getAcpContext } from "@/lib/acp";

/**
 * Paginile de intrare în ACP (configurare 2FA, reautentificare). Sunt în afara layout-ului panoului,
 * ca garda lui să nu redirecționeze în buclă. Fără `acp.access` → 404.
 */
export default async function AcpAuthLayout({ children }: { children: ReactNode }) {
  const ctx = await getAcpContext();
  if (ctx.state === "forbidden") notFound();
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <GcsCard as="section" style={{ width: "100%", maxWidth: 480, padding: "28px 28px 32px", boxSizing: "border-box" }}>
        {children}
      </GcsCard>
    </div>
  );
}
