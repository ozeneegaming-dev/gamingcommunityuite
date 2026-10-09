import { normalizeUsername, queryAudit } from "@gcs/core";
import { GcsButton, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../_components/GcsAcpTitle";
import { GcsMemberLink } from "@/lib/member-names";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.logs"))("title") };
}

type Props = { searchParams: Promise<{ actor?: string; action?: string; from?: string; to?: string; page?: string }> };

const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Cheile care diferă între două obiecte (sau `["*"]` dacă nu sunt obiecte). */
function changedKeys(before: unknown, after: unknown): string[] {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (!isObj(before) || !isObj(after)) return JSON.stringify(before) === JSON.stringify(after) ? [] : ["*"];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

const json = (v: unknown) => (v === null || v === undefined ? "—" : JSON.stringify(v, null, 2));

/** Jurnalul ACP (spec §12.6): cine, ce, când, cu valorile înainte și după. */
export default async function AcpLogsPage({ searchParams }: Props) {
  await requireAcpSection("system.logs");
  const t = await getTranslations("acp.logs");
  const tp = await getTranslations("acp.members");
  const format = await getFormatter();
  const sp = await searchParams;
  const { db } = services();

  const actor = sp.actor?.trim()
    ? await db.user.findUnique({ where: { nameNormalized: normalizeUsername(sp.actor) }, select: { id: true } })
    : null;
  const result =
    sp.actor?.trim() && !actor
      ? { items: [], total: 0, page: 1, pages: 1 }
      : await queryAudit(db, {
          ...(actor ? { actorId: actor.id } : {}),
          ...(sp.action?.trim() ? { action: sp.action.trim() } : {}),
          ...(isDate(sp.from) ? { from: new Date(`${sp.from}T00:00:00`) } : {}),
          ...(isDate(sp.to) ? { to: new Date(`${sp.to}T23:59:59.999`) } : {}),
          page: Number(sp.page) || 1,
        });

  const pageHref = (page: number) => {
    const params = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== "page" && v) as [string, string][]);
    params.set("page", String(page));
    return `/admin/logs?${params}`;
  };

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-clipboard-list">
        {t("title")}
      </GcsAcpTitle>
      <GcsCard style={{ padding: 16 }}>
        <form method="get" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <label className="gcs-field" style={{ flex: "1 1 180px" }}>
            {t("filters.actor")}
            <input className="gcs-input" name="actor" defaultValue={sp.actor ?? ""} />
          </label>
          <label className="gcs-field" style={{ flex: "1 1 180px" }}>
            {t("filters.action")}
            <input className="gcs-input" name="action" defaultValue={sp.action ?? ""} placeholder="group.update" />
          </label>
          <label className="gcs-field">
            {t("filters.from")}
            <input className="gcs-input" type="date" name="from" defaultValue={sp.from ?? ""} />
          </label>
          <label className="gcs-field">
            {t("filters.to")}
            <input className="gcs-input" type="date" name="to" defaultValue={sp.to ?? ""} />
          </label>
          <GcsButton variant="primary" type="submit" icon={<GcsIcon name="fa-solid fa-filter" />}>
            {t("filters.apply")}
          </GcsButton>
        </form>
      </GcsCard>

      <GcsCard>
        {result.items.length === 0 && <p style={{ margin: 0, padding: 24, textAlign: "center", color: "var(--gcs-muted)" }}>{t("empty")}</p>}
        {result.items.map((item) => {
          const keys = changedKeys(item.before, item.after);
          return (
            <details key={item.id} style={{ borderBottom: "1px solid var(--gcs-border)" }} data-action={item.action}>
              <summary style={{ cursor: "pointer", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", padding: "10px 16px", fontSize: 13.5 }}>
                <span style={{ color: "var(--gcs-muted)", minWidth: 150 }}>{format.dateTime(item.createdAt, { dateStyle: "short", timeStyle: "medium" })}</span>
                <span style={{ fontWeight: 600, minWidth: 120 }}>{item.actorId && item.actorName ? <GcsMemberLink user={{ id: item.actorId, name: item.actorName }} href={`/admin/members/${item.actorId}`} /> : (item.actorName ?? t("system"))}</span>
                <code style={{ color: "var(--gcs-accentInk)" }}>{item.action}</code>
                <span style={{ color: "var(--gcs-muted)" }}>
                  {item.targetType}:{item.targetId}
                </span>
                {item.ip && <span style={{ color: "var(--gcs-muted)", marginLeft: "auto" }}>{item.ip}</span>}
              </summary>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, padding: "0 16px 14px" }}>
                {(["before", "after"] as const).map((side) => (
                  <div key={side}>
                    <span className="gcs-acpSub__title" style={{ display: "block", padding: "6px 0" }}>
                      {t(side)}
                      {keys.length > 0 && keys[0] !== "*" ? ` · ${keys.join(", ")}` : ""}
                    </span>
                    <pre style={{ margin: 0, padding: 12, borderRadius: 10, background: "var(--gcs-surface2)", fontSize: 12, overflowX: "auto", whiteSpace: "pre-wrap" }}>
                      {json(item[side])}
                    </pre>
                  </div>
                ))}
              </div>
            </details>
          );
        })}
        {result.pages > 1 && (
          <nav style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: 12 }}>
            {result.page > 1 && (
              <GcsButton variant="ghost" size="sm" asChild>
                <Link href={pageHref(result.page - 1)} aria-label={tp("prev")} title={tp("prev")}>
                  <GcsIcon name="fa-solid fa-chevron-left" />
                </Link>
              </GcsButton>
            )}
            <span style={{ fontSize: 13, color: "var(--gcs-muted)", alignSelf: "center" }}>
              {result.page} / {result.pages}
            </span>
            {result.page < result.pages && (
              <GcsButton variant="ghost" size="sm" asChild>
                <Link href={pageHref(result.page + 1)} aria-label={tp("next")} title={tp("next")}>
                  <GcsIcon name="fa-solid fa-chevron-right" />
                </Link>
              </GcsButton>
            )}
          </nav>
        )}
      </GcsCard>
    </>
  );
}
