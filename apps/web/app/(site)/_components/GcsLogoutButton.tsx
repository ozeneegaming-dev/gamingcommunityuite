"use client";

import { GcsButton } from "@gcs/ui";
import { useTransition } from "react";
import { authClient } from "@/lib/auth-client";

export function GcsLogoutButton({ label }: { label: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <GcsButton
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await authClient.signOut();
          // Navigare completă: toată pagina se randează din nou, fără sesiune.
          window.location.assign("/");
        })
      }
    >
      {label}
    </GcsButton>
  );
}
