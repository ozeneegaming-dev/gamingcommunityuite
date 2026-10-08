import { BRIDGE_PERMISSION } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsTicketForm } from "../../../_components/servers/GcsTicketForm";
import { isBridgeGameKey } from "../../../_components/servers/types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("bridge.ticketForm"))("pageTitle") };
}

export const dynamic = "force-dynamic";

const KINDS = { appeal: "APPEAL", cheater: "CHEATER", admin: "ADMIN" } as const;

/**
 * `/servers/tickets/new` (specul 2026-10-08-servere-pagini §5): contestația unei sancțiuni proprii (`?kind=appeal&
 * sanction={id}`, butonul „Contestă” de pe pagina sancțiunii) sau reclamația unui cheater / admin.
 */
export default async function NewTicketPage({ searchParams }: { searchParams: Promise<{ kind?: string; sanction?: string }> }) {
  const { serverQueries, bridge, permissions } = services();
  if (!(await serverQueries.appEnabled())) notFound();
  const [sp, actor, t, ts, format] = await Promise.all([searchParams, currentActor(), getTranslations("bridge.ticketForm"), getTranslations("bridge.sanction.type"), getFormatter()]);
  if (!actor.userId) redirect("/login");
  if (actor.isBanned || !(await permissions.can(actor, BRIDGE_PERMISSION.ticketsCreate))) notFound();
  const [sanctions, servers, presence] = await Promise.all([bridge.sanctions.mine(actor), serverQueries.list(actor), bridge.queries.adminPresence(actor)]);
  const kind = KINDS[(sp.kind ?? "") as keyof typeof KINDS] ?? (sanctions.length > 0 ? "APPEAL" : "CHEATER");
  const wanted = /^\d{1,9}$/.test(sp.sanction ?? "") ? Number(sp.sanction) : null;
  const data = {
    sanctions: sanctions.map((s) => ({
      id: s.id,
      appealOpen: s.appealOpen,
      label: `${ts(s.type)} · ${s.scope === "GLOBAL" ? t("allServers") : (s.server?.name ?? "—")} · ${format.dateTime(new Date(s.createdAt), { dateStyle: "medium" })} · ${s.reason}`,
    })),
    servers: servers.filter((s) => isBridgeGameKey(s.game.key)).map((s) => ({ id: s.id, name: s.name })),
    // Reclamațiile de admin țintesc intrările GCS (adminii raportați doar de servere nu au intrare).
    admins: (presence ?? []).filter((a) => a.subject !== "SERVER").map((a) => ({ id: a.id, name: a.name || `#${a.id}`, serverId: a.server?.id ?? null })),
  };
  return (
    <>
      <header className="gcs-pageHeader">
        <nav aria-label={t("pageTitle")} className="gcs-breadcrumb">
          <ol>
            <li>
              <Link href="/servers/tickets">
                <GcsIcon name="fa-solid fa-flag" className="gcs-breadcrumb__home" />
                {t("tickets")}
              </Link>
            </li>
            <li aria-current="page">{t("pageTitle")}</li>
          </ol>
        </nav>
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title">
            <GcsIcon name="fa-solid fa-flag" className="gcs-hIcon" />
            {t("pageTitle")}
          </h1>
          <p className="gcs-pageHeader__desc">{t("lead")}</p>
        </div>
      </header>
      <GcsCard as="section" className="gcs-formCard">
        <GcsTicketForm data={data} initialKind={kind} initialSanction={wanted !== null && sanctions.some((s) => s.id === wanted && !s.appealOpen) ? wanted : null} />
      </GcsCard>
    </>
  );
}
