import { GcsAvatar, GcsButton, GcsUserLink } from "@gcs/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { memberHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { GcsLogoutButton } from "./GcsLogoutButton";
import { GcsLiveCount, GcsNotificationBell } from "./notifications/GcsNotificationBell";

/** Header-ul site-ului, după macheta `Main` (logo, meniu principal, zona userului). */
export async function GcsSiteHeader() {
  const [t, tn] = await Promise.all([getTranslations("site"), getTranslations("notifications")]);
  const { permissions, profileQueries, conversations, notifications } = services();
  const actor = await currentActor();
  const user = actor.userId ? ((await profileQueries.userDisplays([actor.userId])).get(actor.userId) ?? null) : null;
  const [canAcp, unread, unreadNotifications] = user
    ? await Promise.all([permissions.can(actor, "acp.access"), conversations.unreadCount(actor.userId), notifications.unreadCount(actor.userId)])
    : [false, 0, 0];

  return (
    <header className="gcs-siteHeader" style={{ background: "#0F1116", borderBottom: "1px solid var(--gcs-border)" }}>
      <div
        style={{
          maxWidth: 1320,
          margin: "0 auto",
          padding: "10px 24px",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 16,
        }}
      >
        <Link href="/" aria-label={t("home")} style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--gcs-text)" }}>
          <span
            aria-hidden="true"
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              background: "var(--gcs-accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: "skewX(-12deg)",
            }}
          >
            <span className="gcs-display" style={{ fontWeight: 700, fontSize: 18, color: "#fff", transform: "skewX(12deg)" }}>
              R
            </span>
          </span>
          <span className="gcs-display" style={{ fontSize: 22, fontWeight: 700, letterSpacing: ".06em" }}>
            RED<span style={{ color: "var(--gcs-accentInk)" }}>-</span>LINE
          </span>
        </Link>

        <nav aria-label={t("mainNav")} style={{ display: "flex", flexWrap: "wrap", gap: 2, flex: "1 1 320px" }}>
          <Link href="/" className="gcs-nav__link gcs-nav__link--active">
            {t("nav.forum")}
          </Link>
          {user && (
            <Link href="/chat" className="gcs-nav__link">
              {t("nav.chat")}
            </Link>
          )}
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <form action="/search" method="get" role="search" className="gcs-siteSearch">
            <label htmlFor="gcs-site-search" className="gcs-srOnly">
              {t("searchLabel")}
            </label>
            <input id="gcs-site-search" name="q" type="search" placeholder={t("searchPlaceholder")} className="gcs-siteSearch__input" />
          </form>
          {user ? (
            <>
              {canAcp && (
                <GcsButton variant="ghost" asChild>
                  <Link href="/admin">{t("acp")}</Link>
                </GcsButton>
              )}
              <GcsNotificationBell
                initialUnread={unreadNotifications}
                labels={{ title: tn("title"), unread: tn.raw("unreadLabel") as string, empty: tn("empty"), markAll: tn("markAll"), seeAll: tn("seeAll") }}
              />
              <Link
                href="/messages"
                className="gcs-headerIcon"
                aria-label={unread > 0 ? t("messagesUnread", { count: unread }) : t("messages")}
                data-testid="gcs-header-messages"
              >
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="m3 7 9 6 9-6" />
                </svg>
                <GcsLiveCount initial={unread} event="pm" testId="gcs-header-unread" />
              </Link>
              <span
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px", minHeight: 44, boxSizing: "border-box" }}
              >
                <GcsAvatar name={user.name} size="s" {...(user.image ? { src: user.image } : {})} {...(user.frameKey ? { frame: user.frameKey } : {})} />
                <GcsUserLink userId={user.id} name={user.name} nameKey={user.nameKey} href={memberHref(user)} data-testid="gcs-header-user" />
              </span>
              <Link href="/settings/profile" className="gcs-headerIcon" aria-label={t("settings")} data-testid="gcs-header-settings">
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
                </svg>
              </Link>
              <GcsLogoutButton label={t("logout")} />
            </>
          ) : (
            <>
              <GcsButton variant="ghost" asChild>
                <Link href="/login">{t("login")}</Link>
              </GcsButton>
              <GcsButton variant="primary" asChild>
                <Link href="/register">{t("register")}</Link>
              </GcsButton>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
