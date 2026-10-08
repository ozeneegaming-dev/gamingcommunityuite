import { BRIDGE_PERMISSION, type GcsSanctionView } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { pageParam } from "@/lib/forum-page";
import { services } from "@/lib/services";
import { GcsPagination } from "../_components/forum/GcsPagination";
import { GcsPlayerLink, GcsSanctionStatus, GcsSanctionType } from "../_components/servers/GcsBridgeBits";
import { GcsSanctionTime } from "../_components/servers/GcsSanctionTime";
import { isBridgeGameKey, sanctionHref } from "../_components/servers/types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("bridge.bans"))("title") };
}

export const dynamic = "force-dynamic";

const STATUSES = ["all", "active", "expired", "lifted"] as const;
const TYPES = ["BAN", "MUTE", "GAG"] as const;
type Status = (typeof STATUSES)[number];
type Type = (typeof TYPES)[number];
type Search = { q?: string; server?: string; status?: string; type?: string; page?: string };

/**
 * `/bans` (specul 2026-10-08-servere-pagini §4): bannurile și comunicațiile (mute / gag) ale serverelor, cu căutarea
 * (nume, SteamID, ID non-Steam, motiv; IP doar cu `servers.view_ips`) și filtrele pe server (sau doar cele globale),
 * stare și tip. Filtrele sunt linkuri și un formular GET: merg și fără JavaScript.
 */
export default async function BansPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { serverQueries, bridge, permissions } = services();
  if (!(await serverQueries.appEnabled())) notFound();
  const [sp, actor, t, format] = await Promise.all([searchParams, currentActor(), getTranslations("bridge.bans"), getFormatter()]);
  if (actor.isBanned || !(await permissions.can(actor, BRIDGE_PERMISSION.bansView))) notFound();
  const [servers, canIps, abilities] = await Promise.all([serverQueries.list(actor), permissions.can(actor, BRIDGE_PERMISSION.viewIps), bridge.sanctions.abilities(actor)]);
  const bridgeServers = servers.filter((s) => isBridgeGameKey(s.game.key));
  const status: Status = STATUSES.includes(sp.status as Status) ? (sp.status as Status) : "all";
  const type: Type | null = TYPES.includes(sp.type as Type) ? (sp.type as Type) : null;
  const global = sp.server === "global";
  const serverId = !global && /^\d{1,9}$/.test(sp.server ?? "") && bridgeServers.some((s) => s.id === Number(sp.server)) ? Number(sp.server) : null;
  const q = (sp.q ?? "").trim().slice(0, 64);
  const list = await bridge.sanctions.list(actor, {
    status,
    ...(type ? { type } : {}),
    ...(global ? { scope: "GLOBAL" as const } : {}),
    ...(serverId ? { serverId } : {}),
    ...(q ? { q } : {}),
    page: pageParam(sp.page),
  });
  const href = (patch: Partial<Record<keyof Search, string | null>>) => {
    const params = new URLSearchParams();
    const merged = { q: q || null, server: global ? "global" : serverId ? String(serverId) : null, status: status === "all" ? null : status, type, page: null, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/bans?${qs}` : "/bans";
  };
  const canCreate = abilities.staff || abilities.grants.length > 0;
  const now = Date.now();

  const target = (s: GcsSanctionView) => (
    <span className="gcs-banTarget">
      {s.player ? <GcsPlayerLink player={s.player} /> : <span className="gcs-banTarget__name">{s.name ?? t("unknownPlayer")}</span>}
      {s.target.value && s.target.kind !== "NAME" && <code className="gcs-identity__id">{s.target.value}</code>}
      {s.ip && <code className="gcs-identity__id gcs-banTarget__ip">{s.ip}</code>}
    </span>
  );

  return (
    <>
      <header className="gcs-pageHeader">
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title">
            <GcsIcon name="fa-solid fa-gavel" className="gcs-hIcon" />
            {t("title")}
          </h1>
          <p className="gcs-pageHeader__desc" data-testid="gcs-bans-count">
            {t("lead", { count: list.total })}
          </p>
        </div>
        {canCreate && (
          <div className="gcs-pageHeader__actions">
            <Link href="/bans/new" className="gcs-btn gcs-btn--primary" data-testid="gcs-sanction-new">
              <GcsIcon name="fa-solid fa-plus" />
              {t("create")}
            </Link>
          </div>
        )}
      </header>

      <form method="get" action="/bans" className="gcs-banSearch" role="search" aria-label={t("searchLabel")}>
        <label className="gcs-field gcs-banSearch__q">
          <span>{t("search")}</span>
          <input className="gcs-input" type="search" name="q" defaultValue={q} maxLength={64} placeholder={canIps ? t("searchPlaceholderIp") : t("searchPlaceholder")} data-testid="gcs-bans-q" />
        </label>
        <label className="gcs-field">
          <span>{t("server")}</span>
          <select className="gcs-input" name="server" defaultValue={global ? "global" : (serverId ?? "")} data-testid="gcs-bans-server">
            <option value="">{t("allServers")}</option>
            <option value="global">{t("globalOnly")}</option>
            {bridgeServers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {status !== "all" && <input type="hidden" name="status" value={status} />}
        {type && <input type="hidden" name="type" value={type} />}
        <button type="submit" className="gcs-btn gcs-btn--ghost">
          <GcsIcon name="fa-solid fa-magnifying-glass" />
          {t("searchSubmit")}
        </button>
      </form>

      <div className="gcs-pageControls">
        <nav className="gcs-segLinks" aria-label={t("statusFilter")} data-testid="gcs-bans-status">
          {STATUSES.map((s) => (
            <Link key={s} href={href({ status: s === "all" ? null : s })} className={`gcs-segLink${s === status ? " gcs-segLink--active" : ""}`} aria-current={s === status ? "page" : undefined}>
              {t(`statuses.${s}`)}
            </Link>
          ))}
        </nav>
        <nav className="gcs-segLinks" aria-label={t("typeFilter")} data-testid="gcs-bans-type">
          <Link href={href({ type: null })} className={`gcs-segLink${type === null ? " gcs-segLink--active" : ""}`} aria-current={type === null ? "page" : undefined}>
            {t("allTypes")}
          </Link>
          {TYPES.map((k) => (
            <Link key={k} href={href({ type: k })} className={`gcs-segLink${k === type ? " gcs-segLink--active" : ""}`} aria-current={k === type ? "page" : undefined}>
              {t(`types.${k}`)}
            </Link>
          ))}
        </nav>
      </div>

      <GcsCard as="section" className="gcs-banBoard" aria-label={t("title")}>
        {list.items.length === 0 ? (
          <p className="gcs-emptyState" data-testid="gcs-bans-empty">
            <GcsIcon name="fa-regular fa-circle-check" className="gcs-emptyIcon" />
            {q || type || serverId || global || status !== "all" ? t("emptyFilter") : t("empty")}
          </p>
        ) : (
          <table className="gcs-banTable" data-testid="gcs-bans-table">
            <thead>
              <tr>
                <th scope="col">{t("col.type")}</th>
                <th scope="col">{t("col.player")}</th>
                <th scope="col">{t("col.reason")}</th>
                <th scope="col">{t("col.scope")}</th>
                <th scope="col">{t("col.admin")}</th>
                <th scope="col">{t("col.time")}</th>
                <th scope="col">{t("col.status")}</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((s) => (
                <tr key={s.id} data-status={s.status} data-testid="gcs-ban-row" data-sanction={s.id}>
                  <td data-label={t("col.type")}>
                    <GcsSanctionType type={s.type} />
                  </td>
                  <td data-label={t("col.player")}>{target(s)}</td>
                  <td data-label={t("col.reason")} className="gcs-banTable__reason">
                    <Link href={sanctionHref(s.id)}>{s.reason}</Link>
                  </td>
                  <td data-label={t("col.scope")}>{s.scope === "GLOBAL" ? <span className="gcs-banScope gcs-banScope--global">{t("global")}</span> : (s.server?.name ?? "—")}</td>
                  <td data-label={t("col.admin")}>{s.admin.name}</td>
                  <td data-label={t("col.time")}>
                    <GcsSanctionTime sanction={s} now={now} />
                    <span className="gcs-banTable__date">{format.dateTime(new Date(s.createdAt), { dateStyle: "medium" })}</span>
                  </td>
                  <td data-label={t("col.status")}>
                    <GcsSanctionStatus status={s.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </GcsCard>
      <GcsPagination pagination={{ page: list.page, pages: list.pages, perPage: 50, total: list.total }} href={(p) => href({ page: p > 1 ? String(p) : null })} />
    </>
  );
}
