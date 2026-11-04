"use client";

import { faCheck, faCopy, faPlus } from "@fortawesome/free-solid-svg-icons";
import type { GcsResult } from "@gcs/core";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { useErrorMessage } from "@/lib/use-error-message";

/**
 * „Cheie nouă”: numele și drepturile (`children`), apoi cheia întreagă cu „Copiază”, arătată o singură dată
 * (pe server rămân doar prefixul și hash-ul). Panoul rămâne deschis cât timp cheia e pe ecran.
 */
export function GcsApiKeyCreate({ action, children }: { action: (fd: FormData) => Promise<GcsResult<{ id: number; key: string }>>; children: ReactNode }) {
  const t = useTranslations("acp.api");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setPending(true);
    setError(null);
    const result = await action(new FormData(form));
    setPending(false);
    if (!result.ok) return setError(errorMessage(result.error));
    form.reset();
    setCopied(false);
    setKey(result.data.key);
    router.refresh();
  }

  if (key) {
    return (
      <div className="gcs-apiKeyNew" data-testid="gcs-api-key-created">
        <p className="gcs-apiKeyNew__warn" role="status">
          {t("createdHint")}
        </p>
        <code className="gcs-webhookSecret" data-testid="gcs-api-key-value">
          {key}
        </code>
        <div className="gcs-apiKeyNew__actions">
          <GcsButton
            variant="primary"
            icon={<GcsIconSvg icon={copied ? faCheck : faCopy} />}
            onClick={() => void navigator.clipboard?.writeText(key).then(() => setCopied(true), () => setCopied(false))}
          >
            {copied ? t("copied") : t("copy")}
          </GcsButton>
          <GcsButton variant="ghost" icon={<GcsIconSvg icon={faPlus} />} onClick={() => setKey(null)}>
            {t("another")}
          </GcsButton>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="gcs-actionForm" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {children}
      <div className="gcs-actionForm__actions" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <GcsButton variant="primary" type="submit" disabled={pending} icon={<GcsIconSvg icon={faPlus} />}>
          {t("create")}
        </GcsButton>
        {error && (
          <span role="alert" style={{ fontSize: 13, fontWeight: 600, color: "#FF8A91" }}>
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
