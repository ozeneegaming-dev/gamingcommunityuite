import { BRIDGE_PERMISSION } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { pageParam } from "@/lib/forum-page";
import { services } from "@/lib/services";
import { GcsPagination } from "../../_components/forum/GcsPagination";
import { ticketPageHref } from "../../_components/servers/types";
import { GcsMemberLink } from "@/lib/member-names";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("bridge.tickets"))("title") };
}

export const dynamic = "force-dynamic";

const KINDS = ["APPEAL", "CHEATER", "ADMIN"] as const;
const STATUSES = ["open", "OPEN", "REVIEW", "ACCEPTED", "REJECTED", "CLOSED", "all"] as const;
type Kind = (typeof KINDS)[number];
type Status = (typeof STATUSES)[number];
type Search = { scope?: string; kind?: string; status?: string; page?: string };

/**
 * `/servers/tickets` (specul 2026-10-08-servere-pagini §5): tichetele mele și coada celor care tratează (staff-ul cu
 * `servers.tickets_manage` și adminii serverelor cu `d`), cu filtrele pe fel și stare și responsabilul.
 */
export default async function TicketsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { serverQueries, bridge, permissions } = services();
  if (!(await serverQueries.appEnabled())) notFound();
  const [sp, actor, t, format] = await Promise.all([searchParams, currentActor(), getTranslations("bridge.tickets"), getFormatter()]);
  if (!actor.userId) redirect("/login");
  if (actor.isBanned) notFound();
  const [manage, adminServers, canCreate] = await Promise.all([
    permissions.can(actor, BRIDGE_PERMISSION.ticketsManage),
    bridge.admins.userServers(actor.userId, "d"),
    permissions.can(actor, BRIDGE_PERMISSION.ticketsCreate),
  ]);
  const canHandle = manage || adminServers.length > 0;
  const scope = sp.scope === "handle" && canHandle ? "handle" : "mine";
  const kind: Kind | null = KINDS.includes(sp.kind as Kind) ? (sp.kind as Kind) : null;
  // Coada staff-ului arată implicit tichetele deschise; „ale mele”, toate.
  const defaultStatus: Status = scope === "handle" ? "open" : "all";
  const status: Status = STATUSES.includes(sp.status as Status) ? (sp.status as Status) : defaultStatus;
  const list = await bridge.tickets.list(actor, { scope, ...(kind ? { kind } : {}), ...(status !== "all" ? { status } : {}), page: pageParam(sp.page) });
  const href = (patch: Partial<Record<keyof Search, string | null>>) => {
    const params = new URLSearchParams();
    const merged: Record<string, string | null> = { scope: scope === "handle" ? "handle" : null, kind, status, page: null, ...patch };
    if (merged.status === defaultStatus) merged.status = null;
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/servers/tickets?${qs}` : "/servers/tickets";
  };

  return (
    <>
      <header className="gcs-pageHeader">
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title">
            <GcsIcon name="fa-solid fa-flag" className="gcs-hIcon" />
            {t("title")}
          </h1>
          <p className="gcs-pageHeader__desc">{t("lead")}</p>
        </div>
        {canCreate && (
          <div className="gcs-pageHeader__actions">
            <Link href="/servers/tickets/new" className="gcs-btn gcs-btn--primary" data-testid="gcs-ticket-new">
              <GcsIcon name="fa-solid fa-plus" />
              {t("create")}
            </Link>
          </div>
        )}
      </header>

      {canHandle && (
        <nav className="gcs-tabs gcs-tabs--bare" aria-label={t("scopeLabel")} data-testid="gcs-tickets-scope">
          {(["mine", "handle"] as const).map((s) => (
            <Link key={s} href={s === "handle" ? "/servers/tickets?scope=handle" : "/servers/tickets"} className={`gcs-tab${s === scope ? " gcs-tab--active" : ""}`} aria-current={s === scope ? "page" : undefined}>
              {t(`scopes.${s}`)}
            </Link>
          ))}
        </nav>
      )}

      <div className="gcs-pageControls">
        <nav className="gcs-segLinks" aria-label={t("kindFilter")}>
          <Link href={href({ kind: null })} className={`gcs-segLink${kind === null ? " gcs-segLink--active" : ""}`} aria-current={kind === null ? "page" : undefined}>
            {t("allKinds")}
          </Link>
          {KINDS.map((k) => (
            <Link key={k} href={href({ kind: k })} className={`gcs-segLink${k === kind ? " gcs-segLink--active" : ""}`} aria-current={k === kind ? "page" : undefined}>
              {t(`kinds.${k}`)}
            </Link>
          ))}
        </nav>
        <nav className="gcs-segLinks" aria-label={t("statusFilter")}>
          {(["open", "all", "ACCEPTED", "REJECTED", "CLOSED"] as const).map((s) => (
            <Link key={s} href={href({ status: s })} className={`gcs-segLink${s === status ? " gcs-segLink--active" : ""}`} aria-current={s === status ? "page" : undefined}>
              {t(`statuses.${s}`)}
            </Link>
          ))}
        </nav>
      </div>

      <GcsCard as="section" className="gcs-statBox" aria-label={t(`scopes.${scope}`)}>
        {list.items.length === 0 ? (
          <p className="gcs-emptyState" data-testid="gcs-tickets-empty">
            <GcsIcon name="fa-regular fa-folder-open" className="gcs-emptyIcon" />
            {scope === "handle" ? t("emptyHandle") : t("emptyMine")}
          </p>
        ) : (
          <ul className="gcs-ticketList" data-testid="gcs-ticket-list">
            {list.items.map((x) => (
              <li key={x.id} className="gcs-ticketList__row" data-status={x.status} data-testid="gcs-ticket-row">
                <span className="gcs-ticketKind" data-kind={x.kind}>
                  {t(`kinds.${x.kind}`)}
                </span>
                <span className="gcs-ticketList__main">
                  <Link href={ticketPageHref(x.id)} className="gcs-ticketList__title">
                    {x.title}
                  </Link>
                  <span className="gcs-ticketList__meta">
                    {scope === "handle" && <span>{t.rich("by", { name: () => <GcsMemberLink user={x.author} /> })}</span>}
                    {x.server && <span>{x.server.name}</span>}
                    {x.targetName && <span>{t("target", { name: x.targetName })}</span>}
                    <span>{t("activity", { time: format.relativeTime(new Date(x.lastActivityAt)) })}</span>
                  </span>
                </span>
                <span className="gcs-ticketList__side">
                  <span className="gcs-ticketStatus" data-status={x.status}>
                    {t(`statusNames.${x.status}`)}
                  </span>
                  <span className="gcs-ticketList__assignee">{x.assignee ? t.rich("assignedTo", { name: () => <GcsMemberLink user={x.assignee!} /> }) : t("unassigned")}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </GcsCard>
      <GcsPagination pagination={{ page: list.page, pages: list.pages, perPage: 30, total: list.total }} href={(p) => href({ page: p > 1 ? String(p) : null })} />
    </>
  );
}
