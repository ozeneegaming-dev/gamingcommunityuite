"use client";

import { faBell } from "@fortawesome/free-regular-svg-icons";
import { GcsAvatar, GcsIconSvg, GcsNamedText } from "@gcs/ui";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { loadChatNotifications, markChatNotificationsRead, type GcsChatNotificationItem } from "../../chat-pro-actions";
import { useDismiss } from "../chat/use-dismiss";

type Tab = "all" | "mentions";

/**
 * Notificările chat-ului (antetul Chat Pro): un panou cu tab-urile „Toate” (mențiuni și răspunsuri) și „Mențiuni”.
 * Punctul de pe clopoțel arată notificări necitite; deschiderea panoului le marchează citite. `bump` (o mențiune
 * primită live) reîncarcă lista.
 */
export function GcsChatProNotifications({ bump }: { bump: number }) {
  const t = useTranslations("chatPro.notifications");
  const format = useFormatter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const [items, setItems] = useState<GcsChatNotificationItem[] | null>(null);
  const [unread, setUnread] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, panel, close, trigger);

  const load = useCallback(async (which: Tab) => {
    const res = await loadChatNotifications({ tab: which });
    if (!res.ok) return [];
    setItems(res.data);
    return res.data;
  }, []);

  // Punctul de necitite: la încărcare și după o mențiune primită live.
  useEffect(() => {
    void loadChatNotifications({ tab: "all" }).then((res) => res.ok && setUnread(res.data.some((n) => !n.read)));
  }, [bump]);

  useEffect(() => {
    if (!open) return;
    void load(tab).then((list) => {
      const ids = list.filter((n) => !n.read).map((n) => n.id);
      if (ids.length > 0) void markChatNotificationsRead({ ids }).then(() => setUnread(false));
    });
  }, [open, tab, load]);

  return (
    <span className="gcs-chatPro__popWrap">
      <button
        ref={trigger}
        type="button"
        className="gcs-chat__headButton"
        aria-label={t("open")}
        title={t("open")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        data-testid="gcs-chatpro-notifications"
      >
        <GcsIconSvg icon={faBell} />
        {unread && <span className="gcs-chatPro__dot" aria-label={t("unread")} />}
      </button>
      {open && (
        <div ref={panel} id={id} className="gcs-chatPro__pop gcs-chatPro__notif" role="dialog" aria-label={t("title")} data-testid="gcs-chatpro-notifications-panel">
          <div className="gcs-chatPro__tabs" role="tablist" aria-label={t("title")}>
            {(["all", "mentions"] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className="gcs-chatPro__tab" onClick={() => setTab(k)}>
                {t(k)}
              </button>
            ))}
          </div>
          {items === null ? (
            <p className="gcs-chatPro__empty">{t("loading")}</p>
          ) : items.length === 0 ? (
            <p className="gcs-chatPro__empty">{t("empty")}</p>
          ) : (
            <ul className="gcs-chatPro__notifList">
              {items.map((n) => (
                <li key={n.id} className={n.read ? undefined : "gcs-chatPro__notifItem--unread"}>
                  <a href={n.href} className="gcs-chatPro__notifItem">
                    {n.actor ? <GcsAvatar name={n.actor.name} userId={n.actor.id} src={n.actor.image ?? undefined} size="s" /> : <span className="gcs-avatar gcs-avatar--s" />}
                    <span>
                      <strong>
                        <GcsNamedText text={t(`types.${n.type === "chat_pro.reply" ? "reply" : "mention"}`, { name: n.actor?.name ?? "—", room: n.title })} user={n.actor} />
                      </strong>
                      {n.snippet && <span className="gcs-chatPro__notifSnippet">{n.snippet}</span>}
                      <time dateTime={n.at}>{format.relativeTime(new Date(n.at))}</time>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </span>
  );
}
