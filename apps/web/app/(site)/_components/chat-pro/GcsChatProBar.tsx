"use client";

import { faBullhorn, faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import type { GcsChatProBarItemView } from "@gcs/modules";
import { GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

/**
 * Bara de anunțuri de deasupra conversației (Chat Pro): un element pe rând (textul și butonul lui), rotit automat la
 * `seconds` secunde, cu săgețile anterior / următor. Rotirea se oprește cât mouse-ul sau focusul e pe bară.
 */
export function GcsChatProBar({ items, seconds }: { items: GcsChatProBarItemView[]; seconds: number }) {
  const t = useTranslations("chatPro.bar");
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = items.length;

  useEffect(() => {
    if (index >= count) setIndex(0);
  }, [count, index]);

  useEffect(() => {
    if (count < 2 || paused) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), Math.max(3, seconds) * 1000);
    return () => clearInterval(timer);
  }, [count, paused, seconds]);

  const item = items[Math.min(index, count - 1)];
  if (!item) return null;
  const external = /^https:\/\//.test(item.ctaUrl);
  return (
    <section
      className="gcs-chatPro__bar"
      aria-label={t("label")}
      aria-roledescription={t("carousel")}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      data-testid="gcs-chatpro-bar"
    >
      <span className="gcs-chatPro__barIcon" aria-hidden="true">
        <GcsIconSvg icon={faBullhorn} />
      </span>
      <p className="gcs-chatPro__barText" aria-live={paused ? "polite" : "off"} data-testid="gcs-chatpro-bar-text">
        {item.text}
      </p>
      {item.ctaLabel && item.ctaUrl && (
        <a className="gcs-chatPro__barCta" href={item.ctaUrl} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} data-testid="gcs-chatpro-bar-cta">
          {item.ctaLabel}
        </a>
      )}
      {count > 1 && (
        <span className="gcs-chatPro__barNav">
          <button type="button" className="gcs-chatPro__iconBtn" aria-label={t("prev")} title={t("prev")} onClick={() => setIndex((i) => (i - 1 + count) % count)}>
            <GcsIconSvg icon={faChevronLeft} />
          </button>
          <span className="gcs-chatPro__barCount" aria-hidden="true">
            {index + 1}/{count}
          </span>
          <button type="button" className="gcs-chatPro__iconBtn" aria-label={t("next")} title={t("next")} onClick={() => setIndex((i) => (i + 1) % count)} data-testid="gcs-chatpro-bar-next">
            <GcsIconSvg icon={faChevronRight} />
          </button>
        </span>
      )}
    </section>
  );
}
