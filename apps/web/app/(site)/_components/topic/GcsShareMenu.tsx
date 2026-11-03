"use client";

import { faFacebook, faLinkedin, faReddit, faTelegram, faWhatsapp, faXTwitter } from "@fortawesome/free-brands-svg-icons";
import { faEnvelope, faLink, faShareNodes } from "@fortawesome/free-solid-svg-icons";
import { GcsDropdown, GcsIconSvg, type GcsDropdownItem } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";

/** Rețelele (aceleași chei ca `GCS_SHARE_NETWORKS` din ACP › Distribuire). */
type Network = "x" | "facebook" | "whatsapp" | "telegram" | "reddit" | "linkedin" | "email";
export type GcsShareOptions = { networks: Network[]; nativeShare: boolean; hashtags: string };

const DEFAULT_OPTIONS: GcsShareOptions = { networks: ["x", "facebook", "whatsapp", "telegram", "email"], nativeShare: true, hashtags: "" };

/**
 * Meniul „Distribuie” al unui topic (Forum v2): copierea linkului (sau partajarea nativă a telefonului, dacă e pornită)
 * și linkurile de distribuire spre rețelele alese în ACP › Distribuire, cu titlul topicului. Adresa e cea canonică.
 */
export function GcsShareMenu({ path, title, options = DEFAULT_OPTIONS }: { path: string; title: string; options?: GcsShareOptions }) {
  const t = useTranslations("topic.share");
  const [copied, setCopied] = useState(false);
  const url = () => new URL(path, window.location.origin).toString();
  const open = (href: string) => window.open(href, "_blank", "noopener,noreferrer");
  const enc = encodeURIComponent;

  const networks: Record<Network, GcsDropdownItem> = {
    x: { kind: "action", label: "X", icon: <GcsIconSvg icon={faXTwitter} />, onSelect: () => open(`https://twitter.com/intent/tweet?url=${enc(url())}&text=${enc(title)}${options.hashtags ? `&hashtags=${enc(options.hashtags)}` : ""}`) },
    facebook: { kind: "action", label: "Facebook", icon: <GcsIconSvg icon={faFacebook} />, onSelect: () => open(`https://www.facebook.com/sharer/sharer.php?u=${enc(url())}`) },
    whatsapp: { kind: "action", label: "WhatsApp", icon: <GcsIconSvg icon={faWhatsapp} />, onSelect: () => open(`https://wa.me/?text=${enc(`${title} ${url()}`)}`) },
    telegram: { kind: "action", label: "Telegram", icon: <GcsIconSvg icon={faTelegram} />, onSelect: () => open(`https://t.me/share/url?url=${enc(url())}&text=${enc(title)}`) },
    reddit: { kind: "action", label: "Reddit", icon: <GcsIconSvg icon={faReddit} />, onSelect: () => open(`https://www.reddit.com/submit?url=${enc(url())}&title=${enc(title)}`) },
    linkedin: { kind: "action", label: "LinkedIn", icon: <GcsIconSvg icon={faLinkedin} />, onSelect: () => open(`https://www.linkedin.com/sharing/share-offsite/?url=${enc(url())}`) },
    email: { kind: "action", label: t("email"), icon: <GcsIconSvg icon={faEnvelope} />, onSelect: () => window.location.assign(`mailto:?subject=${enc(title)}&body=${enc(url())}`) },
  };

  const items: GcsDropdownItem[] = [
    {
      kind: "action",
      label: copied ? t("copied") : t("copy"),
      icon: <GcsIconSvg icon={faLink} />,
      testId: "gcs-share-copy",
      onSelect: () => {
        const link = url();
        if (options.nativeShare && typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
          void navigator.share({ title, url: link }).catch(() => {});
          return;
        }
        void navigator.clipboard?.writeText(link).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        });
      },
    },
    ...(options.networks.length > 0 ? [{ kind: "separator" } as GcsDropdownItem] : []),
    ...options.networks.map((n) => networks[n]),
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
