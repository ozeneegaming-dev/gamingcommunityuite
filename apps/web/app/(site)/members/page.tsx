import { GcsError } from "@gcs/core";
import { GCS_MEMBER_SORTS, type GcsMemberSort } from "@gcs/modules";
import { GcsButton, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsPagination } from "../_components/forum/GcsPagination";
import { GcsMemberCard } from "../_components/members/GcsMemberCard";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("members"))("title") };
}

type Search = { q?: string; group?: string; sort?: string; online?: string; page?: string };

/** `/members` (specul etapei 5): cardurile membrilor, cu căutare, filtru pe grup, online și sortare; 24 pe pagină. */
export default async function MembersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const t = await getTranslations("members");
  const actor = await currentActor();
  const { memberList } = services();
  const sort: GcsMemberSort = GCS_MEMBER_SORTS.includes(sp.sort as GcsMemberSort) ? (sp.sort as GcsMemberSort) : "joined";
  const groupId = sp.group && /^\d+$/.test(sp.group) ? Number(sp.group) : null;
  const online = sp.online === "1";
  const page = sp.page && /^\d+$/.test(sp.page) ? Number(sp.page) : 1;
  const result = await memberList.list(actor, { q: sp.q ?? "", groupId, sort, online, page }).catch((error: unknown) => {
    if (error instanceof GcsError && error.status === 403) return null;
    throw error;
  });
  if (!result) {
    return (
      <GcsCard style={{ padding: 24 }} role="alert" data-testid="gcs-members-forbidden">
        <GcsIcon name="fa-solid fa-lock" className="gcs-emptyIcon" />
        {t("forbidden")}
      </GcsCard>
    );
  }
  const groups = await memberList.groups();
  const href = (p: number) => {
    const params = new URLSearchParams();
    if (sp.q) params.set("q", sp.q);
    if (groupId) params.set("group", String(groupId));
    if (sort !== "joined") params.set("sort", sort);
    if (online) params.set("online", "1");
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/members?${qs}` : "/members";
  };

  return (
    <>
      <header className="gcs-pageHeader">
        <h1 className="gcs-display gcs-pageHeader__title">
          <GcsIcon name="fa-solid fa-users" className="gcs-hIcon" />
          {t("title")} <span className="gcs-muted" style={{ fontSize: 18 }}>({result.pagination.total})</span>
        </h1>
      </header>
      <form className="gcs-card gcs-memberFilters" action="/members" role="search" aria-label={t("filters")}>
        <label className="gcs-field">
          {t("search")}
          <input className="gcs-input" type="search" name="q" defaultValue={sp.q ?? ""} maxLength={40} />
        </label>
        <label className="gcs-field">
          {t("group")}
          <select className="gcs-input" name="group" defaultValue={groupId ? String(groupId) : ""}>
            <option value="">{t("allGroups")}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="gcs-field">
          {t("sort")}
          <select className="gcs-input" name="sort" defaultValue={sort}>
            {GCS_MEMBER_SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`sorts.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="gcs-check">
          <input type="checkbox" name="online" value="1" defaultChecked={online} />
          {t("onlineOnly")}
        </label>
        <GcsButton type="submit" variant="primary" icon={<GcsIcon name="fa-solid fa-filter" />}>
          {t("apply")}
        </GcsButton>
      </form>
      {result.members.length === 0 ? (
        <GcsCard style={{ padding: 24, color: "var(--gcs-muted)" }}>
          <GcsIcon name="fa-solid fa-user-slash" className="gcs-emptyIcon" />
          {t("empty")}
        </GcsCard>
      ) : (
        <div className="gcs-memberGrid" data-testid="gcs-member-grid">
          {result.members.map((m) => (
            <GcsMemberCard key={m.id} member={m} />
          ))}
        </div>
      )}
      <GcsPagination pagination={result.pagination} href={href} />
    </>
  );
}
