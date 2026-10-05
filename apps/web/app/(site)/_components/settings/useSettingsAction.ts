"use client";

import type { GcsResult } from "@gcs/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";

export type GcsActionStatus = { ok: boolean; text: string } | null;

/** Rulează o acțiune de setări: stare „în lucru”, mesajul de succes / eroare tradus și reîncărcarea datelor. */
export function useSettingsAction(savedText: string) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<GcsActionStatus>(null);
  const message = useErrorMessage();

  const run = <T,>(fn: () => Promise<GcsResult<T>>, onOk?: (data: T) => void, okText = savedText) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setStatus({ ok: false, text: message(res.error) });
        return;
      }
      setStatus({ ok: true, text: okText });
      onOk?.(res.data);
      router.refresh();
    });

  return { pending, status, setStatus, run };
}
