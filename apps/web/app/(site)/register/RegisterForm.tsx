"use client";

import { faUserPlus } from "@fortawesome/free-solid-svg-icons";
import { POW_HEADER, solvePowInBrowser, type GcsPowChallenge } from "@gcs/core/pow";
import { GcsButton, GcsField, GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import Script from "next/script";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { authClient, authErrorKey, registerErrorField } from "@/lib/auth-client";
import { authReturnPath } from "@/lib/auth-return";
import { useHydrated } from "@/lib/use-hydrated";

type Field = "name" | "email" | "password";

/** Captcha-ul proof-of-work: provocarea se cere și se rezolvă în fundal cât timp membrul completează formularul. */
async function solveChallenge(signal: AbortSignal): Promise<string> {
  const res = await fetch("/api/antispam/pow", { cache: "no-store", signal });
  if (!res.ok) throw new Error("pow");
  return solvePowInBrowser((await res.json()) as GcsPowChallenge, signal);
}

export function RegisterForm({
  turnstileSiteKey,
  pow = false,
  question = null,
  locale,
}: {
  turnstileSiteKey: string | null;
  pow?: boolean;
  question?: { id: number; text: string } | null;
  locale?: string;
}) {
  const t = useTranslations("auth");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Până la hidratare, trimiterea nativă ar ocoli `onSubmit`: butonul așteaptă React.
  const hydrated = useHydrated();
  // O soluție e folosită o singură dată: după o încercare refuzată, se pornește alta.
  const powRef = useRef<Promise<string> | null>(null);
  const [verifying, setVerifying] = useState(false);
  const startPow = () => {
    const ctl = new AbortController();
    powRef.current = solveChallenge(ctl.signal);
    powRef.current.catch(() => {});
    return ctl;
  };
  useEffect(() => {
    if (!pow) return;
    const ctl = startPow();
    return () => ctl.abort();
  }, [pow]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    setFieldErrors({});
    // Widgetul Turnstile pune token-ul într-un câmp ascuns `cf-turnstile-response`.
    const captcha = form.get("cf-turnstile-response");
    const headers: Record<string, string> = {};
    if (captcha) headers["x-captcha-response"] = String(captcha);
    if (locale) headers["x-gcs-locale"] = locale;
    if (question) {
      headers["x-gcs-qa-id"] = String(question.id);
      headers["x-gcs-qa-answer"] = encodeURIComponent(String(form.get("answer") ?? ""));
    }
    if (pow) {
      setVerifying(true);
      if (!powRef.current) startPow();
      const token = await powRef.current!.catch(() => null);
      setVerifying(false);
      if (!token) {
        setPending(false);
        setError("captcha");
        startPow();
        return;
      }
      headers[POW_HEADER] = token;
    }
    const { error } = await authClient.signUp.email(
      {
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      },
      Object.keys(headers).length > 0 ? { headers } : undefined,
    );
    setPending(false);
    if (error && pow) startPow();
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
    <form method="post" onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }} noValidate>
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

      {question && (
        <GcsField label={question.text} hint={t("register.answerHint")}>
          <input name="answer" autoComplete="off" required maxLength={100} data-testid="gcs-register-answer" />
        </GcsField>
      )}

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
      <GcsButton variant="primary" type="submit" disabled={pending || !hydrated} icon={<GcsIconSvg icon={faUserPlus} />}>
        {verifying ? t("register.verifying") : t("register.submit")}
      </GcsButton>
      <p style={{ margin: 0, fontSize: 14, color: "var(--gcs-muted)", textAlign: "center" }}>
        {t("register.hasAccount")} <Link href="/login">{t("register.loginLink")}</Link>
      </p>
    </form>
  );
}
