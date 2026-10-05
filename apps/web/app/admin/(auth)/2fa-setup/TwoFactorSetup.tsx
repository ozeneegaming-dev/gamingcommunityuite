"use client";

import { GcsButton, GcsField } from "@gcs/ui";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

type Enrollment = { qr: string; secret: string; backupCodes: string[] };

/** Activarea 2FA (TOTP) prin Better Auth: parola → cod QR + coduri de rezervă → confirmarea cu un cod. */
export function TwoFactorSetup({ askPassword }: { askPassword: boolean }) {
  const t = useTranslations("acp.twoFactorSetup");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [error, setError] = useState<"password" | "code" | "generic" | null>(null);
  const [pending, setPending] = useState(false);

  async function onStart(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const password = String(form.get("password") ?? "");
    const { data, error } = await authClient.twoFactor.enable(askPassword ? { password } : {});
    setPending(false);
    if (error || !data) return setError(error?.status === 400 || error?.status === 401 ? "password" : "generic");
    if (data.method !== "totp") return setError("generic");
    const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
    const qr = await QRCode.toDataURL(data.totpURI, { margin: 1, width: 200, color: { dark: "#0B0C10", light: "#FFFFFF" } });
    setEnrollment({ qr, secret, backupCodes: data.backupCodes });
  }

  async function onVerify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await authClient.twoFactor.verifyTotp({ code: String(form.get("code") ?? "").replace(/\s/g, "") });
    setPending(false);
    if (error) return setError("code");
    window.location.assign("/admin/reauth");
  }

  const errorBox = error && (
    <p role="alert" className="gcs-field__error" style={{ fontSize: 13, margin: 0 }}>
      {t(`errors.${error}`)}
    </p>
  );

  if (!enrollment) {
    return (
      <form onSubmit={onStart} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {askPassword && (
          <GcsField label={t("password")}>
            <input name="password" type="password" autoComplete="current-password" required autoFocus />
          </GcsField>
        )}
        {errorBox}
        <GcsButton variant="primary" type="submit" disabled={pending}>
          {t("start")}
        </GcsButton>
      </form>
    );
  }

  return (
    <form onSubmit={onVerify} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <img src={enrollment.qr} alt={t("qr")} width={200} height={200} style={{ alignSelf: "center", borderRadius: 12 }} />
      <div className="gcs-field">
        <span>{t("secret")}</span>
        <code data-testid="gcs-totp-secret" style={{ fontSize: 14, letterSpacing: ".08em", wordBreak: "break-all", color: "var(--gcs-text)" }}>
          {enrollment.secret}
        </code>
      </div>
      <div className="gcs-field">
        <span>{t("backupCodes")}</span>
        <code style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 4, fontSize: 13, color: "var(--gcs-text)" }}>
          {enrollment.backupCodes.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </code>
      </div>
      <GcsField label={t("code")}>
        <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus />
      </GcsField>
      {errorBox}
      <GcsButton variant="primary" type="submit" disabled={pending}>
        {t("verify")}
      </GcsButton>
    </form>
  );
}
