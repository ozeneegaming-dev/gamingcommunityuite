"use client";

import { GcsAvatar, GcsMemberName } from "@gcs/ui";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onlinePreview } from "@/lib/home-widgets";
import type { GcsOnlineView } from "@/lib/online";
import { memberHref } from "@/lib/forum-urls";
import { GcsCollapseToggle } from "../GcsCollapseToggle";

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
  /** Cardul din coloană: săgeata de restrângere (cheia alegerii din browser, ca la celelalte widget-uri). */
  collapseKey?: string;
};

/** Cine e online acum (datele reîmprospătate), pentru sumarul din dreapta titlului cardului. */
const OnlineContext = createContext<GcsOnlineView | null>(null);

/**
 * Sumarul din dreapta titlului cardului („14 membri · 22 vizitatori”), actualizat odată cu lista; titlul vine randat
 * de pe server (`GcsWidgetTitle`), iar sumarul ia datele din cardul în care stă.
 */
export function GcsOnlineSummary({ template }: { template: string }) {
  const view = useContext(OnlineContext);
  if (!view) return null;
  return (
    <span data-testid="gcs-online-summary">
      {template.replace("{members}", String(view.members.length + view.hidden)).replace("{guests}", String(view.guests))}
    </span>
  );
}

/** Câte nume și avatare arată cardul din coloană (restul: „și încă N”). */
const SIDE_PREVIEW = 5;

/** Lista numelor online, în stilul grupului fiecăruia. */
function NameList({ view, className }: { view: GcsOnlineView; className: string }) {
  return (
    <p className={className} data-testid="gcs-online-members">
      {view.members.map((m, i) => (
        <span key={m.id}>
          <GcsMemberName userId={m.id} name={m.name} nameKey={m.nameKey} href={memberHref(m)} />
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
export function GcsWhoIsOnline({ initial, labels, locale, heading, headingId = "gcs-side-online", variant = "side", action, collapseKey }: Props) {
  const [view, setView] = useState(initial);
  const t = useTranslations("stats.panel");
  const tw = useTranslations("widgets.home");

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

  // Cardul din coloană (prima pagină nouă): sumarul în dreapta titlului, avatarele primilor membri, numele lor în
  // culorile grupurilor și „și încă N” (spre lista completă a celor online).
  const { shown, more } = onlinePreview(view.members, membersCount, SIDE_PREVIEW);
  const summary = labels.summary.replace("{members}", String(membersCount)).replace("{guests}", String(view.guests));
  return (
    <OnlineContext.Provider value={view}>
      <section className="gcs-card gcs-sideCard gcs-widget" aria-labelledby={headingId} data-widget="core.online" data-testid="gcs-who-online">
        {heading ?? (
          <h2 id={headingId} className="gcs-display gcs-sideCard__title">
            {labels.title}
            <span className="gcs-widgetTitle__extra" data-testid="gcs-online-summary">
              {summary}
            </span>
          </h2>
        )}
        {collapseKey && <GcsCollapseToggle storageKey={collapseKey} title={labels.title} />}
        {view.members.length === 0 ? (
          <p className="gcs-sideCard__line gcs-muted">{labels.nobody}</p>
        ) : (
          <div className="gcs-onlineSide">
            <span className="gcs-onlineSide__stack" aria-hidden="true">
              {shown.map((m) => (
                <GcsAvatar key={m.id} name={m.name} size="xs" userId={m.id} {...(m.image ? { src: m.image } : {})} {...(m.frameKey ? { frame: m.frameKey } : {})} />
              ))}
            </span>
            <p className="gcs-onlineList gcs-onlineSide__names" data-testid="gcs-online-widget-members">
              {shown.map((m, i) => (
                <span key={m.id}>
                  <GcsMemberName userId={m.id} name={m.name} nameKey={m.nameKey} href={memberHref(m)} />
                  {i < shown.length - 1 ? ", " : ""}
                </span>
              ))}
              {more > 0 && (
                <>
                  {" "}
                  <Link href="/members?online=1" className="gcs-onlineSide__more">
                    {tw("more", { count: more })}
                  </Link>
                </>
              )}
            </p>
          </div>
        )}
        {view.record && (
          <p className="gcs-sideCard__line gcs-muted gcs-onlineRecord" suppressHydrationWarning>
            {labels.record
              .replace("{count}", String(view.record.count))
              .replace("{date}", new Date(view.record.at).toLocaleDateString(locale === "en" ? "en-GB" : "ro-RO", { dateStyle: "medium" }))}
          </p>
        )}
      </section>
    </OnlineContext.Provider>
  );
}
