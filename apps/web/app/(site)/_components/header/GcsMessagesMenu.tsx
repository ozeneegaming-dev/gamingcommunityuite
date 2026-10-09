"use client";

import { faArrowRight, faEnvelope, faPenToSquare, faSpinner } from "@fortawesome/free-solid-svg-icons";
import { GcsAvatar, GcsIconSvg, GcsUserLink } from "@gcs/ui";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useState } from "react";
import { memberHref } from "@/lib/forum-urls";
import { useRealtime } from "../realtime/GcsRealtimeProvider";
import { useHeaderPopover } from "./GcsHeaderPopover";
import { useHeaderState } from "./header-context";

type Conversation = {
  id: number;
  title: string;
  href: string;
  unread: boolean;
  at: string;
  snippet: string;
  user: { id: string; name: string; nameKey: string; image: string | null; frameKey: string | null } | null;
};

const badge = (n: number) => (n > 99 ? "99+" : String(n));

/**
 * „Mesaje” din antet (specul 2026-10-10-hero-cockpit §1): numărul de necitite (live, evenimentul `pm`) și un dropdown
 * cu ultimele conversații (cerute la deschidere): avatarul, numele stilizat, titlul și extrasul ultimului mesaj.
 */
export function GcsMessagesMenu({ initialUnread }: { initialUnread: number }) {
  const t = useTranslations("header.messages");
  const format = useFormatter();
  const realtime = useRealtime();
  const { dropdowns } = useHeaderState();
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<Conversation[] | null>(null);
  const load = () => {
    void fetch("/api/header/messages", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { unread: number; items: Conversation[] } | null) => {
        if (!d) return;
        setUnread(d.unread);
        setItems(d.items);
      })
      .catch(() => setItems([]));
  };
  const pop = useHeaderPopover({ mode: dropdowns, onOpen: load });

  useEffect(() => setUnread(initialUnread), [initialUnread]);
  useEffect(
    () =>
      realtime.on("pm", (data) => {
        const n = (data as { unread?: unknown } | null)?.unread;
        if (typeof n === "number") setUnread(n);
        setItems(null);
      }),
    [realtime],
  );

  return (
    <div className="gcs-hb__pop gcs-msgMenu" {...pop.rootProps}>
      <button {...pop.triggerProps} className="gcs-hb__sq" aria-label={unread > 0 ? t("unread", { count: unread }) : t("label")} data-testid="gcs-header-messages">
        <GcsIconSvg icon={faEnvelope} />
        {unread > 0 && (
          <span className="gcs-hb__count" data-testid="gcs-header-unread">
            {badge(unread)}
          </span>
        )}
      </button>
      {pop.mounted && (
        <div {...pop.panelProps} role="dialog" aria-label={t("label")} className="gcs-hb__panel gcs-msgMenu__panel" data-testid="gcs-messages-panel">
          <div className="gcs-hb__panelHead">
            <strong>{t("label")}</strong>
            <Link href="/messages/new" className="gcs-hb__panelAction" onClick={() => pop.close(false)}>
              <GcsIconSvg icon={faPenToSquare} />
              {t("new")}
            </Link>
          </div>
          {items === null ? (
            <p className="gcs-hb__panelNote" aria-busy="true">
              <GcsIconSvg icon={faSpinner} className="gcs-spin" />
            </p>
          ) : items.length === 0 ? (
            <p className="gcs-hb__panelNote">{t("empty")}</p>
          ) : (
            <ul className="gcs-msgMenu__list">
              {items.map((c) => (
                <li key={c.id} className={`gcs-msgMenu__item${c.unread ? " gcs-msgMenu__item--unread" : ""}`} data-testid="gcs-messages-item">
                  {c.user && <GcsAvatar name={c.user.name} size="s" userId={c.user.id} {...(c.user.image ? { src: c.user.image } : {})} {...(c.user.frameKey ? { frame: c.user.frameKey } : {})} />}
                  <span className="gcs-msgMenu__text">
                    <span className="gcs-msgMenu__line">
                      {c.user && <GcsUserLink userId={c.user.id} name={c.user.name} nameKey={c.user.nameKey} href={memberHref(c.user)} />}
                      <time className="gcs-msgMenu__time" dateTime={c.at}>
                        {format.relativeTime(new Date(c.at))}
                      </time>
                    </span>
                    <Link href={c.href} className="gcs-msgMenu__title" onClick={() => pop.close(false)}>
                      {c.title}
                    </Link>
                    {c.snippet && <span className="gcs-msgMenu__snippet">{c.snippet}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/messages" className="gcs-hb__panelFoot gcs-arrowLink" onClick={() => pop.close(false)}>
            {t("seeAll")}
            <GcsIconSvg icon={faArrowRight} className="gcs-arrow" />
          </Link>
        </div>
      )}
    </div>
  );
}
