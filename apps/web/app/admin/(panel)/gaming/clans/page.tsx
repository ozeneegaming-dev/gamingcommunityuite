import { CLANS_ACP_SECTION, GCS_CLAN_ACP_FILTERS, type GcsClanAcpFilter } from "@gcs/modules";
import { GcsCard, GcsClanTag, GcsMemberName } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { pageParam } from "@/lib/forum-page";
import { memberHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { approveClan, recomputeClanRanking, rejectClan } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.clans"))("title") };
}

type Props = { searchParams: Promise<{ status?: string; q?: string; page?: string }> };

/**
 * ACP → Gaming → Clanuri (specul 2026-10-08-clanuri §8): filtrele pe stare (cu numerele), căutarea și lista; clanurile
 * în așteptare au „Aprobă” / „Respinge” (cu motiv) direct în listă. „Recalculează clasamentul” în antet.
 */
export default async function AcpClansPage({ searchParams }: Props) {
  const { actor } = await requireAcpSection(CLANS_ACP_SECTION);
  const sp = await searchParams;
  const filter: GcsClanAcpFilter = GCS_CLAN_ACP_FILTERS.includes(sp.status as GcsClanAcpFilter) ? (sp.status as GcsClanAcpFilter) : "pending";
  const q = (sp.q ?? "").slice(0, 40);
  const [t, format, list] = await Promise.all([getTranslations("acp.clans"), getFormatter(), services().clanAdmin.list(actor, { filter, q, page: pageParam(sp.page) })]);
  const href = (status: GcsClanAcpFilter, page = 1) => {
    const params = new URLSearchParams({ status });
    if (q) params.set("q", q);
    if (page > 1) params.set("page", String(page));
    return `/admin/gaming/clans?${params}`;
  };

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-people-group"
        description={t("lead")}
        actions={<GcsActionForm action={recomputeClanRanking} submitLabel={t("recompute")} submitKind="recompute" variant="ghost" compact />}
      >
        {t("title")}
      </GcsAcpTitle>
      <nav className="gcs-segLinks" aria-label={t("filterLabel")} data-testid="gcs-acp-clan-filters">
        {GCS_CLAN_ACP_FILTERS.map((f) => (
          <Link key={f} href={href(f)} className={`gcs-segLink${f === filter ? " gcs-segLink--active" : ""}`} aria-current={f === filter ? "page" : undefined}>
            {t(`filters.${f}`, { count: list.counts[f] })}
          </Link>
        ))}
      </nav>
      <form method="get" action="/admin/gaming/clans" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <input type="hidden" name="status" value={filter} />
        <label className="gcs-field" style={{ width: 260 }}>
          {t("search")}
          <input className="gcs-input" type="search" name="q" defaultValue={q} maxLength={40} />
        </label>
        <button type="submit" className="gcs-btn gcs-btn--ghost">
          {t("searchSubmit")}
        </button>
      </form>
      <GcsCard as="section" aria-label={t("title")} style={{ overflow: "hidden" }}>
        {list.rows.length === 0 ? (
          <p className="gcs-acpList__empty">
            <GcsIcon name="fa-solid fa-people-group" />
            {t(`empty.${filter}`)}
          </p>
        ) : (
          <ul className="gcs-acpList" data-testid="gcs-acp-clans">
            {list.rows.map((c) => (
              <li key={c.id} className="gcs-acpList__row" style={{ flexWrap: "wrap" }} data-testid="gcs-acp-clan" data-clan={c.id}>
                <span className="gcs-acpList__main">
                  <GcsClanTag clan={c} size="sm" plain />
                  <span className="gcs-acpList__text">
                    <Link href={`/admin/gaming/clans/${c.id}`} style={{ fontWeight: 700 }}>
                      {c.name}
                    </Link>
                    <span className="gcs-acpList__sub">
                      {c.leader ? (
                        <>
                          {t("leader")}: <GcsMemberName userId={c.leader.id} name={c.leader.name} nameKey={c.leader.nameKey} href={memberHref(c.leader)} />
                        </>
                      ) : (
                        t("noLeader")
                      )}
                      {" — "}
                      {t("row", { members: c.membersCount, score: format.number(c.score), date: format.dateTime(new Date(c.createdAt), { dateStyle: "medium" }) })}
                    </span>
                  </span>
                </span>
                <span style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {c.status === "PENDING" ? (
                    <>
                      <GcsActionForm action={approveClan.bind(null, c.id)} submitLabel={t("approve")} submitKind="approve" compact />
                      <GcsActionForm action={rejectClan.bind(null, c.id)} submitLabel={t("reject")} submitKind="reject" variant="ghost" compact confirm={t("rejectConfirm", { name: c.name })}>
                        <input className="gcs-input" name="reason" maxLength={500} placeholder={t("rejectReason")} aria-label={t("rejectReason")} style={{ width: 220 }} />
                      </GcsActionForm>
                    </>
                  ) : (
                    <span className="gcs-acpList__meta">{t(`status.${c.locked ? "LOCKED" : c.status}`)}</span>
                  )}
                  <Link className="gcs-btn gcs-btn--ghost gcs-btn--sm" href={`/admin/gaming/clans/${c.id}`}>
                    {t("edit")}
                  </Link>
                  {c.status !== "PENDING" && (
                    <Link className="gcs-btn gcs-btn--ghost gcs-btn--sm" href={c.href}>
                      {t("view")}
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {list.pagination.pages > 1 && (
          <p className="gcs-acpList__more">
            {list.pagination.page > 1 && <Link href={href(filter, list.pagination.page - 1)}>{t("prev")}</Link>}{" "}
            {list.pagination.page < list.pagination.pages && <Link href={href(filter, list.pagination.page + 1)}>{t("next")}</Link>}
          </p>
        )}
      </GcsCard>
    </>
  );
}
