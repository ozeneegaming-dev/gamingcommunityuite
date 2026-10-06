"use client";

import { GcsModal } from "@gcs/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, ReactNode } from "react";
import { rememberAuthReturn } from "@/lib/auth-return";

/**
 * Popup-ul de login / înregistrare (rută interceptată): închiderea revine la pagina de dinainte. Iconița titlului vine
 * randată de pe server (`<GcsIcon name=… />`).
 */
export function GcsAuthModal({ title, subtitle, closeLabel, icon, children }: { title: string; subtitle: string; closeLabel: string; icon?: ReactNode; children: ReactNode }) {
  const router = useRouter();
  return (
    <GcsModal title={title} closeLabel={closeLabel} size="sm" onClose={() => router.back()} {...(icon ? { icon } : {})}>
      <p className="gcs-muted" style={{ margin: "0 0 16px" }}>
        {subtitle}
      </p>
      {children}
    </GcsModal>
  );
}

/** Link spre login / înregistrare care reține pagina curentă (după autentificare, userul revine aici). */
export function GcsAuthLink(props: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      onClick={(e) => {
        rememberAuthReturn();
        props.onClick?.(e);
      }}
    />
  );
}
