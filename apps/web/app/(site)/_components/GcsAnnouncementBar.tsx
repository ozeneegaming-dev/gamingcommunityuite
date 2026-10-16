"use client";

import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { announcementOnPage, type GcsAnnouncementBar as Bar } from "@gcs/modules/announcement";
import { GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Labels = { region: string; dismiss: string; show: string };

const COOKIE = "gcs-ann";
/** Intrările păstrate în cookie (cele mai noi); o bară închisă de mult și schimbată nu mai contează. */
const MAX_ENTRIES = 30;

function remember(viewerKey: string, bar: Bar) {
  const current = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  const entries = decodeURIComponent(current ?? "")
    .split("|")
    .filter(Boolean)
    .filter((e) => !e.startsWith(`${viewerKey}~${bar.id}~`));
  entries.push(`${viewerKey}~${bar.id}~${bar.version}`);
  const value = encodeURIComponent(entries.slice(-MAX_ENTRIES).join("|"));
  document.cookie = `${COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
}

const isInternal = (href: string) => href.startsWith("/") && !href.startsWith("//");

function BarLink({ href, className, children }: { href: string; className: string; children: React.ReactNode }) {
  return isInternal(href) ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <a href={href} className={className} rel="noopener nofollow" target="_blank">
      {children}
    </a>
  );
}

/**
 * Bara de anunț (a sistemului, orice temă): eticheta, textul, butonul și linkul opționale. Mai multe bare se rotesc
 * (pauză la hover / focus), cu punctele de alegere; o bară care se poate închide dispare și rămâne închisă pentru
 * acest membru / vizitator (cookie, până la o versiune nouă a barei).
 */
export function GcsAnnouncementBar({ bars: initial, rotateSeconds, viewerKey, labels }: { bars: Bar[]; rotateSeconds: number; viewerKey: string; labels: Labels }) {
  const pathname = usePathname();
  const [closed, setClosed] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  // Filtrul „pagini” la fiecare navigare (layout-ul site-ului nu se re-randează), fără barele închise acum.
  const bars = initial.filter((b) => announcementOnPage(b, pathname) && !closed.includes(b.id));
  const count = bars.length;

  useEffect(() => {
    if (count < 2 || paused) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % count), rotateSeconds * 1000);
    return () => clearInterval(id);
  }, [count, paused, rotateSeconds]);

  if (count === 0) return null;
  const at = Math.min(index, count - 1);
  const bar = bars[at]!;

  const dismiss = () => {
    remember(viewerKey, bar);
    setClosed((list) => [...list, bar.id]);
    setIndex(0);
  };

  return (
    <section
      className={`gcs-annBar gcs-annBar--${bar.style}`}
      aria-label={labels.region}
      aria-roledescription={count > 1 ? "carousel" : undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      data-testid="gcs-ann-bar"
      data-bar={bar.id}
    >
      <div key={bar.id} className="gcs-annBar__slide" aria-live={count > 1 && !paused ? "off" : "polite"}>
        {bar.label && <span className="gcs-annBar__label">{bar.label}</span>}
        <span className="gcs-annBar__text">{bar.text}</span>
        {bar.link && (
          <BarLink href={bar.link.href} className="gcs-annBar__link">
            {bar.link.label}
          </BarLink>
        )}
        {bar.cta && (
          <BarLink href={bar.cta.href} className="gcs-btn gcs-btn--primary gcs-btn--sm gcs-annBar__cta">
            {bar.cta.label} <span className="gcs-annBar__arrow" aria-hidden="true">→</span>
          </BarLink>
        )}
      </div>
      {(count > 1 || bar.dismissible) && (
        <div className="gcs-annBar__tools">
          {count > 1 &&
            bars.map((b, i) => (
              <button
                key={b.id}
                type="button"
                className="gcs-annBar__dot"
                aria-label={labels.show.replace("{n}", String(i + 1))}
                aria-current={i === at ? "true" : undefined}
                onClick={() => setIndex(i)}
                data-testid="gcs-ann-dot"
              />
            ))}
          {bar.dismissible && (
            <button type="button" className="gcs-annBar__close" aria-label={labels.dismiss} onClick={dismiss} data-testid="gcs-ann-dismiss">
              <GcsIconSvg icon={faXmark} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
