"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Un grup pe pagina „Grupurile comunității”: rândul e un buton (`aria-expanded`) care deschide membrii grupului, cu o
 * animație de înălțime și opacitate (doar opacitate cu „reduced motion”). Închis, panoul e `inert` (nu primește focus).
 */
export function GcsGroupsPageRow({ color, head, children, defaultOpen = false, testId }: { color: string | null; head: ReactNode; children: ReactNode; defaultOpen?: boolean; testId?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={`gcs-groupsPage__group${open ? " gcs-groupsPage__group--open" : ""}`} style={{ "--gcs-group": color ?? "var(--gcs-muted)" } as CSSProperties} data-testid={testId}>
      <button type="button" className="gcs-groupsPage__head" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        {head}
      </button>
      <div id={id} className="gcs-groupsPage__panel" inert={!open} aria-hidden={!open}>
        <div className="gcs-groupsPage__panelInner">{children}</div>
      </div>
    </div>
  );
}

/** Un număr care „urcă” de la zero la afișare (o singură dată); cu „reduced motion”, direct valoarea. */
export function GcsCountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) {
      setShown(value);
      return;
    }
    done.current = true;
    if (value <= 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    const ms = 600;
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      // Aceeași curbă ca restul animațiilor (ieșire lină).
      setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    setShown(0);
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{shown}</>;
}
