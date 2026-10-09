"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Reîmprospătează pagina de progres cât timp operația e în coadă sau rulează. */
export function GcsRemovalRefresh({ active, everyMs = 1500 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs, router]);
  return null;
}
