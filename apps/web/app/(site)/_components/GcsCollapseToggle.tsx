"use client";

import { faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

const STORAGE_PREFIX = "gcs-collapsed:";

/**
 * Săgeata de restrângere din banda unei casete (categoriile forumului, widget-urile): ascunde tot conținutul casetei
 * în afară de bandă (`data-collapsed` pe casetă) și ține minte alegerea în browser (`localStorage`, pe cheie). În
 * designul Nova apare discret și se luminează la hover pe bandă.
 */
export function GcsCollapseToggle({ storageKey, title }: { storageKey: string; title: string }) {
  const t = useTranslations("site");
  const button = useRef<HTMLButtonElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  const apply = (value: boolean) => {
    const box = button.current?.closest<HTMLElement>(".gcs-card");
    if (box) box.toggleAttribute("data-collapsed", value);
  };

  useEffect(() => {
    let saved = false;
    try {
      saved = window.localStorage.getItem(STORAGE_PREFIX + storageKey) === "1";
    } catch {
      // Fără acces la stocare (mod privat): caseta rămâne deschisă.
    }
    setCollapsed(saved);
    apply(saved);
  }, [storageKey]);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    apply(next);
    try {
      if (next) window.localStorage.setItem(STORAGE_PREFIX + storageKey, "1");
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
