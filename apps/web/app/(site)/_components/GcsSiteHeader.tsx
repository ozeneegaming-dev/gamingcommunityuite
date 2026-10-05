import { GcsAvatar, GcsButton, GcsUserLink } from "@gcs/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsLogoutButton } from "./GcsLogoutButton";

/** Header-ul site-ului, după macheta `Main` (logo, meniu principal, zona userului). */
export async function GcsSiteHeader() {
  const t = await getTranslations("site");
  const { db, permissions } = services();
  const actor = await currentActor();
  const user = actor.userId
    ? await db.user.findUnique({
        where: { id: actor.userId },
        select: { id: true, name: true, image: true, primaryGroup: { select: { key: true } } },
      })
    : null;
  const canAcp = user ? await permissions.can(actor, "acp.access") : false;

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
              <span
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px", minHeight: 44, boxSizing: "border-box" }}
              >
                <GcsAvatar name={user.name} size="s" {...(user.image ? { src: user.image } : {})} />
                <GcsUserLink
                  userId={user.id}
                  name={user.name}
                  groupKey={user.primaryGroup.key}
                  href={`/members/${user.id}`}
                  data-testid="gcs-header-user"
                />
              </span>
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
