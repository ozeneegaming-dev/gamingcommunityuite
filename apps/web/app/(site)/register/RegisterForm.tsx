"use client";

import { faDiscord, faGoogle, faSteam } from "@fortawesome/free-brands-svg-icons";
import { faUserPlus } from "@fortawesome/free-solid-svg-icons";
import { POW_HEADER, solvePowInBrowser, type GcsPowChallenge } from "@gcs/core/pow";
import { GcsButton, GcsField, GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import Script from "next/script";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { authClient, authErrorKey, registerErrorField } from "@/lib/auth-client";
import { authReturnPath } from "@/lib/auth-return";
import { TERMS_COOKIE, TERMS_COOKIE_MAX_AGE, TERMS_HEADER } from "@/lib/legal-consent";
import { useHydrated } from "@/lib/use-hydrated";

type Field = "name" | "email" | "password" | "terms";

/**
 * Termenii și confidențialitatea la înregistrare (ACP → Setări → Termeni și confidențialitate): linkurile documentelor
 * care există și, cât timp acceptarea e cerută, căsuța obligatorie (verificată și pe server) și butoanele Discord /
 * Google / Steam, active doar cu căsuța bifată. Regula parolei vine din ACP → Setări → Securitate.
 */
export type GcsRegisterLegal = {
  requireTerms: boolean;
  terms: string | null;
  privacy: string | null;
  minLength: number;
  passwordHint: string;
  discord?: boolean;
  google?: boolean;
};

/** Un link legal: se deschide într-o filă nouă (formularul nu se pierde). */
function LegalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel={/^https?:/i.test(href) ? "noopener noreferrer" : "noopener"}>
      {children}
    </a>
  );
}

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
  legal = null,
}: {
  turnstileSiteKey: string | null;
  pow?: boolean;
  question?: { id: number; text: string } | null;
  locale?: string;
  legal?: GcsRegisterLegal | null;
}) {
  const t = useTranslations("auth");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [accepted, setAccepted] = useState(false);
  const minLength = legal?.minLength ?? 8;
  /** Discord / Google / Steam: acceptarea ajunge la server printr-un cookie scurt (contul se creează la întoarcere). */
  const rememberTerms = () => {
    document.cookie = `${TERMS_COOKIE}=1; path=/; max-age=${TERMS_COOKIE_MAX_AGE}; samesite=lax`;
  };
  const social = (provider: "discord" | "google") => {
    if (!accepted) return setFieldErrors({ terms: t("errors.terms_required") });
    rememberTerms();
    void authClient.signIn.social({ provider, callbackURL: "/", errorCallbackURL: "/login" });
  };
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
    if (legal?.requireTerms) {
      if (!accepted) {
        setPending(false);
        setFieldErrors({ terms: t("errors.terms_required") });
        return;
      }
      headers[TERMS_HEADER] = "1";
    }
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
      // Lungimea minimă vine din ACP → Setări → Securitate: mesajul cu numărul ei.
      if (field) setFieldErrors({ [field]: key === "password_too_short" ? t("errors.password_too_short_min", { min: minLength }) : t(`errors.${key}`) });
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
        hint={legal?.passwordHint ?? t("register.passwordHint")}
        {...(fieldErrors.password ? { error: fieldErrors.password } : {})}
      >
        <input name="password" type="password" autoComplete="new-password" required minLength={minLength} />
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

      {legal?.requireTerms && legal.terms ? (
        <div className="gcs-field" data-testid="gcs-register-terms">
          <label className="gcs-checkRow gcs-registerTerms" style={{ alignItems: "flex-start", minHeight: 44, fontSize: 13, lineHeight: 1.5 }}>
            <input
              type="checkbox"
              name="terms"
              style={{ width: 18, height: 18, marginTop: 1, flex: "none", accentColor: "var(--gcs-accent)" }}
              required
              checked={accepted}
              onChange={(e) => {
                setAccepted(e.target.checked);
                if (e.target.checked) setFieldErrors((prev) => ({ ...prev, terms: undefined }));
              }}
              {...(fieldErrors.terms ? { "aria-invalid": true, "aria-describedby": "gcs-register-terms-error" } : {})}
            />
            <span>
              {t.rich(legal.privacy ? "register.acceptTermsPrivacy" : "register.acceptTerms", {
                terms: (chunks) => <LegalLink href={legal.terms!}>{chunks}</LegalLink>,
                privacy: (chunks) => <LegalLink href={legal.privacy ?? legal.terms!}>{chunks}</LegalLink>,
              })}
            </span>
          </label>
          {fieldErrors.terms && (
            <p id="gcs-register-terms-error" className="gcs-field__error" role="alert">
              {fieldErrors.terms}
            </p>
          )}
        </div>
      ) : (
        legal &&
        (legal.terms || legal.privacy) && (
          <p className="gcs-muted" style={{ margin: 0, fontSize: 13 }} data-testid="gcs-register-legal">
            {legal.terms && <LegalLink href={legal.terms}>{t("register.termsLink")}</LegalLink>}
            {legal.terms && legal.privacy && " · "}
            {legal.privacy && <LegalLink href={legal.privacy}>{t("register.privacyLink")}</LegalLink>}
          </p>
        )
      )}

      {error && (
        <p role="alert" className="gcs-field__error" style={{ fontSize: 13, margin: 0 }}>
          {t(`errors.${error}`)}
        </p>
      )}
      <GcsButton variant="primary" type="submit" disabled={pending || !hydrated} icon={<GcsIconSvg icon={faUserPlus} />}>
        {verifying ? t("register.verifying") : t("register.submit")}
      </GcsButton>
      {legal?.requireTerms && (
        // Cu acceptarea cerută, conturile noi prin Discord / Google / Steam pornesc de aici (după bifarea căsuței).
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid="gcs-register-social">
          {legal.google && (
            <GcsButton type="button" variant="ghost" className="gcs-btn--google" icon={<GcsIconSvg icon={faGoogle} />} disabled={!hydrated} aria-disabled={!accepted} onClick={() => social("google")}>
              {t("login.google")}
            </GcsButton>
          )}
          {legal.discord && (
            <GcsButton type="button" variant="ghost" className="gcs-btn--discord" icon={<GcsIconSvg icon={faDiscord} />} disabled={!hydrated} aria-disabled={!accepted} onClick={() => social("discord")}>
              {t("login.discord")}
            </GcsButton>
          )}
          <GcsButton variant="ghost" asChild className="gcs-btn--steam" icon={<GcsIconSvg icon={faSteam} />}>
            <a
              href="/api/auth/steam/sign-in?callbackURL=/"
              aria-disabled={!accepted}
              onClick={(e) => {
                if (!accepted) {
                  e.preventDefault();
                  setFieldErrors({ terms: t("errors.terms_required") });
                  return;
                }
                rememberTerms();
              }}
            >
              {t("login.steam")}
            </a>
          </GcsButton>
        </div>
      )}
      <p style={{ margin: 0, fontSize: 14, color: "var(--gcs-muted)", textAlign: "center" }}>
        {t("register.hasAccount")} <Link href="/login">{t("register.loginLink")}</Link>
      </p>
    </form>
  );
}
