import { GcsError } from "@gcs/core";
import { GCS_CLAN_JOIN_FILTERS, GCS_CLAN_SORTS, type GcsClanJoinFilter, type GcsClanSort } from "@gcs/modules";
import { GcsButton, GcsCard, GcsClanTag } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { landingCanonical } from "@/lib/landing";
import { currentActor } from "@/lib/actor";
import { pageParam } from "@/lib/forum-page";
import { services } from "@/lib/services";
import { GcsClanInviteButtons } from "../_components/clans/GcsClanActions";
import { GcsClanGrid } from "../_components/clans/GcsClanGrid";
import { GcsClanLogo } from "../_components/clans/GcsClanLogo";
import { GcsPagination } from "../_components/forum/GcsPagination";
import { GcsMemberLink } from "@/lib/member-names";

export async function generateMetadata(): Promise<Metadata> {
  // Aleasă ca pagină de pornire, are aceeași adresă canonică pe `/` și pe /clans: `/`.
  return { title: (await getTranslations("clans"))("title"), alternates: { canonical: await landingCanonical("clans", "/clans") } };
}

export const dynamic = "force-dynamic";

type Search = { q?: string; sort?: string; join?: string; archived?: string; page?: string };

/**
 * `/clans` (specul 2026-10-08-clanuri §7.1): invitațiile viewer-ului, filtrele (căutare, sortare, recrutare, arhivate)
 * și grila clanurilor; „Creează un clan” doar cu `clans.create`.
 */
export default async function ClansPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { clanQueries, permissions } = services();
  if (!(await clanQueries.appEnabled())) notFound();
  const [sp, actor, t] = await Promise.all([searchParams, currentActor(), getTranslations("clans")]);
  const sort: GcsClanSort = GCS_CLAN_SORTS.includes(sp.sort as GcsClanSort) ? (sp.sort as GcsClanSort) : "rank";
  const join: GcsClanJoinFilter | null = GCS_CLAN_JOIN_FILTERS.includes(sp.join as GcsClanJoinFilter) ? (sp.join as GcsClanJoinFilter) : null;
  const archived = sp.archived === "1";
  const q = (sp.q ?? "").slice(0, 40);
  const result = await clanQueries.directory(actor, { q, sort, join, archived, page: pageParam(sp.page) }).catch((error: unknown) => {
    if (error instanceof GcsError && error.status === 403) return null;
    throw error;
  });
  if (!result) {
    return (
      <GcsCard style={{ padding: 24 }} role="alert" data-testid="gcs-clans-forbidden">
        <GcsIcon name="fa-solid fa-lock" className="gcs-emptyIcon" />
        {t("forbidden")}
      </GcsCard>
    );
  }
  const [canCreate, invites] = await Promise.all([actor.userId ? permissions.can(actor, "clans.create") : Promise.resolve(false), clanQueries.invitations(actor)]);
  const href = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (sort !== "rank") params.set("sort", sort);
    if (join) params.set("join", join);
    if (archived) params.set("archived", "1");
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/clans?${qs}` : "/clans";
  };
  const filtered = Boolean(q || join || archived);

  return (
    <>
      <header className="gcs-pageHeader">
        <div className="gcs-pageHeader__text">
          <h1 className="gcs-display gcs-pageHeader__title">
            <GcsIcon name="fa-solid fa-people-group" className="gcs-hIcon" />
            {t("title")}
          </h1>
          <p className="gcs-pageHeader__desc gcs-clanLead" data-testid="gcs-clans-summary">
            {result.activeTotal > 0 ? t("lead", { count: result.activeTotal }) : t("leadEmpty")}
          </p>
        </div>
        {canCreate && (
          <div className="gcs-pageHeader__actions">
            <GcsButton variant="primary" asChild icon={<GcsIcon name="fa-solid fa-plus" />}>
              <Link href="/clans/new" data-testid="gcs-clan-create">
                {t("create")}
              </Link>
            </GcsButton>
          </div>
        )}
      </header>

      {invites.length > 0 && (
        <section className="gcs-card gcs-titledBox gcs-clanBox gcs-clanInvites" aria-labelledby="gcs-clan-invites-title" data-testid="gcs-clan-invites">
          <h2 id="gcs-clan-invites-title" className="gcs-titleBand gcs-clanBox__title">
            <GcsIcon name="fa-solid fa-envelope-open-text" className="gcs-hIcon" />
            {t("invites.title", { count: invites.length })}
          </h2>
          {invites.map((inv) => (
            <div key={inv.id} className="gcs-clanInvite">
              <div className="gcs-clanInvite__text">
                <GcsClanLogo clan={inv.clan} size="s" />
                <GcsClanTag clan={inv.clan} size="sm" />
                <Link href={inv.clan.href}>{inv.clan.name}</Link>
                {inv.invitedBy && <span className="gcs-muted">{t.rich("invites.from", { name: () => <GcsMemberLink user={inv.invitedBy!} /> })}</span>}
              </div>
              <GcsClanInviteButtons clanId={inv.clan.id} />
            </div>
          ))}
        </section>
      )}

      <form className="gcs-card gcs-memberFilters" action="/clans" role="search" aria-label={t("filters.label")}>
        <label className="gcs-field">
          {t("filters.search")}
          <input className="gcs-input" type="search" name="q" defaultValue={q} maxLength={40} />
        </label>
        <label className="gcs-field">
          {t("filters.sort")}
          <select className="gcs-input" name="sort" defaultValue={sort}>
            {GCS_CLAN_SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`sorts.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="gcs-field">
          {t("filters.join")}
          <select className="gcs-input" name="join" defaultValue={join ?? ""}>
            <option value="">{t("filters.joinAll")}</option>
            {GCS_CLAN_JOIN_FILTERS.map((j) => (
              <option key={j} value={j}>
                {t(`recruit.${j.toUpperCase()}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="gcs-check">
          <input type="checkbox" name="archived" value="1" defaultChecked={archived} />
          {t("filters.archived")}
        </label>
        <GcsButton type="submit" variant="primary" icon={<GcsIcon name="fa-solid fa-filter" />}>
          {t("filters.apply")}
        </GcsButton>
      </form>

      {result.clans.length === 0 ? (
        <GcsCard>
          <p className="gcs-emptyState" data-testid="gcs-clans-empty">
            <GcsIcon name="fa-solid fa-people-group" className="gcs-emptyIcon" />
            {filtered ? t("emptyFilter") : t("empty")}
            {canCreate && !filtered && (
              <>
                {" "}
                <Link href="/clans/new">{t("emptyCreate")}</Link>
              </>
            )}
          </p>
        </GcsCard>
      ) : (
        <GcsClanGrid clans={result.clans} showRank={sort === "rank" && !archived} />
      )}
      <GcsPagination pagination={result.pagination} href={href} />
    </>
  );
}
