import type { GcsTicketMessageView } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { cache } from "react";
import { currentActor } from "@/lib/actor";
import { memberHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { GcsTicketControls } from "../../../_components/servers/GcsTicketControls";
import { GcsTicketReply } from "../../../_components/servers/GcsTicketForm";
import { playerHref, sanctionHref } from "../../../_components/servers/types";
import { GcsMemberLink, GcsNamedHtml } from "@/lib/member-names";

type Props = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

const load = cache(async (raw: string) => {
  if (!/^[1-9]\d{0,9}$/.test(raw)) return null;
  const { serverQueries, bridge } = services();
  if (!(await serverQueries.appEnabled())) return null;
  const actor = await currentActor();
  if (!actor.userId) return { actor, ticket: null };
  return { actor, ticket: await bridge.tickets.get(actor, Number(raw)) };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await load((await params).id);
  return data?.ticket ? { title: data.ticket.title, robots: { index: false } } : {};
}

/**
 * Pagina unui tichet (specul 2026-10-08-servere-pagini §5; notificările din partea A duc aici): starea, felul, serverul,
 * ținta, autorul, sancțiunea contestată, dovezile, discuția (notele interne doar pentru cine tratează, din serviciu),
 * răspunsul și tratarea (stările permise, responsabilul).
 */
export default async function TicketPage({ params }: Props) {
  const data = await load((await params).id);
  if (!data) notFound();
  if (!data.actor.userId) redirect("/login");
  const { actor, ticket } = data;
  if (!ticket) notFound();
  const { bridge } = services();
  const [t, tk, format] = await Promise.all([getTranslations("bridge.ticket"), getTranslations("bridge.tickets"), getFormatter()]);
  const [handlers, sanction] = await Promise.all([
    ticket.canHandle ? bridge.tickets.handlerOptions(actor, ticket.id) : Promise.resolve([]),
    ticket.canHandle && ticket.kind === "APPEAL" && ticket.sanction && !ticket.sanction.lifted ? bridge.sanctions.get(actor, ticket.sanction.id) : Promise.resolve(null),
  ]);
  const canLift = sanction !== null && sanction.status === "active" && (await bridge.sanctions.canSanction(actor, { type: sanction.type, scope: sanction.scope, serverId: sanction.server?.id ?? null, minutes: 1 }));
  const names = new Map([...handlers.map((h) => [h.id, h.name] as const), ...(ticket.assignee ? [[ticket.assignee.id, ticket.assignee.name] as const] : [])]);
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  const system = (m: GcsTicketMessageView) => {
    const d = (m.data ?? {}) as { from?: string | null; to?: string | null; lifted?: boolean; reason?: string };
    const who = m.author?.name ?? t("system");
    if (m.kind === "STATUS") {
      return (
        <>
          {t("statusChanged", { who, from: tk(`statusNames.${d.from ?? "OPEN"}`), to: tk(`statusNames.${d.to ?? "OPEN"}`) })}
          {d.lifted && <strong className="gcs-ticketEvent__lifted"> {t("lifted")}</strong>}
          {d.reason && <span className="gcs-ticketEvent__reason"> {t("reasonValue", { reason: d.reason })}</span>}
        </>
      );
    }
    if (!d.to) return t("released", { who });
    return d.to === m.author?.id ? t("took", { who }) : t("assigned", { who, to: names.get(d.to) ?? "—" });
  };

  return (
    <>
      <header className="gcs-pageHeader">
        <nav aria-label={tk("title")} className="gcs-breadcrumb">
          <ol>
            <li>
              <Link href="/servers/tickets">
                <GcsIcon name="fa-solid fa-flag" className="gcs-breadcrumb__home" />
                {tk("title")}
              </Link>
            </li>
            <li aria-current="page">#{ticket.id}</li>
          </ol>
        </nav>
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title" data-testid="gcs-ticket-title">
            {ticket.title}
          </h1>
          <p className="gcs-pageHeader__desc gcs-ticketHead">
            <span className="gcs-ticketKind" data-kind={ticket.kind}>
              {tk(`kinds.${ticket.kind}`)}
            </span>
            <span className="gcs-ticketStatus" data-status={ticket.status} data-testid="gcs-ticket-status">
              {tk(`statusNames.${ticket.status}`)}
            </span>
            <span>{t.rich("openedBy", { name: () => <GcsMemberLink user={ticket.author} />, date: when(ticket.createdAt) })}</span>
          </p>
        </div>
      </header>

      <div className="gcs-serverLayout">
        <div className="gcs-serverLayout__main">
          <GcsCard as="article" className="gcs-ticketPost" aria-label={t("original")}>
            <header className="gcs-titleBand gcs-ticketPost__head">
              <GcsMemberLink user={ticket.author} />
              <time dateTime={ticket.createdAt}>{when(ticket.createdAt)}</time>
            </header>
            {/* HTML-ul vine din renderer-ul platformei (documentul editorului validat și sanitizat la salvare, ca postările). */}
            <GcsNamedHtml className="gcs-postBody gcs-richText gcs-ticketPost__body" html={ticket.contentHtml} />
          </GcsCard>

          <section aria-labelledby="gcs-ticket-thread" className="gcs-ticketThread">
            <h2 id="gcs-ticket-thread" className="gcs-srOnly">
              {t("thread")}
            </h2>
            <ol className="gcs-ticketThread__list" data-testid="gcs-ticket-thread">
              {ticket.messages.map((m) =>
                m.kind === "MESSAGE" ? (
                  <li key={m.id} className={`gcs-card gcs-ticketPost${m.internal ? " gcs-ticketPost--internal" : ""}`} data-testid={m.internal ? "gcs-ticket-internal-note" : "gcs-ticket-message"}>
                    <header className="gcs-titleBand gcs-ticketPost__head">
                      {m.author ? <GcsMemberLink user={m.author} /> : <span>{t("system")}</span>}
                      {m.internal && (
                        <span className="gcs-ticketPost__internal">
                          <GcsIcon name="fa-solid fa-lock" />
                          {t("internalNote")}
                        </span>
                      )}
                      <time dateTime={m.createdAt}>{when(m.createdAt)}</time>
                    </header>
                    <GcsNamedHtml className="gcs-postBody gcs-richText gcs-ticketPost__body" html={m.contentHtml} />
                  </li>
                ) : (
                  <li key={m.id} className="gcs-ticketEvent" data-kind={m.kind}>
                    <GcsIcon name={m.kind === "STATUS" ? "fa-solid fa-arrow-right-arrow-left" : "fa-solid fa-user-tag"} className="gcs-ticketEvent__icon" />
                    <span>{system(m)}</span>
                    <time dateTime={m.createdAt}>{when(m.createdAt)}</time>
                  </li>
                ),
              )}
            </ol>
          </section>

          {ticket.canReply && (
            <GcsCard as="section" className="gcs-titledBox gcs-statBox" aria-labelledby="gcs-ticket-reply-title">
              <h2 id="gcs-ticket-reply-title" className="gcs-display gcs-titleBand gcs-serverBox__title">
                <GcsIcon name="fa-solid fa-reply" className="gcs-hIcon" />
                {t("reply")}
              </h2>
              <GcsTicketReply ticketId={ticket.id} canInternal={ticket.canHandle} />
            </GcsCard>
          )}
        </div>

        <aside className="gcs-serverLayout__side">
          <GcsCard as="section" className="gcs-titledBox gcs-statBox" aria-labelledby="gcs-ticket-facts">
            <h2 id="gcs-ticket-facts" className="gcs-display gcs-titleBand gcs-serverBox__title">
              <GcsIcon name="fa-solid fa-circle-info" className="gcs-hIcon" />
              {t("facts")}
            </h2>
            <dl className="gcs-serverDl" data-testid="gcs-ticket-facts">
              {ticket.server && (
                <>
                  <dt>{t("server")}</dt>
                  <dd>
                    <Link href={`/servers/${ticket.server.id}`}>{ticket.server.name}</Link>
                  </dd>
                </>
              )}
              {ticket.targetName && (
                <>
                  <dt>{ticket.kind === "ADMIN" ? t("admin") : t("player")}</dt>
                  <dd>{ticket.targetPlayerId ? <Link href={playerHref({ id: ticket.targetPlayerId, name: ticket.targetName })}>{ticket.targetName}</Link> : ticket.targetName}</dd>
                </>
              )}
              {ticket.sanction && (
                <>
                  <dt>{t("sanction")}</dt>
                  <dd>
                    <Link href={sanctionHref(ticket.sanction.id)}>
                      #{ticket.sanction.id} · {ticket.sanction.reason}
                    </Link>
                    {ticket.sanction.lifted && <span className="gcs-muted"> ({t("sanctionLifted")})</span>}
                  </dd>
                </>
              )}
              <dt>{t("assignee")}</dt>
              <dd data-testid="gcs-ticket-assignee-name">{ticket.assignee?.name ?? t("nobody")}</dd>
              <dt>{t("activity")}</dt>
              <dd>{when(ticket.lastActivityAt)}</dd>
            </dl>
            {ticket.evidence.length > 0 && (
              <ul className="gcs-evidenceList" aria-label={t("evidence")}>
                {ticket.evidence.map((e) => (
                  <li key={e.url}>
                    <GcsIcon name="fa-solid fa-link" className="gcs-hIcon" />
                    <a href={e.url} rel="nofollow noopener ugc" target="_blank">
                      {e.url.replace(/^https:\/\//, "")}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </GcsCard>
          {(ticket.transitions.length > 0 || ticket.canHandle) && (
            <GcsCard as="section" className="gcs-titledBox gcs-statBox" aria-labelledby="gcs-ticket-handle">
              <h2 id="gcs-ticket-handle" className="gcs-display gcs-titleBand gcs-serverBox__title">
                <GcsIcon name="fa-solid fa-list-check" className="gcs-hIcon" />
                {ticket.canHandle ? t("handle") : t("yourTicket")}
              </h2>
              <GcsTicketControls ticketId={ticket.id} transitions={ticket.transitions} canHandle={ticket.canHandle} canLift={canLift} me={actor.userId!} assigneeId={ticket.assigneeId} handlers={handlers} />
            </GcsCard>
          )}
        </aside>
      </div>
    </>
  );
}
