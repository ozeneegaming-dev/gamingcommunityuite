"use client";

import { faCheckDouble } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
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
      icon={<GcsIconSvg icon={faCheckDouble} />}
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
