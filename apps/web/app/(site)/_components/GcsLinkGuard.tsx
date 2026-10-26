"use client";

import { isPhishingHost, type GcsPhishingLists } from "@gcs/core/phishing";
import { useEffect } from "react";

/**
 * Paza linkurilor (anti-phishing): un click pe un link spre un domeniu suspect (lista livrată, lista din ACP sau un
 * domeniu care imită Steam / Discord) duce întâi pe pagina de avertizare `/link`, oriunde ar fi linkul (postări vechi,
 * chat, profiluri, semnături).
 */
export function GcsLinkGuard({ lists }: { lists: GcsPhishingLists }) {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button > 1) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || !/^https?:$/.test(a.protocol) || a.host === window.location.host) return;
      if (!isPhishingHost(a.hostname, lists)) return;
      e.preventDefault();
      window.location.assign(`/link?u=${encodeURIComponent(a.href)}`);
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("auxclick", onClick, true);
    };
  }, [lists]);
  return null;
}
