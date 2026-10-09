"use client";

import { useEffect, useState } from "react";

/** Stilurile rezervei, puse cu `!important` (CSS-ul unei teme nu le poate anula). */
const FALLBACK_STYLE: Record<string, string> = {
  display: "block",
  visibility: "visible",
  opacity: "1",
  position: "static",
  margin: "0",
  padding: "10px 16px",
  "text-align": "center",
  "font-size": "12px",
  "line-height": "1.4",
  color: "#cfd6df",
  background: "#0b0f17",
  "clip-path": "none",
  transform: "none",
  filter: "none",
};

/** Mențiunea produsului e vizibilă (există, are mărime, nu e ascunsă sau transparentă). */
function poweredVisible(): boolean {
  const el = document.querySelector<HTMLElement>("[data-gcs-powered]");
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 40 || rect.height < 6) return false;
  if (typeof el.checkVisibility === "function" && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  const link = el.querySelector("a");
  return !!link && (link.textContent ?? "").includes("GamingCommunitySuite");
}

/**
 * Protecția mențiunii „Powered by GamingCommunitySuite” (specul principal §1.1): pe lângă slotul obligatoriu din
 * șablonul subsolului și regulile CSS cu `!important`, verifică în browser că rândul chiar se vede. Dacă un CSS al temei
 * îl ascunde (sau un șablon îl scoate), adaugă o rezervă la finalul paginii, cu stiluri pe care tema nu le poate anula.
 */
export function GcsPoweredGuard() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const check = () => setHidden(!poweredVisible());
    // După încărcarea CSS-ului temei și a fonturilor.
    const timer = window.setTimeout(check, 1200);
    window.addEventListener("load", check);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("load", check);
    };
  }, []);
  if (!hidden) return null;
  return (
    <p
      className="gcs-poweredFallback"
      data-testid="gcs-powered-fallback"
      ref={(el) => {
        if (!el) return;
        for (const [prop, value] of Object.entries(FALLBACK_STYLE)) el.style.setProperty(prop, value, "important");
        const a = el.querySelector("a");
        if (a) {
          a.style.setProperty("color", "#ffffff", "important");
          a.style.setProperty("font-weight", "700", "important");
        }
      }}
    >
      Powered by{" "}
      <a href="https://gamingcommunitysuite.com" rel="noopener" target="_blank">
        GamingCommunitySuite
      </a>
    </p>
  );
}
