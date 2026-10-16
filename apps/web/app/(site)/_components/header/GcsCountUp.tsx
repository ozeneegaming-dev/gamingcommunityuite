"use client";

import { useEffect, useRef, useState } from "react";

const DURATION_MS = 600;

/**
 * Un număr care „numără” până la valoarea nouă când se schimbă (contoarele din antet și din consolă). Prima afișare e
 * directă; cu `prefers-reduced-motion`, schimbarea e imediată.
 */
export function GcsCountUp({ value, format = (n) => String(n) }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value) return;
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    let frame = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / DURATION_MS);
      // Încetinește spre final (ease-out).
      const eased = 1 - (1 - p) ** 3;
      setShown(Math.round(start + (value - start) * eased));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{format(shown)}</>;
}
