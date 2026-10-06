"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Închide un popover (selectorul de emoticoane, GIF-uri, setările, meniurile unui mesaj) la click în afara lui sau la
 * Escape. La Escape, focusul revine pe butonul care l-a deschis. Click-ul pe buton nu contează „în afară” (butonul își
 * face singur comutarea).
 */
export function useDismiss(open: boolean, panel: RefObject<HTMLElement | null>, onClose: () => void, trigger?: RefObject<HTMLElement | null>): void {
  const latest = useRef({ panel, trigger, onClose });
  useEffect(() => {
    latest.current = { panel, trigger, onClose };
  });
  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) => {
      const { panel: p, trigger: t } = latest.current;
      return target instanceof Node && (p.current?.contains(target) === true || t?.current?.contains(target) === true);
    };
    const down = (e: PointerEvent) => {
      if (!inside(e.target)) latest.current.onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      latest.current.onClose();
      latest.current.trigger?.current?.focus();
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
}
