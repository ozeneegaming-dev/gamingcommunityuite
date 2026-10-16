"use client";

import { faRightToBracket } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsField, GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { acpReauth } from "../actions";

export function ReauthForm({ askPassword }: { askPassword: boolean }) {
  const t = useTranslations("acp.reauth");
  const [error, setError] = useState<"invalid" | "rate_limited" | null>(null);
  const [pending, setPending] = useState(false);
  // Până la hidratare, trimiterea nativă ar ocoli `onSubmit`: butonul așteaptă React.
  const hydrated = useHydrated();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const result = await acpReauth({ password: String(form.get("password") ?? ""), code: String(form.get("code") ?? "") });
    setPending(false);
    if (!result.ok) return setError(result.error);
    window.location.assign("/admin");
  }

  return (
    <form method="post" onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {askPassword && (
        <GcsField label={t("password")}>
          <input name="password" type="password" autoComplete="current-password" required autoFocus />
        </GcsField>
      )}
      <GcsField label={t("code")}>
        <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus={!askPassword} />
      </GcsField>
      {error && (
        <p role="alert" className="gcs-field__error" style={{ fontSize: 13, margin: 0 }}>
          {t(`errors.${error}`)}
        </p>
      )}
      <GcsButton variant="primary" type="submit" disabled={pending || !hydrated} icon={<GcsIconSvg icon={faRightToBracket} />}>
        {t("submit")}
      </GcsButton>
    </form>
  );
}
