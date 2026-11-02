"use client";

import { faPaperPlane } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsField, GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { requestPasswordResetAction } from "../password-reset-actions";

type Outcome = "sent" | "disabled" | "no_email";

/**
 * Cererea de resetare: emailul sau numele de utilizator. După trimitere, formularul lasă locul aceluiași mesaj neutru
 * pentru orice date (fără să spună dacă există contul).
 */
export function ForgotPasswordForm({ minutes }: { minutes: number }) {
  const t = useTranslations("auth");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Până la hidratare, trimiterea nativă ar ocoli `onSubmit`: butonul așteaptă React.
  const hydrated = useHydrated();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const identifier = String(new FormData(e.currentTarget).get("identifier") ?? "").trim();
    setError(null);
    setFieldError(null);
    if (!identifier) return setFieldError(t("forgot.required"));
    setPending(true);
    const result = await requestPasswordResetAction({ identifier }).catch(() => null);
    setPending(false);
    if (!result) return setError(t("errors.generic"));
    if (result.ok) return setOutcome(result.data.status);
    if (result.error.code === "rate_limited") return setError(t("errors.rate_limited"));
    if (result.error.code === "validation") return setFieldError(t("forgot.required"));
    setError(t("errors.generic"));
  }

  if (outcome) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <p role="status" className={outcome === "sent" ? "gcs-notice" : "gcs-notice gcs-notice--warn"} style={{ margin: 0 }} data-testid="gcs-forgot-sent">
          {outcome === "sent" ? t("forgot.sent", { minutes }) : t(outcome === "disabled" ? "forgot.disabled" : "forgot.noEmail")}
        </p>
        <p style={{ margin: 0, fontSize: 14, textAlign: "center" }}>
          <Link href="/login">{t("forgot.back")}</Link>
        </p>
      </div>
    );
  }

  return (
    <form method="post" onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }} noValidate>
      <GcsField label={t("forgot.identifier")} {...(fieldError ? { error: fieldError } : {})}>
        <input name="identifier" autoComplete="username" required maxLength={200} autoFocus />
      </GcsField>
      {error && (
        <p role="alert" className="gcs-field__error" style={{ fontSize: 13, margin: 0 }}>
          {error}
        </p>
      )}
      <GcsButton variant="primary" type="submit" disabled={pending || !hydrated} icon={<GcsIconSvg icon={faPaperPlane} />}>
        {t("forgot.submit")}
      </GcsButton>
      <p style={{ margin: 0, fontSize: 14, color: "var(--gcs-muted)", textAlign: "center" }}>
        <Link href="/login">{t("forgot.back")}</Link>
      </p>
    </form>
  );
}
