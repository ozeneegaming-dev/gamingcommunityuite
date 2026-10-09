import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { memberHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { playtimeText } from "../../_components/servers/GcsBridgeBits";
import { isBridgeGameKey } from "../../_components/servers/types";
import { GcsMemberLink } from "@/lib/member-names";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("bridge.admins"))("title") };
}

export const dynamic = "force-dynamic";

/**
 * `/servers/admins` (specul 2026-10-08-servere-pagini §6): adminii serverelor vizibile, cu prezența: online acum (serverul,
 * de când), văzut în 24 h / 7 zile, timpul de joc pe 24 h / 7 / 30 de zile, ultima apariție, acțiunile din joc și
 * tichetele tratate, „Inactiv” după setarea ACP. Cei online primii.
 */
export default async function ServerAdminsPage({ searchParams }: { searchParams: Promise<{ server?: string }> }) {
  const { serverQueries, bridge } = services();
  if (!(await serverQueries.appEnabled())) notFound();
  const [sp, actor, t, td, format] = await Promise.all([searchParams, currentActor(), getTranslations("bridge.admins"), getTranslations("bridge.duration"), getFormatter()]);
  const servers = (await serverQueries.list(actor)).filter((s) => isBridgeGameKey(s.game.key));
  const serverId = /^\d{1,9}$/.test(sp.server ?? "") && servers.some((s) => s.id === Number(sp.server)) ? Number(sp.server) : null;
  const list = await bridge.queries.adminPresence(actor, serverId ? { serverId } : {});
  if (!list) notFound();
  const rows = [...list].sort((a, b) => Number(b.online !== null) - Number(a.online !== null) || (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? "") || a.name.localeCompare(b.name));
  const online = rows.filter((a) => a.online).length;
  const seen = rows.filter((a) => a.seen24h).length;
  const hours = (sec: number) => playtimeText(sec, td);

  return (
    <>
      <header className="gcs-pageHeader">
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title">
            <GcsIcon name="fa-solid fa-user-shield" className="gcs-hIcon" />
            {t("title")}
          </h1>
          <p className="gcs-pageHeader__desc" data-testid="gcs-admins-summary">
            {t("summary", { online, seen, total: rows.length })}
          </p>
        </div>
      </header>
      {servers.length > 1 && (
        <nav className="gcs-segLinks" aria-label={t("serverFilter")}>
          <Link href="/servers/admins" className={`gcs-segLink${serverId === null ? " gcs-segLink--active" : ""}`} aria-current={serverId === null ? "page" : undefined}>
            {t("allServers")}
          </Link>
          {servers.map((s) => (
            <Link key={s.id} href={`/servers/admins?server=${s.id}`} className={`gcs-segLink${serverId === s.id ? " gcs-segLink--active" : ""}`} aria-current={serverId === s.id ? "page" : undefined}>
              {s.name}
            </Link>
          ))}
        </nav>
      )}
      {rows.length === 0 ? (
        <GcsCard>
          <p className="gcs-emptyState" data-testid="gcs-admins-empty">
            <GcsIcon name="fa-solid fa-user-shield" className="gcs-emptyIcon" />
            {t("empty")}
          </p>
        </GcsCard>
      ) : (
        <ul className="gcs-presenceGrid" data-testid="gcs-admins-list">
          {rows.map((a) => (
            <li key={a.id} className="gcs-card gcs-presenceCard" data-online={a.online ? "" : undefined} data-inactive={a.inactive ? "" : undefined} data-testid="gcs-admin-card">
              <header className="gcs-titleBand gcs-presenceCard__head">
                <span className="gcs-presenceCard__state" data-state={a.online ? "online" : a.seen24h ? "recent" : "away"}>
                  <span className="gcs-dot" aria-hidden="true" />
                  {a.online ? t("online") : a.seen24h ? t("seen24h") : a.seen7d ? t("seen7d") : a.inactive ? t("inactive") : t("away")}
                </span>
                <h2 className="gcs-display gcs-presenceCard__name">{a.user ? <GcsMemberLink user={a.user} label={a.name} size="full" /> : a.name}</h2>
                <span className="gcs-presenceCard__role">
                  {a.label ?? <code>{a.flags}</code>}
                  <span className="gcs-presenceCard__where">{a.server ? a.server.name : t("allServersShort")}</span>
                </span>
              </header>
              {a.online && (
                <p className="gcs-presenceCard__now" data-testid="gcs-admin-online">
                  <GcsIcon name="fa-solid fa-gamepad" className="gcs-hIcon" />
                  {a.online.since ? t("playingSince", { server: a.online.serverName, time: format.relativeTime(new Date(a.online.since)) }) : t("playingOn", { server: a.online.serverName })}
                </p>
              )}
              <dl className="gcs-presenceCard__stats">
                <div>
                  <dt>{t("playtime24")}</dt>
                  <dd>{hours(a.playtime.d1)}</dd>
                </div>
                <div>
                  <dt>{t("playtime7")}</dt>
                  <dd>{hours(a.playtime.d7)}</dd>
                </div>
                <div>
                  <dt>{t("playtime30")}</dt>
                  <dd>{hours(a.playtime.d30)}</dd>
                </div>
                <div>
                  <dt>{t("actions")}</dt>
                  <dd>{t("actionsValue", { d7: a.actions.d7, d30: a.actions.d30 })}</dd>
                </div>
                <div>
                  <dt>{t("tickets")}</dt>
                  <dd>{a.ticketsHandled30}</dd>
                </div>
                <div>
                  <dt>{t("lastSeen")}</dt>
                  <dd>{a.online ? t("now") : a.lastSeenAt ? format.relativeTime(new Date(a.lastSeenAt)) : t("never")}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
