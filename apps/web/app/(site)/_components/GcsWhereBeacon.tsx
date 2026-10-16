"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Semnul „unde sunt” pentru pagina /online (Membri v2): la fiecare pagină nouă, calea și titlul documentului ajung la
 * `/api/presence/where`. Fără date personale în adresă; o eroare de rețea se ignoră.
 */
export function GcsWhereBeacon() {
  const pathname = usePathname();
  useEffect(() => {
    // Titlul se pune după randare (metadata); un mic răgaz îl prinde pe cel al paginii noi.
    const timer = window.setTimeout(() => {
      void fetch("/api/presence/where", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Doar calea (fără parametrii de căutare: pot conține ce a căutat vizitatorul).
        body: JSON.stringify({ path: window.location.pathname, title: document.title }),
        keepalive: true,
      }).catch(() => {});
    }, 400);
    return () => window.clearTimeout(timer);
  }, [pathname]);
  return null;
}
