"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Bara de progres din capul paginii la schimbarea paginii: pornește imediat la click pe un link intern (până răspunde
 * serverul, pagina veche rămâne pe ecran, fără niciun semn) și se închide când apare pagina nouă.
 */
export function GcsNavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // Același URL (sau doar ancora schimbată): nu se încarcă nimic.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      setState("loading");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Pagina nouă a apărut: bara se umple și dispare.
  useEffect(() => {
    setState((s) => (s === "loading" ? "done" : s));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [pathname, search]);

  if (state === "idle") return null;
  return <div className={`gcs-navProgress gcs-navProgress--${state}`} role="progressbar" aria-hidden="true" data-testid="gcs-nav-progress" />;
}
