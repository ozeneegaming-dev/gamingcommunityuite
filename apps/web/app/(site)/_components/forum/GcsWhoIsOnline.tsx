"use client";

import { GcsUserLink } from "@gcs/ui";
import { useEffect, useState } from "react";
import type { GcsOnlineView } from "@/lib/online";
import { memberHref } from "@/lib/forum-urls";

const REFRESH_MS = 60_000;

type Labels = { title: string; summary: string; record: string; nobody: string };

/** „Cine e online” (coloana paginii principale): datele inițiale vin de pe server, apoi se reîmprospătează la 60 s. */
export function GcsWhoIsOnline({ initial, labels, locale }: { initial: GcsOnlineView; labels: Labels; locale: string }) {
  const [view, setView] = useState(initial);

  useEffect(() => {
    const timer = setInterval(() => {
      fetch("/api/presence/online", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<GcsOnlineView>) : null))
        .then((v) => v && setView(v))
        .catch(() => {});
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const membersCount = view.members.length + view.hidden;
  const summary = labels.summary.replace("{members}", String(membersCount)).replace("{guests}", String(view.guests));
  return (
    <section className="gcs-card gcs-sideCard" aria-labelledby="gcs-side-online" data-testid="gcs-who-online">
      <h2 id="gcs-side-online" className="gcs-display gcs-sideCard__title">
        {labels.title}
      </h2>
      <p className="gcs-sideCard__line" data-testid="gcs-online-summary">
        {summary}
      </p>
      {view.members.length === 0 ? (
        <p className="gcs-sideCard__line gcs-muted">{labels.nobody}</p>
      ) : (
        <p className="gcs-onlineList" data-testid="gcs-online-members">
          {view.members.map((m, i) => (
            <span key={m.id}>
              <GcsUserLink userId={m.id} name={m.name} nameKey={m.nameKey} href={memberHref(m)} />
              {i < view.members.length - 1 ? ", " : ""}
            </span>
          ))}
        </p>
      )}
      {view.record && (
        <p className="gcs-sideCard__line gcs-muted" style={{ fontSize: 12 }} suppressHydrationWarning>
          {labels.record
            .replace("{count}", String(view.record.count))
            .replace("{date}", new Date(view.record.at).toLocaleDateString(locale === "en" ? "en-GB" : "ro-RO", { dateStyle: "medium" }))}
        </p>
      )}
    </section>
  );
}
