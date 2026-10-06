"use client";

import { faRightFromBracket } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useTransition } from "react";
import { authClient } from "@/lib/auth-client";

export function GcsLogoutButton({ label }: { label: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <GcsButton
      variant="ghost"
      icon={<GcsIconSvg icon={faRightFromBracket} />}
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
