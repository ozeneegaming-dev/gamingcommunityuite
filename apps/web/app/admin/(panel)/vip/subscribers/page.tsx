import { GcsCard, GcsUserLink } from "@gcs/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { pageParam } from "@/lib/forum-page";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { extendSubscription, revokeSubscription } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.vip"))("subscribersTitle") };
}

type Props = { searchParams: Promise<{ tier?: string; expiring?: string; page?: string }> };

/** ACP → VIP → Abonați: abonamentele active, filtrabile după nivel și după expirare (< 7 zile). */
export default async function AcpVipSubscribersPage({ searchParams }: Props) {
  await requireAcpSection("vip.subscribers");
  const q = await searchParams;
  const t = await getTranslations("acp.vip");
  const format = await getFormatter();
  const { vip, db } = services();
  const tier = Number(q.tier);
  const page = pageParam(q.page);
  const [tiers, [rows, total]] = await Promise.all([
    db.group.findMany({ where: { isVip: true }, orderBy: { position: "asc" }, select: { id: true, name: true } }),
    vip.subscribers({ ...(Number.isInteger(tier) && tier > 0 ? { groupId: tier } : {}), ...(q.expiring === "1" ? { expiringDays: 7 } : {}), page }),
  ]);
  const pages = Math.max(1, Math.ceil(total / 25));
  const qs = (p: Record<string, string | undefined>) => {
    const s = new URLSearchParams(Object.entries({ tier: q.tier, expiring: q.expiring, ...p }).filter(([, v]) => v) as [string, string][]);
    return `/admin/vip/subscribers${s.size ? `?${s}` : ""}`;
  };

  return (
    <>
      <h1 className="gcs-display" style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>
        {t("subscribersTitle")}
      </h1>
      <form method="get" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="gcs-field" style={{ width: 200 }}>
          {t("tier")}
          <select className="gcs-input" name="tier" defaultValue={q.tier ?? ""}>
            <option value="">{t("allTiers")}</option>
            {tiers.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="gcs-check">
          <input type="checkbox" name="expiring" value="1" defaultChecked={q.expiring === "1"} />
          {t("expiringSoon")}
        </label>
        <button type="submit" className="gcs-btn gcs-btn--ghost">
          {t("filter")}
        </button>
      </form>
      <GcsCard as="section" style={{ overflow: "hidden" }}>
        {rows.length === 0 && (
          <p className="gcs-muted" style={{ padding: 16, margin: 0 }}>
            {t("noSubscribers")}
          </p>
        )}
        {rows.map((s) => (
          <div key={s.id} className="gcs-settingsList__row" style={{ padding: "6px 16px" }} data-testid="gcs-acp-vip-subscriber">
            <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <GcsUserLink userId={s.user.id} name={s.user.name} nameKey={s.user.primaryGroup.key} href={`/admin/members/${s.user.id}`} />
              <span className="gcs-muted" style={{ fontSize: 13 }}>
                · {s.group.name} · {s.expiresAt ? t("expiresOn", { date: format.dateTime(s.expiresAt, { dateStyle: "medium" }) }) : t("permanent")} · {t(`sources.${s.source}`)}
              </span>
            </span>
            <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {s.expiresAt && (
                <GcsActionForm action={extendSubscription.bind(null, s.id)} submitLabel={t("extend")} variant="ghost" compact>
                  <input className="gcs-input" name="days" type="number" min={1} max={3650} defaultValue={30} aria-label={t("days")} style={{ width: 80 }} />
                </GcsActionForm>
              )}
              <GcsActionForm action={revokeSubscription.bind(null, s.id)} submitLabel={t("revoke")} variant="ghost" compact confirm={t("confirmRevoke")}>
                {null}
              </GcsActionForm>
            </span>
          </div>
        ))}
      </GcsCard>
      {pages > 1 && (
        <nav style={{ display: "flex", gap: 10 }}>
          {page > 1 && <Link href={qs({ page: String(page - 1) })}>←</Link>}
          <span>
            {page} / {pages}
          </span>
          {page < pages && <Link href={qs({ page: String(page + 1) })}>→</Link>}
        </nav>
      )}
    </>
  );
}
