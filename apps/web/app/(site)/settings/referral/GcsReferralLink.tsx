"use client";

import { faCheck, faCopy } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

/** Linkul personal de invitație, cu „Copiază”. */
export function GcsReferralLink({ path }: { path: string }) {
  const t = useTranslations("settings.referral");
  const [copied, setCopied] = useState(false);
  // Adresa completă după montare (pe server nu se știe domeniul văzut de membru).
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const link = `${origin}${path}`;
  return (
    <div className="gcs-referralLink">
      <input className="gcs-input" readOnly value={link} aria-label={t("link")} onFocus={(e) => e.currentTarget.select()} data-testid="gcs-referral-link" />
      <GcsButton
        variant="primary"
        icon={<GcsIconSvg icon={copied ? faCheck : faCopy} />}
        onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true), () => setCopied(false))}
      >
        {copied ? t("copied") : t("copy")}
      </GcsButton>
    </div>
  );
}
