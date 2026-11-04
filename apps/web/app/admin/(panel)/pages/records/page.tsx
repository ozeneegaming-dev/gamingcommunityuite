import { PAGES_ACP } from "@gcs/modules";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { memberHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { bulkPagesRecords, moderatePagesCommentAcp } from "../actions";

type Props = { searchParams: Promise<{ status?: string; db?: string; q?: string; page?: string }> };
const STATUSES = ["pending", "published", "hidden", "rejected"] as const;
type Status = (typeof STATUSES)[number];

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.pages.records"))("title") };
}

/**
 * ACP › Pagini › Înregistrări: coada staff-ului. Stările (în așteptare, publicate, ascunse, respinse) cu numerele lor,
 * filtrul pe bază și căutarea, acțiunile în masă (aprobă, respinge cu motiv, ascunde, arată, șterge) și comentariile
 * care așteaptă aprobarea.
 */
export default async function AcpPagesRecords({ searchParams }: Props) {
  const { actor } = await requireAcpSection(PAGES_ACP.records);
  const sp = await searchParams;
  const status: Status = STATUSES.includes(sp.status as Status) ? (sp.status as Status) : "pending";
  const databaseId = Number(sp.db) || null;
  const q = (sp.q ?? "").slice(0, 60);
  const { pagesAdmin, acp, db } = services();
  const [t, format, data, databases, canEdit] = await Promise.all([
    getTranslations("acp.pages.records"),
    getFormatter(),
    pagesAdmin.records(actor, { status, databaseId, q, page: Number(sp.page) || 1 }),
    db.pagesDatabase.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    acp.can(actor, PAGES_ACP.records, "edit"),
  ]);
  const href = (patch: { status?: Status; page?: number }) => {
    const p = new URLSearchParams({ status: patch.status ?? status });
    if (databaseId) p.set("db", String(databaseId));
    if (q) p.set("q", q);
    if (patch.page && patch.page > 1) p.set("page", String(patch.page));
    return `/admin/pages/records?${p}`;
  };
  const actions = status === "pending" ? ["approve", "reject", "delete"] : status === "published" ? ["hide", "delete"] : status === "hidden" ? ["unhide", "delete"] : ["approve", "delete"];

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-list-check" description={t("lead")}>
        {t("title")}
      </GcsAcpTitle>
      <nav className="gcs-segLinks" aria-label={t("filters")} data-testid="gcs-acp-records-filters">
        {STATUSES.map((s) => (
          <Link key={s} href={href({ status: s })} className={`gcs-segLink${s === status ? " gcs-segLink--active" : ""}`} aria-current={s === status ? "page" : undefined}>
            {t(`status.${s}`, { count: data.counts[s] })}
          </Link>
        ))}
      </nav>
      <form method="get" action="/admin/pages/records" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <input type="hidden" name="status" value={status} />
        <label className="gcs-field" style={{ width: 240 }}>
          {t("database")}
          <select className="gcs-input" name="db" defaultValue={databaseId ?? ""}>
            <option value="">{t("allDatabases")}</option>
            {databases.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="gcs-field" style={{ width: 260 }}>
          {t("search")}
          <input className="gcs-input" type="search" name="q" defaultValue={q} maxLength={60} />
        </label>
        <button type="submit" className="gcs-btn gcs-btn--ghost">
          {t("apply")}
        </button>
      </form>

      <section className="gcs-card" style={{ overflow: "hidden" }}>
        {data.rows.length === 0 ? (
          <p className="gcs-acpList__empty">
            <GcsIcon name="fa-solid fa-check-double" />
            {t(`empty.${status}`)}
          </p>
        ) : (
          <GcsActionForm action={bulkPagesRecords} submitLabel={t("applyBulk")} submitKind="save">
            <ul className="gcs-acpList" data-testid="gcs-acp-records">
              {data.rows.map((r) => (
                <li key={r.id} className="gcs-acpList__row" data-testid="gcs-acp-record" data-record={r.id}>
                  <span className="gcs-acpList__main">
                    {canEdit && <input type="checkbox" name="ids" value={r.id} aria-label={t("select", { title: r.title })} />}
                    <span className="gcs-acpList__text">
                      {r.href ? (
                        <Link href={r.href} style={{ fontWeight: 700 }}>
                          {r.title}
                        </Link>
                      ) : (
                        <strong>{r.title}</strong>
                      )}
                      <span className="gcs-acpList__sub">
                        {r.database.name} · {r.author ? <Link href={memberHref(r.author)}>{r.author.name}</Link> : t("deletedMember")} · {format.dateTime(new Date(r.createdAt), { dateStyle: "medium", timeStyle: "short" })}
                        {r.rejectReason && <> · {t("reason", { reason: r.rejectReason })}</>}
                      </span>
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {canEdit && (
              <div className="gcs-pgBulk">
                <label className="gcs-field">
                  {t("action")}
                  <select className="gcs-input" name="action" defaultValue={actions[0]} data-testid="gcs-acp-records-action">
                    {actions.map((a) => (
                      <option key={a} value={a}>
                        {t(`actions.${a}`)}
                      </option>
                    ))}
                  </select>
                </label>
                {status === "pending" && (
                  <label className="gcs-field" style={{ flex: "1 1 260px" }}>
                    {t("rejectReason")}
                    <input className="gcs-input" name="reason" maxLength={500} />
                  </label>
                )}
              </div>
            )}
          </GcsActionForm>
        )}
        {data.pagination.pages > 1 && (
          <p className="gcs-acpList__more">
            {data.pagination.page > 1 && <Link href={href({ page: data.pagination.page - 1 })}>{t("prev")}</Link>}{" "}
            {data.pagination.page < data.pagination.pages && <Link href={href({ page: data.pagination.page + 1 })}>{t("next")}</Link>}
          </p>
        )}
      </section>

      <section className="gcs-card" style={{ overflow: "hidden" }} aria-labelledby="gcs-pg-pending-comments">
        <h2 id="gcs-pg-pending-comments" className="gcs-acpList__group">
          {t("pendingComments", { count: data.comments.length })}
        </h2>
        {data.comments.length === 0 ? (
          <p className="gcs-acpList__empty">{t("noPendingComments")}</p>
        ) : (
          <ul className="gcs-acpList">
            {data.comments.map((c) => (
              <li key={c.id} className="gcs-acpList__row">
                <span className="gcs-acpList__text">
                  <span>{c.text}</span>
                  <span className="gcs-acpList__sub">
                    {c.author?.name ?? t("deletedMember")} · {c.record.href ? <Link href={c.record.href}>{c.record.title}</Link> : c.record.title}
                  </span>
                </span>
                {canEdit && (
                  <span style={{ display: "flex", gap: 8 }}>
                    <GcsActionForm action={moderatePagesCommentAcp.bind(null, c.id, "approve")} submitLabel={t("actions.approve")} submitKind="approve" compact />
                    <GcsActionForm action={moderatePagesCommentAcp.bind(null, c.id, "delete")} submitLabel={t("actions.delete")} submitKind="delete" variant="ghost" compact />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
