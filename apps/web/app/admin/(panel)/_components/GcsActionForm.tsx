"use client";

import type { GcsErrorPayload, GcsResult } from "@gcs/core";
import { GcsButton } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type CSSProperties, type FormEvent, type ReactNode } from "react";

type Props = {
  action: (fd: FormData) => Promise<GcsResult<unknown>>;
  submitLabel: string;
  variant?: "primary" | "ghost";
  children?: ReactNode;
  style?: CSSProperties;
  /** Unde merge pagina după succes; implicit se reîncarcă datele paginii curente. */
  redirectTo?: string;
  /** Pentru butoanele de un singur rând (ex. „Scoate grupul”), fără mesaj de succes. */
  compact?: boolean;
  confirm?: string;
};

/** Mesajul tradus pentru o eroare `GcsResult`: motivul (`params.reason`), erorile pe câmpuri sau codul general. */
export function useErrorMessage(): (error: GcsErrorPayload) => string {
  const t = useTranslations("errors");
  return (error) => {
    const reason = error.params?.reason;
    if (reason && t.has(`reasons.${reason}`)) return t(`reasons.${reason}`);
    const fieldCodes = Object.values(error.fields ?? {});
    if (fieldCodes.length > 0) {
      return fieldCodes.map((c) => (t.has(`fields.${c}`) ? t(`fields.${c}`) : c)).join(" · ");
    }
    return t.has(error.code) ? t(error.code) : error.code;
  };
}

/** Un formular ACP legat de o Server Action care întoarce `GcsResult`: afișează „Salvat” sau eroarea. */
export function GcsActionForm({ action, submitLabel, variant = "primary", children, style, redirectTo, compact, confirm }: Props) {
  const router = useRouter();
  const t = useTranslations("acp");
  const errorMessage = useErrorMessage();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (confirm && !window.confirm(confirm)) return;
    const fd = new FormData(e.currentTarget);
    setPending(true);
    setStatus(null);
    const result = await action(fd);
    setPending(false);
    if (!result.ok) return setStatus({ ok: false, text: errorMessage(result.error) });
    if (!compact) setStatus({ ok: true, text: t("saved") });
    if (redirectTo) router.push(redirectTo);
    else router.refresh();
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: compact ? "row" : "column", gap: compact ? 8 : 14, ...style }}>
      {children}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <GcsButton variant={variant} size={compact ? "sm" : "md"} type="submit" disabled={pending}>
          {submitLabel}
        </GcsButton>
        {status && (
          <span
            role={status.ok ? "status" : "alert"}
            style={{ fontSize: 13, fontWeight: 600, color: status.ok ? "var(--gcs-ok)" : "#FF8A91" }}
          >
            {status.text}
          </span>
        )}
      </div>
    </form>
  );
}
