"use client";

import { faFacebook, faTelegram, faWhatsapp, faXTwitter } from "@fortawesome/free-brands-svg-icons";
import { faEnvelope, faLink, faShareNodes } from "@fortawesome/free-solid-svg-icons";
import { GcsDropdown, GcsIconSvg, type GcsDropdownItem } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";

/**
 * Meniul „Distribuie” al unui topic (Forum v2): copierea linkului (sau partajarea nativă a telefonului) și linkurile de
 * distribuire spre rețelele sociale, cu titlul topicului. Adresa e cea canonică a topicului.
 */
export function GcsShareMenu({ path, title }: { path: string; title: string }) {
  const t = useTranslations("topic.share");
  const [copied, setCopied] = useState(false);
  const url = () => new URL(path, window.location.origin).toString();
  const open = (href: string) => window.open(href, "_blank", "noopener,noreferrer");
  const enc = encodeURIComponent;

  const items: GcsDropdownItem[] = [
    {
      kind: "action",
      label: copied ? t("copied") : t("copy"),
      icon: <GcsIconSvg icon={faLink} />,
      testId: "gcs-share-copy",
      onSelect: () => {
        const link = url();
        if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
          void navigator.share({ title, url: link }).catch(() => {});
          return;
        }
        void navigator.clipboard?.writeText(link).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        });
      },
    },
    { kind: "separator" },
    { kind: "action", label: "X", icon: <GcsIconSvg icon={faXTwitter} />, onSelect: () => open(`https://twitter.com/intent/tweet?url=${enc(url())}&text=${enc(title)}`) },
    { kind: "action", label: "Facebook", icon: <GcsIconSvg icon={faFacebook} />, onSelect: () => open(`https://www.facebook.com/sharer/sharer.php?u=${enc(url())}`) },
    { kind: "action", label: "WhatsApp", icon: <GcsIconSvg icon={faWhatsapp} />, onSelect: () => open(`https://wa.me/?text=${enc(`${title} ${url()}`)}`) },
    { kind: "action", label: "Telegram", icon: <GcsIconSvg icon={faTelegram} />, onSelect: () => open(`https://t.me/share/url?url=${enc(url())}&text=${enc(title)}`) },
    { kind: "action", label: t("email"), icon: <GcsIconSvg icon={faEnvelope} />, onSelect: () => window.location.assign(`mailto:?subject=${enc(title)}&body=${enc(url())}`) },
  ];

  return (
    <GcsDropdown
      label={t("label")}
      testId="gcs-share-menu"
      triggerClassName="gcs-btn gcs-btn--ghost gcs-btn--sm"
      trigger={
        <>
          <GcsIconSvg icon={faShareNodes} className="gcs-btn__icon" />
          {t("label")}
        </>
      }
      items={items}
    />
  );
}
