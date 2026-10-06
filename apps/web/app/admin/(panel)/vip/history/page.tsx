import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { pageParam } from "@/lib/forum-page";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.vip"))("historyTitle") };
}

/** ACP → VIP → Istoric: fiecare acordare, prelungire, retragere și expirare (`vip_log`). */
export default async function AcpVipHistoryPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireAcpSection("vip.history");
  const page = pageParam((await searchParams).page);
  const t = await getTranslations("acp.vip");
  const tm = await getTranslations("acp.memberProfile");
  const tp = await getTranslations("acp.members");
  const format = await getFormatter();
  const { vip, db } = services();
  const [rows, total] = await vip.history({ page, perPage: 50 });
  const users = new Map(
    (await db.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.userId, r.actorId].filter((x): x is string => x !== null)))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
  );
  const pages = Math.max(1, Math.ceil(total / 50));
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-clock-rotate-left">
        {t("historyTitle")}
      </GcsAcpTitle>
      <GcsCard as="section" style={{ overflow: "hidden" }}>
        {rows.length === 0 && (
          <p className="gcs-muted" style={{ padding: 16, margin: 0 }}>
            {t("noHistory")}
          </p>
        )}
        {rows.map((h) => (
          <div key={h.id} className="gcs-settingsList__row" style={{ padding: "6px 16px", fontSize: 13 }} data-testid="gcs-acp-vip-log">
            <span>
              <Link href={`/admin/members/${h.userId}`}>{users.get(h.userId) ?? h.userId}</Link> · <strong>{tm(`actions.${h.action}`)}</strong> · {h.group?.name ?? "—"}
              {h.expiresAt ? ` · ${tm("until", { date: format.dateTime(h.expiresAt, { dateStyle: "medium" }) })}` : ""}
              {h.note ? ` · ${h.note}` : ""}
              {h.actorId ? ` · ${t("by", { name: users.get(h.actorId) ?? "?" })}` : ` · ${t("bySystem")}`}
            </span>
            <span className="gcs-muted">{format.dateTime(h.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
          </div>
        ))}
      </GcsCard>
      {pages > 1 && (
        <nav className="gcs-acpPager">
          {page > 1 && (
            <Link href={`/admin/vip/history?page=${page - 1}`} aria-label={tp("prev")} title={tp("prev")}>
              <GcsIcon name="fa-solid fa-chevron-left" />
            </Link>
          )}
          <span>
            {page} / {pages}
          </span>
          {page < pages && (
            <Link href={`/admin/vip/history?page=${page + 1}`} aria-label={tp("next")} title={tp("next")}>
              <GcsIcon name="fa-solid fa-chevron-right" />
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
