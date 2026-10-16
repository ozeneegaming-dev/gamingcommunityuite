"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** Cât așteaptă meniul deschis la hover înainte să se închidă (mouse-ul trece spre panou). */
const HOVER_CLOSE_MS = 180;
const HOVER_OPEN_MS = 90;

export type GcsPopoverMode = "click" | "hover";

/**
 * Comportamentul comun al panourilor din antet (căutare, „Creează”, mesaje, contul, mega meniurile): deschiderea la
 * click (sau la hover, cu întârziere), Escape și click în afară închid și readuc focusul pe buton, Tab rămâne în panou
 * (`trap`), săgețile mută focusul între itemii de meniu (`menu`). Panoul rămâne montat după prima deschidere, ca
 * tranziția de închidere (fade + 6 px) să ruleze; închis, e `inert`.
 */
export function useHeaderPopover({ mode = "click", trap = false, menu = false, onOpen }: { mode?: GcsPopoverMode; trap?: boolean; menu?: boolean; onOpen?: () => void } = {}) {
  const [open, setOpenState] = useState(false);
  const [mounted, setMounted] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  const setOpen = useCallback((next: boolean) => {
    setOpenState((prev) => {
      if (next && !prev) {
        setMounted(true);
        onOpenRef.current?.();
      }
      return next;
    });
  }, []);

  const close = useCallback((focusTrigger = true) => {
    setOpenState(false);
    if (focusTrigger) trigger.current?.focus();
  }, []);

  // Click în afară: închide (fără să mute focusul, utilizatorul a ales altceva).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpenState(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // La deschidere: focusul pe primul câmp (căutarea) sau pe primul item.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const el = panel.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panel.current?.querySelector<HTMLElement>(menu ? '[role="menuitem"]' : FOCUSABLE);
      if (mode === "click" || trap) el?.focus();
    }, 20);
    return () => clearTimeout(t);
  }, [open, menu, mode, trap]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    const list = [...(panel.current?.querySelectorAll<HTMLElement>(menu ? '[role="menuitem"], [role="menuitemradio"]' : FOCUSABLE) ?? [])].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (menu && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End")) {
      if (list.length === 0) return;
      e.preventDefault();
      const at = list.indexOf(document.activeElement as HTMLElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : (at + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
      list[next]?.focus();
      return;
    }
    if (e.key === "Tab" && trap) {
      const all = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => el.offsetParent !== null);
      const first = all[0];
      const last = all[all.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    } else if (e.key === "Tab" && !trap && menu) {
      // Un meniu simplu se închide când focusul pleacă din el.
      setOpenState(false);
    }
  };

  const hover = mode === "hover";
  const schedule = (next: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), next ? HOVER_OPEN_MS : HOVER_CLOSE_MS);
  };

  return {
    open,
    mounted,
    setOpen,
    close,
    panelId: `${id}-panel`,
    rootProps: {
      ref: root as RefObject<HTMLDivElement>,
      onKeyDown,
      ...(hover ? { onMouseEnter: () => schedule(true), onMouseLeave: () => schedule(false) } : {}),
      "data-open": open ? "" : undefined,
    },
    triggerProps: {
      ref: trigger as RefObject<HTMLButtonElement>,
      type: "button" as const,
      "aria-expanded": open,
      "aria-controls": `${id}-panel`,
      onClick: (e: ReactMouseEvent) => {
        e.preventDefault();
        setOpen(!open);
      },
      onKeyDown: (e: ReactKeyboardEvent) => {
        if (e.key === "ArrowDown" && menu && !open) {
          e.preventDefault();
          setOpen(true);
        }
      },
    },
    panelProps: {
      ref: panel as RefObject<HTMLDivElement>,
      id: `${id}-panel`,
      "data-open": open ? "" : undefined,
      inert: open ? undefined : true,
      "aria-hidden": open ? undefined : true,
    },
  };
}
