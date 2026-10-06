"use client";

import { GcsUserLink } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import type { GcsOnlineView } from "@/lib/online";
import { memberHref } from "@/lib/forum-urls";

const REFRESH_MS = 60_000;

type Labels = { title: string; summary: string; record: string; nobody: string };

type Props = {
  initial: GcsOnlineView;
  labels: Labels;
  locale: string;
  /** Titlul randat pe server (ex. `GcsWidgetTitle` cu iconița); lipsă = titlul simplu din `labels`. */
  heading?: ReactNode;
  /** `id`-ul titlului (unic pe pagină: widget-ul și panoul pot apărea împreună). */
  headingId?: string;
  /** `side` = cardul din coloană; `panel` = blocul din panoul de statistici (sumar cu puncte, listă, buton). */
  variant?: "side" | "panel";
  /** Butonul din dreapta blocului din panou („Vezi lista completă”), randat pe server. */
  action?: ReactNode;
};

/** Lista numelor online, în stilul grupului fiecăruia. */
function NameList({ view, className }: { view: GcsOnlineView; className: string }) {
  return (
    <p className={className} data-testid="gcs-online-members">
      {view.members.map((m, i) => (
        <span key={m.id}>
          <GcsUserLink userId={m.id} name={m.name} nameKey={m.nameKey} href={memberHref(m)} />
          {i < view.members.length - 1 ? ", " : ""}
        </span>
      ))}
    </p>
  );
}

/**
 * „Cine e online”: datele inițiale vin de pe server, apoi se reîmprospătează la 60 s. În coloana paginii e un card;
 * în panoul de statistici e blocul cu bordură albastră (sumar, lista utilizatorilor conectați și butonul listei).
 */
export function GcsWhoIsOnline({ initial, labels, locale, heading, headingId = "gcs-side-online", variant = "side", action }: Props) {
  const [view, setView] = useState(initial);
  const t = useTranslations("stats.panel");

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

  if (variant === "panel") {
    return (
      <section className="gcs-onlineBlock gcs-onlineBlock--now" aria-labelledby={headingId} data-testid="gcs-who-online">
        <div className="gcs-onlineBlock__info">
          {heading ?? (
            <h3 id={headingId} className="gcs-onlineBlock__title">
              {labels.title}
            </h3>
          )}
          <p className="gcs-onlineBlock__summary" data-testid="gcs-online-summary">
            {t("onlineTotal", { count: membersCount + view.guests })}
          </p>
          <ul className="gcs-onlineBlock__dots">
            <li data-dot="members">{t("members", { count: view.members.length })}</li>
            <li data-dot="anonymous">{t("anonymous", { count: view.hidden })}</li>
            <li data-dot="guests">{t("guests", { count: view.guests })}</li>
          </ul>
        </div>
        <div className="gcs-onlineBlock__list">
          <p className="gcs-onlineBlock__listTitle">{t("onlineList")}</p>
          {view.members.length === 0 ? <p className="gcs-onlineBlock__empty">{labels.nobody}</p> : <NameList view={view} className="gcs-onlineBlock__names" />}
        </div>
        {action && <div className="gcs-onlineBlock__action">{action}</div>}
      </section>
    );
  }

  const summary = labels.summary.replace("{members}", String(membersCount)).replace("{guests}", String(view.guests));
  return (
    <section className="gcs-card gcs-sideCard gcs-widget" aria-labelledby={headingId} data-widget="core.online" data-testid="gcs-who-online">
      {heading ?? (
        <h2 id={headingId} className="gcs-display gcs-sideCard__title">
          {labels.title}
        </h2>
      )}
      <p className="gcs-sideCard__line" data-testid="gcs-online-summary">
        {summary}
      </p>
      {view.members.length === 0 ? <p className="gcs-sideCard__line gcs-muted">{labels.nobody}</p> : <NameList view={view} className="gcs-onlineList" />}
      {view.record && (
        <p className="gcs-sideCard__line gcs-muted gcs-onlineRecord" suppressHydrationWarning>
          {labels.record
            .replace("{count}", String(view.record.count))
            .replace("{date}", new Date(view.record.at).toLocaleDateString(locale === "en" ? "en-GB" : "ro-RO", { dateStyle: "medium" }))}
        </p>
      )}
    </section>
  );
}
