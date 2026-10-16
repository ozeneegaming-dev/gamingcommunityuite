import { GCS_LOGIN_METHODS, GCS_MEMBER_QUICK_FILTERS, MEMBER_REMOVAL_ACP_SECTION, type GcsAcpMemberSort, type GcsMemberListQuery } from "@gcs/core";
import { GcsAvatar, GcsBadge, GcsButton, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { GcsGroupLink } from "@/lib/group-pills";
import { advancedCount, memberSearchParams, parseMemberSearch, type GcsMemberSearchParams } from "@/lib/member-search";
import { GcsMemberLink } from "@/lib/member-names";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../_components/GcsAcpTitle";
import { BULK_FORM_ID, GcsMemberBulkBar } from "./_list/GcsMemberBulkBar";
import { GcsMemberTools } from "./_list/GcsMemberTools";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.members"))("title") };
}

type Props = { searchParams: Promise<GcsMemberSearchParams> };

const QUICK_ICONS: Record<string, string> = {
  all: "fa-solid fa-users",
  online: "fa-solid fa-signal",
  new: "fa-solid fa-seedling",
  unvalidated: "fa-solid fa-envelope-circle-check",
  banned: "fa-solid fa-ban",
  spammers: "fa-solid fa-bug",
  staff: "fa-solid fa-user-shield",
};
const ymd = (d: Date | undefined) => (d ? d.toISOString().slice(0, 10) : "");

/**
 * ACP → Membri (Membri v2): filtrele rapide, căutarea avansată, coloanele sortabile (avatar și numele stilizat, grupul
 * principal și câte secundare, IP, înscriere, ultima vizită, postări), acțiunile în masă cu confirmarea din pagină,
 * „Membru nou”, importul și exportul CSV.
 */
export default async function AcpMembersPage({ searchParams }: Props) {
  const panel = await requireAcpSection("members.members");
  const t = await getTranslations("acp.members");
  const format = await getFormatter();
  const query = parseMemberSearch(await searchParams);
  const { members, db, acp } = services();
  const [result, groups, canEdit, canGroups, canDelete] = await Promise.all([
    members.list(query),
    db.group.findMany({ where: { key: { not: "guest" } }, orderBy: { position: "asc" }, select: { id: true, key: true, name: true } }),
    acp.can(panel.actor, "members.members", "edit"),
    acp.can(panel.actor, "members.groups", "edit"),
    acp.can(panel.actor, MEMBER_REMOVAL_ACP_SECTION, "delete"),
  ]);

  const href = (patch: Partial<GcsMemberListQuery>) => {
    const params = memberSearchParams({ ...query, page: 1, ...patch });
    const s = params.toString();
    return s ? `/admin/members?${s}` : "/admin/members";
  };
  const filterQuery = memberSearchParams({ ...query, page: 1, sort: undefined, dir: undefined }).toString();
  const advanced = advancedCount(query);

  const sortHeader = (col: GcsAcpMemberSort, label: string) => {
    const active = (query.sort ?? "name") === col;
    const dir = active ? (query.dir ?? (col === "name" || col === "group" || col === "ip" ? "asc" : "desc")) : undefined;
    const next = active ? (dir === "asc" ? "desc" : "asc") : undefined;
    return (
      <th className="gcs-table__th" scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
        <Link href={href({ sort: col, ...(next ? { dir: next } : { dir: undefined }) })} className="gcs-sortLink" data-testid={`gcs-member-sort-${col}`}>
          {label}
          <GcsIcon name={active ? (dir === "asc" ? "fa-solid fa-sort-up" : "fa-solid fa-sort-down") : "fa-solid fa-sort"} className="gcs-sortLink__icon" />
        </Link>
      </th>
    );
  };

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-user"
        description={t("description")}
        actions={<GcsMemberTools groups={groups.filter((g) => g.key !== "root_admin")} defaultGroupId={groups.find((g) => g.key === "member")?.id ?? null} exportHref={`/admin/members.csv${filterQuery ? `?${filterQuery}` : ""}`} canEdit={canEdit} />}
      >
        {t("title")}
      </GcsAcpTitle>

      <nav className="gcs-segLinks gcs-memberQuick" aria-label={t("quick.label")} data-testid="gcs-member-quick">
        {(["all", ...GCS_MEMBER_QUICK_FILTERS] as const).map((f) => {
          const active = (query.quick ?? "all") === f;
          return (
            <Link key={f} href={href({ quick: f === "all" ? undefined : f })} className={`gcs-segLink${active ? " gcs-segLink--active" : ""}`} aria-current={active ? "page" : undefined} data-testid={`gcs-member-quick-${f}`}>
              <GcsIcon name={QUICK_ICONS[f]} /> {t(`quick.${f}`)}
            </Link>
          );
        })}
      </nav>

      <GcsCard className="gcs-memberSearch">
        <form method="get" role="search" className="gcs-memberSearch__form">
          {query.quick && <input type="hidden" name="quick" value={query.quick} />}
          {query.sort && <input type="hidden" name="sort" value={query.sort} />}
          {query.dir && <input type="hidden" name="dir" value={query.dir} />}
          <div className="gcs-memberSearch__row">
            <label className="gcs-field gcs-memberSearch__q">
              {t("search")}
              <input className="gcs-input" type="search" name="q" defaultValue={query.q ?? ""} placeholder={t("searchPlaceholder")} />
            </label>
            <GcsButton variant="primary" type="submit" icon={<GcsIcon name="fa-solid fa-magnifying-glass" />}>
              {t("filter")}
            </GcsButton>
            <Link href="/admin/members" className="gcs-btn gcs-btn--ghost" data-testid="gcs-member-search-reset">
              <GcsIcon name="fa-solid fa-rotate-left" className="gcs-btn__icon" />
              {t("reset")}
            </Link>
          </div>
          <details className="gcs-memberSearch__advanced" open={advanced > 0} data-testid="gcs-member-advanced">
            <summary className="gcs-memberSearch__summary">
              <GcsIcon name="fa-solid fa-sliders" /> {t("advanced.title")}
              {advanced > 0 && <GcsBadge tone="accent">{advanced}</GcsBadge>}
            </summary>
            <div className="gcs-memberSearch__grid">
              <label className="gcs-field">
                {t("group")}
                <select className="gcs-input" name="group" defaultValue={query.groupId ? String(query.groupId) : ""} data-testid="gcs-member-search-group">
                  <option value="">{t("allGroups")}</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="gcs-field">
                {t("advanced.scope")}
                <select className="gcs-input" name="scope" defaultValue={query.groupScope ?? ""}>
                  <option value="">{t("advanced.scopeAny")}</option>
                  <option value="primary">{t("advanced.scopePrimary")}</option>
                  <option value="secondary">{t("advanced.scopeSecondary")}</option>
                </select>
              </label>
              <label className="gcs-field">
                {t("advanced.ip")}
                <input className="gcs-input" name="ip" defaultValue={query.ip ?? ""} inputMode="decimal" placeholder="203.0.113" />
              </label>
              <label className="gcs-field">
                {t("advanced.login")}
                <select className="gcs-input" name="login" defaultValue={query.loginMethod ?? ""}>
                  <option value="">{t("advanced.any")}</option>
                  {GCS_LOGIN_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {t(`advanced.logins.${m}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="gcs-field">
                {t("advanced.twoFactor")}
                <select className="gcs-input" name="tfa" defaultValue={query.twoFactor === undefined ? "" : query.twoFactor ? "on" : "off"}>
                  <option value="">{t("advanced.any")}</option>
                  <option value="on">{t("advanced.tfaOn")}</option>
                  <option value="off">{t("advanced.tfaOff")}</option>
                </select>
              </label>
              <label className="gcs-field">
                {t("advanced.country")}
                <input className="gcs-input" name="country" defaultValue={query.country ?? ""} maxLength={2} placeholder="RO" />
              </label>
              <fieldset className="gcs-memberSearch__range">
                <legend>{t("advanced.joined")}</legend>
                <input className="gcs-input" type="date" name="joinedFrom" defaultValue={ymd(query.joinedFrom)} aria-label={t("advanced.joinedFrom")} />
                <input className="gcs-input" type="date" name="joinedTo" defaultValue={ymd(query.joinedTo)} aria-label={t("advanced.joinedTo")} />
              </fieldset>
              <fieldset className="gcs-memberSearch__range">
                <legend>{t("advanced.active")}</legend>
                <input className="gcs-input" type="date" name="activeFrom" defaultValue={ymd(query.activeFrom)} aria-label={t("advanced.activeFrom")} />
                <input className="gcs-input" type="date" name="activeTo" defaultValue={ymd(query.activeTo)} aria-label={t("advanced.activeTo")} />
              </fieldset>
              <fieldset className="gcs-memberSearch__range">
                <legend>{t("advanced.posts")}</legend>
                <input className="gcs-input" type="number" min={0} name="postsMin" defaultValue={query.postsMin ?? ""} aria-label={t("advanced.postsMin")} placeholder={t("advanced.min")} />
                <input className="gcs-input" type="number" min={0} name="postsMax" defaultValue={query.postsMax ?? ""} aria-label={t("advanced.postsMax")} placeholder={t("advanced.max")} />
              </fieldset>
            </div>
          </details>
        </form>
      </GcsCard>

      <GcsCard className="gcs-memberList">
        <div className="gcs-memberList__head">
          <span className="gcs-memberList__total" data-testid="gcs-member-total">
            {t("total", { count: result.total })}
          </span>
          {(canEdit || canGroups) && <GcsMemberBulkBar groups={groups} total={result.total} query={filterQuery} canDelete={canDelete} />}
        </div>
        <div className="gcs-memberList__scroll">
          <table className="gcs-table__table gcs-memberTable">
            <caption className="gcs-srOnly">{t("title")}</caption>
            <thead>
              <tr>
                <th className="gcs-table__th gcs-memberTable__check" scope="col">
                  <input type="checkbox" data-bulk-all="" aria-label={t("bulk.selectAll")} className="gcs-checkbox" data-testid="gcs-member-select-all" />
                </th>
                {sortHeader("name", t("columns.name"))}
                {sortHeader("group", t("columns.group"))}
                {sortHeader("ip", t("columns.ip"))}
                {sortHeader("joined", t("columns.joined"))}
                {sortHeader("lastActive", t("columns.lastActive"))}
                {sortHeader("posts", t("columns.posts"))}
              </tr>
            </thead>
            <tbody>
              {result.items.length === 0 && (
                <tr>
                  <td className="gcs-table__td gcs-memberTable__empty" colSpan={7}>
                    {t("empty")}
                  </td>
                </tr>
              )}
              {result.items.map((m) => (
                <tr key={m.id} className="gcs-table__row" data-testid="gcs-member-row" data-member={m.name}>
                  <td className="gcs-table__td gcs-memberTable__check">
                    <input type="checkbox" name="ids" value={m.id} form={BULK_FORM_ID} className="gcs-checkbox" aria-label={t("bulk.select", { name: m.name })} />
                  </td>
                  <td className="gcs-table__td">
                    <span className="gcs-memberTable__who">
                      <GcsAvatar name={m.name} size="s" {...(m.image ? { src: m.image } : {})} />
                      <span className="gcs-memberTable__name">
                        <GcsMemberLink user={m} href={`/admin/members/${m.id}`} />
                        <span className="gcs-memberTable__email">{m.email}</span>
                      </span>
                      {m.banned && <GcsBadge tone="accent">{t("status.banned")}</GcsBadge>}
                      {m.isSpammer && <GcsBadge tone="accent">{t("status.spammer")}</GcsBadge>}
                      {!m.emailVerified && <GcsBadge tone="neutral">{t("status.unvalidated")}</GcsBadge>}
                    </span>
                  </td>
                  <td className="gcs-table__td">
                    <span className="gcs-memberTable__groups">
                      <GcsGroupLink groupId={m.primaryGroup.id} size="sm" />
                      {m.secondaryCount > 0 && (
                        <span className="gcs-memberTable__more" title={t("secondaryCount", { count: m.secondaryCount })} data-testid="gcs-member-secondary-count">
                          +{m.secondaryCount}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="gcs-table__td gcs-memberTable__ip">{m.ip ?? "—"}</td>
                  <td className="gcs-table__td">{format.dateTime(m.createdAt, { dateStyle: "medium" })}</td>
                  <td className="gcs-table__td">{m.lastActiveAt ? format.relativeTime(m.lastActiveAt) : t("never")}</td>
                  <td className="gcs-table__td gcs-memberTable__num">{format.number(m.postsCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {result.pages > 1 && (
          <nav className="gcs-memberList__pages" aria-label={t("pages")}>
            {result.page > 1 && (
              <GcsButton variant="ghost" size="sm" asChild>
                <Link href={href({ page: result.page - 1 })}>
                  <GcsIcon name="fa-solid fa-chevron-left" className="gcs-btn__icon" />
                  {t("prev")}
                </Link>
              </GcsButton>
            )}
            <span className="gcs-memberList__page">{t("page", { page: result.page, pages: result.pages })}</span>
            {result.page < result.pages && (
              <GcsButton variant="ghost" size="sm" asChild>
                <Link href={href({ page: result.page + 1 })}>
                  {t("next")}
                  <GcsIcon name="fa-solid fa-chevron-right" className="gcs-btn__icon" />
                </Link>
              </GcsButton>
            )}
          </nav>
        )}
      </GcsCard>
    </>
  );
}
