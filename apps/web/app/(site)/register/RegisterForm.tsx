"use client";

import { GcsButton, GcsField } from "@gcs/ui";
import Link from "next/link";
import Script from "next/script";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { authClient, authErrorKey, registerErrorField } from "@/lib/auth-client";
import { authReturnPath } from "@/lib/auth-return";

type Field = "name" | "email" | "password";

export function RegisterForm({ turnstileSiteKey }: { turnstileSiteKey: string | null }) {
  const t = useTranslations("auth");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    setFieldErrors({});
    // Widgetul Turnstile pune token-ul într-un câmp ascuns `cf-turnstile-response`.
    const captcha = form.get("cf-turnstile-response");
    const { error } = await authClient.signUp.email(
      {
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      },
      captcha ? { headers: { "x-captcha-response": String(captcha) } } : undefined,
    );
    setPending(false);
    if (error) {
      const key = authErrorKey(error);
      const field = registerErrorField(key);
      if (field) setFieldErrors({ [field]: t(`errors.${key}`) });
      else setError(key);
      return;
    }
    // Navigare completă: header-ul (în layout-ul comun) trebuie randat din nou cu noua sesiune.
    window.location.assign(authReturnPath());
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }} noValidate>
      <GcsField label={t("register.name")} hint={t("register.nameHint")} {...(fieldErrors.name ? { error: fieldErrors.name } : {})}>
        <input name="name" autoComplete="username" required minLength={3} maxLength={24} />
      </GcsField>
      <GcsField label={t("register.email")} {...(fieldErrors.email ? { error: fieldErrors.email } : {})}>
        <input name="email" type="email" autoComplete="email" required />
      </GcsField>
      <GcsField
        label={t("register.password")}
        hint={t("register.passwordHint")}
        {...(fieldErrors.password ? { error: fieldErrors.password } : {})}
      >
        <input name="password" type="password" autoComplete="new-password" required minLength={8} />
      </GcsField>

      {turnstileSiteKey && (
        <>
          <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
          <div className="cf-turnstile" data-sitekey={turnstileSiteKey} data-theme="dark" />
        </>
      )}

      {error && (
        <p role="alert" className="gcs-field__error" style={{ fontSize: 13, margin: 0 }}>
          {t(`errors.${error}`)}
        </p>
      )}
      <GcsButton variant="primary" type="submit" disabled={pending}>
        {t("register.submit")}
      </GcsButton>
      <p style={{ margin: 0, fontSize: 14, color: "var(--gcs-muted)", textAlign: "center" }}>
        {t("register.hasAccount")} <Link href="/login">{t("register.loginLink")}</Link>
      </p>
    </form>
  );
}
