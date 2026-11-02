"use client";

import { faCookieBite } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useState } from "react";
import { COOKIE_NOTICE_COOKIE, COOKIE_NOTICE_MAX_AGE } from "@/lib/legal-consent";

/**
 * Banda de cookie-uri (ACP → Setări → Termeni și confidențialitate), în orice temă: fixată jos, peste pagină (nu mută
 * conținutul), cu textul din ACP (sau cel implicit), linkul spre politica de confidențialitate și „Am înțeles”. Închisă o
 * dată, nu mai apare: cookie-ul e citit pe server, care atunci nu o mai randează deloc.
 */
export function GcsCookieBanner({ text, privacyHref, labels }: { text: string; privacyHref: string | null; labels: { region: string; accept: string; privacy: string } }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const dismiss = () => {
    document.cookie = `${COOKIE_NOTICE_COOKIE}=1; path=/; max-age=${COOKIE_NOTICE_MAX_AGE}; samesite=lax`;
    try {
      window.localStorage.setItem(COOKIE_NOTICE_COOKIE, "1");
    } catch {
      // Stocarea browserului poate lipsi (mod privat): cookie-ul ajunge.
    }
    setOpen(false);
  };
  return (
    <section className="gcs-cookieBar" role="region" aria-label={labels.region} data-testid="gcs-cookie-banner">
      <GcsIconSvg icon={faCookieBite} className="gcs-cookieBar__icon" />
      <p className="gcs-cookieBar__text">
        {text}
        {privacyHref && (
          <>
            {" "}
            <a href={privacyHref} className="gcs-cookieBar__link" {...(/^https?:/i.test(privacyHref) ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
              {labels.privacy}
            </a>
          </>
        )}
      </p>
      <GcsButton variant="primary" size="sm" onClick={dismiss} data-testid="gcs-cookie-accept">
        {labels.accept}
      </GcsButton>
    </section>
  );
}
