import type { ReactNode } from "react";
import { GcsSiteFooter } from "./_components/GcsSiteFooter";
import { GcsSiteHeader } from "./_components/GcsSiteHeader";

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <GcsSiteHeader />
      <main style={{ maxWidth: 1320, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 24 }}>
        {children}
      </main>
      <GcsSiteFooter />
    </>
  );
}
