"use client";

import { GcsBadgeArt, GcsMemberName, GcsTooltip } from "@gcs/ui";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { GcsRecentBadge } from "@/lib/recent-badges";
import { useRealtime } from "../realtime/GcsRealtimeProvider";

/**
 * Lista widget-ului „Ultimele realizări” (Realizări v2, funcție de sistem în orice temă): medalionul badge-ului, numele
 * stilizat al membrului (cu cardul la hover), „a primit <badge>” și timpul relativ. La un badge nou (camera live
 * `feed:badges`) lista se cere din nou, cu aceleași filtre, iar rândul nou apare cu o tranziție scurtă.
 */
export function GcsRecentBadges({ initial, query }: { initial: GcsRecentBadge[]; query: string }) {
  const t = useTranslations("widgets.recentBadges");
  const format = useFormatter();
  const realtime = useRealtime();
  const [items, setItems] = useState(initial);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const known = useRef(new Set(initial.map((i) => `${i.id}:${i.times}`)));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) return;
      // Mai multe badge-uri în aceeași clipă (o regulă cu mai mulți membri): o singură cerere.
      timer = setTimeout(async () => {
        timer = null;
        const res = await fetch(`/api/achievements/recent?${query}`, { cache: "no-store" }).catch(() => null);
        if (!res?.ok) return;
        const { items: next } = (await res.json()) as { items: GcsRecentBadge[] };
        const added = next.filter((i) => !known.current.has(`${i.id}:${i.times}`)).map((i) => i.id);
        known.current = new Set(next.map((i) => `${i.id}:${i.times}`));
        setItems(next);
        setFresh(new Set(added));
      }, 400);
    };
    void realtime.join("feed:badges");
    const off = realtime.on("badge", refresh);
    return () => {
      off();
      realtime.leave("feed:badges");
      if (timer) clearTimeout(timer);
    };
  }, [realtime, query]);

  if (items.length === 0) return <p className="gcs-sideCard__line">{t("empty")}</p>;
  return (
    <ul className="gcs-widgetList gcs-recentBadges" data-testid="gcs-recent-badges">
      {items.map((i) => {
        const at = new Date(i.at);
        return (
          <li key={`${i.id}:${i.times}`} className={`gcs-widgetRow gcs-recentBadges__row${fresh.has(i.id) ? " is-new" : ""}`} data-testid="gcs-recent-badge">
            <GcsTooltip content={i.badge.description ? `${i.badge.name} — ${i.badge.description}` : i.badge.name}>
              <span className="gcs-recentBadges__medal" tabIndex={0}>
                <GcsBadgeArt badge={i.badge} size={32} />
              </span>
            </GcsTooltip>
            <span className="gcs-widgetRow__body">
              <span className="gcs-widgetRow__title gcs-recentBadges__text">
                <GcsMemberName userId={i.user.id} name={i.user.name} nameKey={i.user.nameKey} href={i.href} />{" "}
                <span className="gcs-recentBadges__verb">{t("received")}</span> <b className="gcs-recentBadges__badge">{i.badge.name}</b>
                {i.times > 1 && <span className="gcs-recentBadges__times"> ×{i.times}</span>}
              </span>
              <span className="gcs-widgetRow__meta">
                <time dateTime={i.at} suppressHydrationWarning title={format.dateTime(at, { dateStyle: "long", timeStyle: "short" })}>
                  {format.relativeTime(at, new Date())}
                </time>
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
