"use client";

import { useEffect } from "react";

/**
 * Derulează la o postare de pe pagina curentă (Setări → Vizualizarea conținutului, când ținta e pe prima pagină) și pune
 * `#post-<id>` în adresă (fără o intrare nouă în istoric), doar dacă adresa nu cere deja un loc anume.
 * Starea `null` lasă routerul Next să preia adresa nouă; cu starea lui (`__NA`), routerul n-ar ști de fragment și
 * l-ar șterge la următoarea actualizare (un `router.refresh()`, o acțiune de server).
 */
export function GcsScrollToPost({ postId }: { postId: number }) {
  useEffect(() => {
    if (window.location.hash) return;
    const el = document.getElementById(`post-${postId}`);
    if (!el) return;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#post-${postId}`);
    el.scrollIntoView({ block: "start" });
  }, [postId]);
  return null;
}
