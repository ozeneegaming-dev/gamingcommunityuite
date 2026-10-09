import { GcsButton, GcsCard, GcsTable, GcsMemberName } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../_components/GcsAcpTitle";
import { GcsMemberLink } from "@/lib/member-names";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.members"))("title") };
}

type Props = { searchParams: Promise<{ q?: string; group?: string; page?: string }> };

export default async function AcpMembersPage({ searchParams }: Props) {
  await requireAcpSection("members.members");
  const t = await getTranslations("acp.members");
  const format = await getFormatter();
  const sp = await searchParams;
  const groupId = Number(sp.group) || undefined;
  const { members, db } = services();
  const [result, groups] = await Promise.all([
    members.list({ ...(sp.q ? { q: sp.q } : {}), ...(groupId ? { groupId } : {}), page: Number(sp.page) || 1 }),
    db.group.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true } }),
  ]);

  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    if (sp.q) params.set("q", sp.q);
    if (groupId) params.set("group", String(groupId));
    params.set("page", String(page));
    return `/admin/members?${params}`;
  };

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-user">
        {t("title")}
      </GcsAcpTitle>
      <GcsCard style={{ padding: 16 }}>
        <form method="get" role="search" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <label className="gcs-field" style={{ flex: "1 1 260px" }}>
            {t("search")}
            <input className="gcs-input" type="search" name="q" defaultValue={sp.q ?? ""} placeholder={t("searchPlaceholder")} />
          </label>
          <label className="gcs-field" style={{ flex: "0 1 220px" }}>
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
          <GcsButton variant="primary" type="submit" icon={<GcsIcon name="fa-solid fa-filter" />}>
            {t("filter")}
          </GcsButton>
        </form>
      </GcsCard>

      <GcsCard>
        <div style={{ padding: "12px 16px", color: "var(--gcs-muted)", fontSize: 13 }}>{t("total", { count: result.total })}</div>
        <GcsTable
          caption={t("title")}
          rowKey={(m) => m.id}
          empty={t("empty")}
          rows={result.items}
          columns={[
            {
              key: "name",
              header: t("columns.name"),
              render: (m) => <GcsMemberLink user={m} href={`/admin/members/${m.id}`} />,
            },
            { key: "email", header: t("columns.email") },
            { key: "primaryGroup", header: t("columns.group"), render: (m) => m.primaryGroup.name },
            { key: "createdAt", header: t("columns.joined"), render: (m) => format.dateTime(m.createdAt, { dateStyle: "medium" }) },
            {
              key: "lastActiveAt",
              header: t("columns.lastActive"),
              render: (m) => (m.lastActiveAt ? format.relativeTime(m.lastActiveAt) : t("never")),
            },
          ]}
        />
        {result.pages > 1 && (
          <nav style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", padding: 12 }}>
            {result.page > 1 && (
              <GcsButton variant="ghost" size="sm" asChild>
                <Link href={pageHref(result.page - 1)}>
                  <GcsIcon name="fa-solid fa-chevron-left" className="gcs-btn__icon" />
                  {t("prev")}
                </Link>
              </GcsButton>
            )}
            <span style={{ fontSize: 13, color: "var(--gcs-muted)" }}>{t("page", { page: result.page, pages: result.pages })}</span>
            {result.page < result.pages && (
              <GcsButton variant="ghost" size="sm" asChild>
                <Link href={pageHref(result.page + 1)}>
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
