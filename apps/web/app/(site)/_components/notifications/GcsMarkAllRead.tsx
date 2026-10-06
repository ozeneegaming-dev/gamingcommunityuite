"use client";

import { GcsButton } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { markNotificationsRead } from "../../notification-actions";

/** „Marchează toate citite” pe pagina `/notifications`. */
export function GcsMarkAllRead({ label }: { label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <GcsButton
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await markNotificationsRead({ ids: "all" });
          router.refresh();
        })
      }
    >
      {label}
    </GcsButton>
  );
}
