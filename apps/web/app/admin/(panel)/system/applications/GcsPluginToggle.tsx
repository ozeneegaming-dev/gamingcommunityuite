"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { setPluginEnabled } from "./plugin-actions";

/**
 * Comutatorul unui plugin din listă: activarea / dezactivarea se aplică imediat, în toate procesele (fără repornire).
 * La o eroare (ex. o dependență dezactivată) comutatorul revine și apare mesajul.
 */
export function GcsPluginToggle({ pluginKey, enabled, label, disabled }: { pluginKey: string; enabled: boolean; label: string; disabled?: boolean }) {
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [on, setOn] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <span className="gcs-pluginToggle">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={on}
        disabled={disabled || pending}
        data-testid={`gcs-plugin-toggle-${pluginKey}`}
        onChange={(e) => {
          const next = e.currentTarget.checked;
          setOn(next);
          setError(null);
          start(async () => {
            const res = await setPluginEnabled(pluginKey, next);
            if (!res.ok) {
              setOn(!next);
              setError(errorMessage(res.error));
              return;
            }
            router.refresh();
          });
        }}
      />
      {error && (
        <span role="alert" className="gcs-pluginToggle__error">
          {error}
        </span>
      )}
    </span>
  );
}
