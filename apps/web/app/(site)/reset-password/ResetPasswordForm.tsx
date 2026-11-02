"use client";

import { faFloppyDisk, faPaperPlane } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsField, GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { resetPasswordAction } from "../password-reset-actions";

type Field = "password" | "confirm";

/**
 * Parola nouă (de două ori), cu regula din ACP → Setări → Securitate sub câmp. Serverul verifică din nou politica și
 * tokenul; la reușită membrul ajunge la autentificare (2FA se cere în continuare, dacă e activ).
 */
export function ResetPasswordForm({ token, minLength, hint }: { token: string; minLength: number; hint: string }) {
  const t = useTranslations("auth");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState(false);
  // Până la hidratare, trimiterea nativă ar ocoli `onSubmit`: butonul așteaptă React.
  const hydrated = useHydrated();

  /** Mesajul unei încălcări a politicii parolelor (codurile serverului, ca la înregistrare). */
  const policyMessage = (code: string) => (code === "password_too_short" ? t("errors.password_too_short_min", { min: minLength }) : t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.generic"));

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    setError(null);
    setFieldErrors({});
    if (password !== confirm) return setFieldErrors({ confirm: t("reset.mismatch") });
    setPending(true);
    const result = await resetPasswordAction({ token, password, confirm }).catch(() => null);
    if (!result) {
      setPending(false);
      return setError(t("errors.generic"));
    }
    if (result.ok) {
      // Navigare completă: pagina de autentificare (nu popup-ul), cu anunțul „parola a fost schimbată”.
      window.location.assign("/login?reset=done");
      return;
    }
    setPending(false);
    const { code, fields } = result.error;
    if (code === "not_found") return setExpired(true);
    if (code === "validation" && fields?.password) return setFieldErrors({ password: policyMessage(fields.password) });
    if (code === "validation" && fields?.confirm) return setFieldErrors({ confirm: t("reset.mismatch") });
    if (code === "validation" && fields?.token) return setExpired(true);
    if (code === "forbidden") return setError(t("forgot.disabled"));
    setError(t("errors.generic"));
  }

  if (expired) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }} data-testid="gcs-reset-invalid">
        <p role="alert" className="gcs-notice gcs-notice--error" style={{ margin: 0 }}>
          {t("reset.invalid")}
        </p>
        <GcsButton variant="primary" asChild icon={<GcsIconSvg icon={faPaperPlane} />}>
          <Link href="/forgot-password">{t("reset.requestNew")}</Link>
        </GcsButton>
      </div>
    );
  }

  return (
    <form method="post" onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }} noValidate data-testid="gcs-reset-form">
      <GcsField label={t("reset.password")} hint={hint} {...(fieldErrors.password ? { error: fieldErrors.password } : {})}>
        <input name="password" type="password" autoComplete="new-password" required minLength={minLength} maxLength={128} autoFocus data-testid="gcs-reset-password" />
      </GcsField>
      <GcsField label={t("reset.confirm")} {...(fieldErrors.confirm ? { error: fieldErrors.confirm } : {})}>
        <input name="confirm" type="password" autoComplete="new-password" required minLength={minLength} maxLength={128} data-testid="gcs-reset-confirm" />
      </GcsField>
      {error && (
        <p role="alert" className="gcs-field__error" style={{ fontSize: 13, margin: 0 }}>
          {error}
        </p>
      )}
      <GcsButton variant="primary" type="submit" disabled={pending || !hydrated} icon={<GcsIconSvg icon={faFloppyDisk} />}>
        {t("reset.submit")}
      </GcsButton>
    </form>
  );
}
