"use client";

import { faChevronDown, faChevronUp } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg } from "@gcs/ui";
import { useEffect, useState } from "react";

type Labels = { group: string; up: string; upHint: string; down: string; downHint: string };

/** Pragul de la care iese banda (o derulare mică) și toleranța capetelor paginii. */
const SHOW_AFTER = 240;
const END = 4;

/**
 * Banda „Sus / Jos” (macheta HomeComplete), a sistemului, în orice temă: lipită în stânga de marginea conținutului,
 * iese după o mică derulare; fiecare buton e estompat la capătul lui de pagină. Tooltip-urile „Sus” / „Jos” vin din
 * tooltip-ul sistemului (`data-tip`). Setarea temei „Banda Sus / Jos” o ascunde (`data-gcs-rail="off"`).
 */
export function GcsScrollRail({ labels }: { labels: Labels }) {
  const [state, setState] = useState({ show: false, top: true, bottom: false });

  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const next = { show: y > SHOW_AFTER, top: y <= END, bottom: y >= max - END };
      setState((s) => (s.show === next.show && s.top === next.top && s.bottom === next.bottom ? s : next));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const go = (to: "top" | "bottom") => {
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: to === "top" ? 0 : document.documentElement.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };

  return (
    <div className={`gcs-scrollRail${state.show ? " gcs-scrollRail--show" : ""}`} role="group" aria-label={labels.group} data-testid="gcs-scroll-rail">
      <button
        type="button"
        className="gcs-scrollRail__btn"
        aria-label={labels.upHint}
        data-tip={labels.up}
        aria-disabled={state.top || undefined}
        data-end={state.top ? "" : undefined}
        tabIndex={state.show ? 0 : -1}
        onClick={() => !state.top && go("top")}
        data-testid="gcs-scroll-up"
      >
        <GcsIconSvg icon={faChevronUp} />
      </button>
      <button
        type="button"
        className="gcs-scrollRail__btn"
        aria-label={labels.downHint}
        data-tip={labels.down}
        aria-disabled={state.bottom || undefined}
        data-end={state.bottom ? "" : undefined}
        tabIndex={state.show ? 0 : -1}
        onClick={() => !state.bottom && go("bottom")}
        data-testid="gcs-scroll-down"
      >
        <GcsIconSvg icon={faChevronDown} />
      </button>
    </div>
  );
}
