"use client";

import Link from "next/link";
import { useId, useRef, useState, type KeyboardEvent } from "react";

export type GcsServerStatsItem = { serverId: number; server: string; place: string; kills: string; deaths: string; kd: string; points: string; rankingHref: string };

/**
 * Banda „pe servere” a profilului v2: un tab pentru fiecare server al comunității pe care a jucat membrul (aplicația
 * Servere), cu locul, uciderile, decesele, K/D și punctele, plus linkul spre clasamentul serverului. Taburile se schimbă
 * cu săgețile (rolurile ARIA ale taburilor); conținutul se schimbă cu un cross-fade.
 */
export function GcsServerStatsStrip({ items, labels }: { items: GcsServerStatsItem[]; labels: { title: string; place: string; kills: string; deaths: string; kd: string; points: string; ranking: string } }) {
  const [active, setActive] = useState(0);
  const base = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = items[active] ?? items[0];
  if (!current) return null;
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (active + (e.key === "ArrowRight" ? 1 : items.length - 1)) % items.length;
    setActive(next);
    tabs.current[next]?.focus();
  };
  return (
    <section className="gcs-card gcs-serverStrip" aria-label={labels.title} data-testid="gcs-profile-server-stats">
      <div className="gcs-serverStrip__tabs" role="tablist" aria-label={labels.title} onKeyDown={onKey}>
        {items.map((s, i) => (
          <button
            key={s.serverId}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${i}`}
            aria-selected={i === active}
            aria-controls={`${base}-panel`}
            tabIndex={i === active ? 0 : -1}
            className={`gcs-tab gcs-serverStrip__tab${i === active ? " gcs-tab--active" : ""}`}
            onClick={() => setActive(i)}
            data-testid="gcs-profile-server-tab"
          >
            {s.server}
          </button>
        ))}
      </div>
      <div key={current.serverId} id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-tab-${active}`} className="gcs-serverStrip__panel">
        <dl className="gcs-serverStrip__stats">
          {(
            [
              [labels.place, current.place, "place"],
              [labels.kills, current.kills, "kills"],
              [labels.deaths, current.deaths, "deaths"],
              [labels.kd, current.kd, "kd"],
              [labels.points, current.points, "points"],
            ] as const
          ).map(([label, value, key]) => (
            <div key={key} data-stat={key}>
              <dt>{label}</dt>
              <dd className="gcs-display">{value}</dd>
            </div>
          ))}
        </dl>
        <Link href={current.rankingHref} className="gcs-btn gcs-btn--ghost gcs-btn--sm gcs-serverStrip__ranking" data-testid="gcs-profile-server-ranking">
          {labels.ranking}
          <span aria-hidden="true"> →</span>
        </Link>
      </div>
    </section>
  );
}
