"use client";

import { faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { PHONE_QUERY } from "@/lib/home-widgets";

const STORAGE_PREFIX = "gcs-collapsed:";

/**
 * Săgeata de restrângere din banda unei casete (categoriile forumului, widget-urile): ascunde tot conținutul casetei
 * în afară de bandă (`data-collapsed` pe casetă) și ține minte alegerea în browser (`localStorage`, pe cheie). În
 * designul Nova apare discret și se luminează la hover pe bandă.
 *
 * O casetă dintr-un loc marcat `data-phone-fold` (coloana din dreapta a primei pagini) e strânsă implicit pe telefon:
 * CSS-ul o strânge din prima randare (fără salt), iar săgeata arată starea. Alegerea membrului câștigă oricând:
 * „1” = strânsă, „0” = deschisă (`data-open` pe casetă anulează strângerea implicită de pe telefon).
 */
export function GcsCollapseToggle({ storageKey, title }: { storageKey: string; title: string }) {
  const t = useTranslations("site");
  const button = useRef<HTMLButtonElement>(null);
  /** Membrul a ales (săgeata): starea nu mai urmează lățimea ecranului. */
  const chosen = useRef(false);
  const [collapsed, setCollapsed] = useState(false);

  const apply = (value: boolean, explicit: boolean) => {
    const box = button.current?.closest<HTMLElement>(".gcs-card");
    if (!box) return;
    box.toggleAttribute("data-collapsed", value);
    box.toggleAttribute("data-open", explicit && !value);
  };
  const folds = () => !!button.current?.closest("[data-phone-fold]");

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(STORAGE_PREFIX + storageKey);
    } catch {
      // Fără acces la stocare (mod privat): caseta rămâne cum o arată pagina.
    }
    if (saved === "1" || saved === "0" || !folds()) {
      const value = saved === "1";
      setCollapsed(value);
      apply(value, saved !== null);
      return;
    }
    // Fără alegere, într-un loc strâns pe telefon: săgeata urmează lățimea ecranului (rotirea telefonului o schimbă).
    const phone = window.matchMedia(PHONE_QUERY);
    const sync = () => {
      if (!chosen.current) setCollapsed(phone.matches);
    };
    sync();
    phone.addEventListener("change", sync);
    return () => phone.removeEventListener("change", sync);
  }, [storageKey]);

  const toggle = () => {
    const next = !collapsed;
    chosen.current = true;
    setCollapsed(next);
    apply(next, true);
    try {
      if (next) window.localStorage.setItem(STORAGE_PREFIX + storageKey, "1");
      // Deschisă de membru într-un loc strâns implicit pe telefon: alegerea se ține minte.
      else if (folds()) window.localStorage.setItem(STORAGE_PREFIX + storageKey, "0");
      else window.localStorage.removeItem(STORAGE_PREFIX + storageKey);
    } catch {
      // Alegerea rămâne doar pentru pagina curentă.
    }
  };

  return (
    <button
      ref={button}
      type="button"
      className="gcs-collapseToggle"
      aria-expanded={!collapsed}
      aria-label={t(collapsed ? "expand" : "collapse", { title })}
      title={t(collapsed ? "expand" : "collapse", { title })}
      onClick={toggle}
      data-testid="gcs-collapse-toggle"
    >
      <GcsIconSvg icon={faChevronDown} />
    </button>
  );
}
