"use client";

import { GcsModal } from "@gcs/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, ReactNode } from "react";
import { rememberAuthReturn } from "@/lib/auth-return";

/** Popup-ul de login / înregistrare (rută interceptată): închiderea revine la pagina de dinainte. */
export function GcsAuthModal({ title, subtitle, closeLabel, children }: { title: string; subtitle: string; closeLabel: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <GcsModal title={title} closeLabel={closeLabel} size="sm" onClose={() => router.back()}>
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
