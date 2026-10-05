"use client";

import { GcsButton, GcsField } from "@gcs/ui";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { authClient, authErrorKey } from "@/lib/auth-client";

type Props = { discordEnabled: boolean; initialError: string | null };

export function LoginForm({ discordEnabled, initialError }: Props) {
  const t = useTranslations("auth");
  const [step, setStep] = useState<"credentials" | "twoFactor">("credentials");
  const [error, setError] = useState<string | null>(initialError);
  const [pending, setPending] = useState(false);

  // Navigare completă: header-ul (în layout-ul comun) trebuie randat din nou cu noua sesiune.
  function done() {
    window.location.assign("/");
  }

  async function onCredentials(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const { data, error } = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    setPending(false);
    if (error) return setError(authErrorKey(error));
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return setStep("twoFactor");
    done();
  }

  async function onTwoFactor(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await authClient.twoFactor.verifyTotp({
      code: String(form.get("code") ?? "").replace(/\s/g, ""),
      trustDevice: form.get("trustDevice") === "on",
    });
    setPending(false);
    if (error) return setError(authErrorKey(error));
    done();
  }

  const errorBox = error && (
    <p role="alert" className="gcs-field__error" style={{ fontSize: 13, margin: 0 }}>
      {t(`errors.${error}`)}
    </p>
  );

  if (step === "twoFactor") {
    return (
      <form onSubmit={onTwoFactor} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 className="gcs-display" style={{ margin: 0, fontSize: 18 }}>
          {t("twoFactor.title")}
        </h2>
        <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14 }}>{t("twoFactor.subtitle")}</p>
        <GcsField label={t("twoFactor.code")}>
          <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus />
        </GcsField>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "#C9CDD6", minHeight: 44 }}>
          <input type="checkbox" name="trustDevice" style={{ width: 18, height: 18, accentColor: "var(--gcs-accent)" }} />
          {t("twoFactor.trustDevice")}
        </label>
        {errorBox}
        <GcsButton variant="primary" type="submit" disabled={pending}>
          {t("twoFactor.submit")}
        </GcsButton>
      </form>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <form onSubmit={onCredentials} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <GcsField label={t("login.email")}>
          <input name="email" type="email" autoComplete="email" required />
        </GcsField>
        <GcsField label={t("login.password")}>
          <input name="password" type="password" autoComplete="current-password" required />
        </GcsField>
        {errorBox}
        <GcsButton variant="primary" type="submit" disabled={pending}>
          {t("login.submit")}
        </GcsButton>
      </form>

      <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--gcs-muted)", fontSize: 12 }}>
        <span style={{ flex: 1, height: 1, background: "var(--gcs-border)" }} />
        {t("login.or")}
        <span style={{ flex: 1, height: 1, background: "var(--gcs-border)" }} />
      </div>

      {discordEnabled && (
        <GcsButton
          variant="ghost"
          onClick={() => authClient.signIn.social({ provider: "discord", callbackURL: "/" })}
        >
          {t("login.discord")}
        </GcsButton>
      )}
      <GcsButton variant="ghost" asChild>
        <a href="/api/auth/steam/sign-in?callbackURL=/">{t("login.steam")}</a>
      </GcsButton>

      <p style={{ margin: 0, fontSize: 14, color: "var(--gcs-muted)", textAlign: "center" }}>
        {t("login.noAccount")} <Link href="/register">{t("login.registerLink")}</Link>
      </p>
    </div>
  );
}
