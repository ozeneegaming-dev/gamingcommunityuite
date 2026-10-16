"use client";

import { faBellSlash, faEnvelope, faEnvelopeOpen } from "@fortawesome/free-regular-svg-icons";
import { faBell, faCheckDouble, faStar, faTrash, faTrashCan, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { GcsAvatar, GcsButton, GcsIconSvg, GcsModal, GcsNamedText } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition, type ReactNode } from "react";
import type { GcsNotificationItem } from "@/lib/notifications";
import { deleteNotifications, markNotificationsRead, markNotificationUnread } from "../../notification-actions";

export type GcsNotificationSection = "today" | "yesterday" | "week" | "older";
/** Un rând al paginii, cu ziua (secțiunea) și ora relativă calculate pe server (fără diferențe la hidratare). */
export type GcsNotificationRow = GcsNotificationItem & { section: GcsNotificationSection; when: string; whenTitle: string };

/**
 * Lista paginii `/notifications` (Notificări v2): notificările pe zile (Azi, Ieri, Săptămâna aceasta, Mai vechi), fiecare
 * cu avatarele ultimilor actori (gruparea „Ana și alți 3”), textul cu numele stilizat, extrasul, ora și acțiunile ei
 * (citită / necitită, șterge). Sus: „Marchează toate citite” și „Șterge citite” (confirmare în pagină) pe tabul curent.
 */
export function GcsNotificationList({ items, tab, icons, hasUnread, emptyText }: { items: GcsNotificationRow[]; tab: string; icons: Record<string, ReactNode>; hasUnread: boolean; emptyText: string }) {
  const t = useTranslations("notifications");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      router.refresh();
    });

  const sections: { key: GcsNotificationSection; rows: GcsNotificationRow[] }[] = [];
  for (const item of items) {
    const key = item.section;
    const last = sections[sections.length - 1];
    if (last?.key === key) last.rows.push(item);
    else sections.push({ key, rows: [item] });
  }

  return (
    <section className="gcs-notifPage" aria-busy={pending || undefined}>
      <div className="gcs-notifPage__actions">
        <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faCheckDouble} />} disabled={pending || !hasUnread} onClick={() => run(() => markNotificationsRead({ ids: "all", tab }))} data-testid="gcs-notif-page-mark-all">
          {t("markAll")}
        </GcsButton>
        <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faTrashCan} />} disabled={pending || items.every((i) => !i.read)} onClick={() => setConfirm(true)} data-testid="gcs-notif-page-delete-read">
          {t("deleteRead")}
        </GcsButton>
      </div>
      {items.length === 0 ? (
        <p className="gcs-notifPage__empty">
          <GcsIconSvg icon={faBellSlash} className="gcs-emptyIcon" />
          {emptyText}
        </p>
      ) : (
        sections.map((s) => (
          <div key={s.key} className="gcs-notifPage__section">
            <h2 className="gcs-notifPage__day">{t(`sections.${s.key}`)}</h2>
            <ul className="gcs-notifList" data-testid="gcs-notif-list">
              {s.rows.map((n) => (
                <li key={n.id} className={`gcs-notifRow gcs-notifRow--page${n.read ? "" : " gcs-notifRow--unread"}${n.important ? " gcs-notifRow--important" : ""}`} data-testid="gcs-notif-row">
                  <span className="gcs-notifRow__lead" aria-hidden="true">
                    {n.actors.length > 0 ? (
                      <span className="gcs-notifRow__stack">
                        {n.actors.slice(0, 3).map((a) => (
                          <GcsAvatar key={a.id} name={a.name} size="xs" userId={a.id} {...(a.image ? { src: a.image } : {})} />
                        ))}
                      </span>
                    ) : (
                      <span className="gcs-notifRow__icon">{icons[n.icon] ?? <GcsIconSvg icon={faBell} />}</span>
                    )}
                  </span>
                  <span className="gcs-notifRow__main">
                    <a href={`/notifications/${n.id}`} className="gcs-notifRow__link">
                      <span className="gcs-notifRow__text">
                        <GcsNamedText text={n.text} user={n.actor} />
                      </span>
                    </a>
                    {n.snippet && <span className="gcs-notifRow__snippet">{n.snippet}</span>}
                    <span className="gcs-notifRow__meta">
                      {n.important && (
                        <span className="gcs-notifRow__flag">
                          <GcsIconSvg icon={faStar} />
                          {t("important")}
                        </span>
                      )}
                      <time className="gcs-notifRow__time" dateTime={n.updatedAt} title={n.whenTitle}>
                        {n.when}
                      </time>
                    </span>
                  </span>
                  <span className="gcs-notifRow__tools">
                    <button
                      type="button"
                      className="gcs-iconBtn gcs-notifRow__tool"
                      aria-label={n.read ? t("markUnread") : t("markRead")}
                      title={n.read ? t("markUnread") : t("markRead")}
                      disabled={pending}
                      onClick={() => run(() => (n.read ? markNotificationUnread({ id: n.id }) : markNotificationsRead({ ids: [n.id] })))}
                      data-testid="gcs-notif-row-toggle"
                    >
                      <GcsIconSvg icon={n.read ? faEnvelope : faEnvelopeOpen} />
                    </button>
                    <button
                      type="button"
                      className="gcs-iconBtn gcs-notifRow__tool gcs-notifRow__tool--danger"
                      aria-label={t("delete")}
                      title={t("delete")}
                      disabled={pending}
                      onClick={() => run(() => deleteNotifications({ which: [n.id] }))}
                      data-testid="gcs-notif-row-delete"
                    >
                      <GcsIconSvg icon={faTrash} />
                    </button>
                  </span>
                  {!n.read && (
                    <span className="gcs-notifRow__dot">
                      <span className="gcs-srOnly">{t("unread")}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      {confirm && (
        <GcsModal title={t("deleteRead")} icon={<GcsIconSvg icon={faTriangleExclamation} />} size="sm" closeLabel={t("cancel")} onClose={() => setConfirm(false)}>
          <div className="gcs-confirmDialog" data-testid="gcs-confirm-dialog">
            <div className="gcs-confirmDialog__text">{t("deleteReadConfirm")}</div>
            <div className="gcs-confirmDialog__actions">
              <GcsButton variant="ghost" onClick={() => setConfirm(false)} data-testid="gcs-confirm-cancel">
                {t("cancel")}
              </GcsButton>
              <GcsButton
                variant="primary"
                className="gcs-btn--danger"
                icon={<GcsIconSvg icon={faTrashCan} />}
                disabled={pending}
                onClick={() => {
                  setConfirm(false);
                  run(() => deleteNotifications({ which: "read", tab }));
                }}
                data-testid="gcs-confirm-ok"
              >
                {t("deleteRead")}
              </GcsButton>
            </div>
          </div>
        </GcsModal>
      )}
    </section>
  );
}
