"use client";

import { faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg } from "@gcs/ui";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Caruselul orizontal (topicurile recomandate): pista se derulează cu degetul sau cu săgețile (câte un card), cu
 * oprire pe carduri (`scroll-snap`). Săgețile se dezactivează la capete; fără JavaScript pista rămâne derulabilă.
 */
export function GcsCarousel({ label, labels, children }: { label: string; labels: { prev: string; next: string }; children: ReactNode }) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const update = useCallback(() => {
    const el = track.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
  }, []);

  useEffect(() => {
    update();
    const el = track.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [update]);

  const step = (dir: -1 | 1) => {
    const el = track.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>(".gcs-carousel__card");
    const gap = Number.parseFloat(getComputedStyle(el).columnGap) || 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * ((card?.offsetWidth ?? el.clientWidth) + gap), behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <div className="gcs-carousel__frame">
      <div ref={track} className="gcs-carousel__track" role="region" aria-label={label} tabIndex={0}>
        {children}
      </div>
      <button type="button" className="gcs-carousel__nav gcs-carousel__nav--prev" onClick={() => step(-1)} disabled={edges.start} aria-label={labels.prev} data-testid="gcs-carousel-prev">
        <GcsIconSvg icon={faChevronLeft} />
      </button>
      <button type="button" className="gcs-carousel__nav gcs-carousel__nav--next" onClick={() => step(1)} disabled={edges.end} aria-label={labels.next} data-testid="gcs-carousel-next">
        <GcsIconSvg icon={faChevronRight} />
      </button>
    </div>
  );
}
