"use client";

import { faChevronDown, faChevronUp } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg } from "@gcs/ui";
import { useEffect, useState, type ReactNode } from "react";

type Props = {
  /** `id`-ul amplasării: starea (restrâns / extins) se ține separat pentru fiecare panou. */
  id: string;
  /** Titlul randat pe server (iconița + textul), cu `id`-ul `gcs-widget-{id}`. */
  heading: ReactNode;
  labels: { collapse: string; expand: string };
  children: ReactNode;
};

const storageKey = (id: string) => `gcs:statsPanel:${id}:collapsed`;

/**
 * Cadrul panoului de statistici: bara de titlu și butonul de restrângere. Pe server panoul e mereu extins; starea
 * aleasă se ține în `localStorage` și se aplică după încărcare (citirile pot eșua: mod privat, stocare blocată).
 */
export function GcsStatsPanelFrame({ id, heading, labels, children }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const bodyId = `gcs-statsPanel-body-${id}`;

  useEffect(() => {
    try {
      if (window.localStorage.getItem(storageKey(id)) === "1") setCollapsed(true);
    } catch {
      // Stocarea indisponibilă: panoul rămâne extins.
    }
  }, [id]);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      if (next) window.localStorage.setItem(storageKey(id), "1");
      else window.localStorage.removeItem(storageKey(id));
    } catch {
      // Starea nu se mai ține minte, dar butonul funcționează.
    }
  };

  return (
    <section
      className="gcs-card gcs-statsPanel gcs-widget"
      aria-labelledby={`gcs-widget-${id}`}
      data-widget="core.statsPanel"
      data-testid="gcs-stats-panel"
      data-collapsed={collapsed ? "true" : undefined}
    >
      <header className="gcs-statsPanel__head">
        {heading}
        <button
          type="button"
          className="gcs-statsPanel__toggle"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          aria-label={collapsed ? labels.expand : labels.collapse}
          title={collapsed ? labels.expand : labels.collapse}
          onClick={toggle}
          data-testid="gcs-stats-toggle"
        >
          <GcsIconSvg icon={collapsed ? faChevronDown : faChevronUp} />
        </button>
      </header>
      <div id={bodyId} className="gcs-statsPanel__body" hidden={collapsed}>
        {children}
      </div>
    </section>
  );
}
