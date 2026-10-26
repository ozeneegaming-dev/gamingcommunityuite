import type { BanType } from "@gcs/db";
import { GcsBadge, GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { createBanAction, liftBanAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.bans"))("title") };
}

type Props = { searchParams: Promise<{ state?: string; type?: string; q?: string; page?: string }> };
const TYPES: BanType[] = ["ACCOUNT", "IP", "EMAIL"];
const muted = { margin: 0, color: "var(--gcs-muted)", fontSize: 13 } as const;

/**
 * ACP › Membri › Banuri: toate banurile (pe cont, pe IP sau interval, pe email sau domeniu) cu motivul, cine a banat și
 * până când; un ban nou de orice tip și ridicarea cu confirmare. Banurile se aplică și la înregistrare și la
 * autentificare, nu doar pe paginile site-ului.
 */
export default async function AcpBansPage({ searchParams }: Props) {
  await requireAcpSection("members.bans");
  const t = await getTranslations("acp.bans");
  const format = await getFormatter();
  const sp = await searchParams;
  const state = sp.state === "all" ? "all" : "active";
  const type = TYPES.includes(sp.type as BanType) ? (sp.type as BanType) : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const list = await services().bans.list({ state, ...(type ? { type } : {}), ...(sp.q ? { q: sp.q } : {}), page });
  const now = new Date();
  const href = (p: number) => `?${new URLSearchParams({ state, ...(type ? { type } : {}), ...(sp.q ? { q: sp.q } : {}), page: String(p) })}`;

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-ban">{t("title")}</GcsAcpTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 1000 }}>
        <GcsCard style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }} data-testid="gcs-bans-new">
          <h2 style={{ margin: 0, fontSize: 16 }}>{t("new.title")}</h2>
          <p style={muted}>{t("new.body")}</p>
          <GcsActionForm action={createBanAction} submitLabel={t("new.submit")} submitKind="ban">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <label className="gcs-field">
                {t("new.type")}
                <select className="gcs-input" name="type" defaultValue="IP" data-testid="gcs-bans-type">
                  {TYPES.map((ty) => (
                    <option key={ty} value={ty}>
                      {t(`types.${ty}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="gcs-field">
                {t("new.value")}
                <input className="gcs-input" name="value" required maxLength={200} placeholder={t("new.valuePlaceholder")} data-testid="gcs-bans-value" />
              </label>
              <label className="gcs-field">
                {t("new.duration")}
                <select className="gcs-input" name="duration" defaultValue="permanent">
                  {(["permanent", "d1", "d7", "d30", "d365"] as const).map((d) => (
                    <option key={d} value={d}>
                      {t(`durations.${d}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="gcs-field">
              {t("new.reason")}
              <input className="gcs-input" name="reason" required maxLength={500} data-testid="gcs-bans-reason" />
            </label>
          </GcsActionForm>
        </GcsCard>

        <GcsCard style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }} data-testid="gcs-bans-list">
          <form method="get" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="gcs-field">
              {t("filter.state")}
              <select className="gcs-input" name="state" defaultValue={state}>
                <option value="active">{t("filter.active")}</option>
                <option value="all">{t("filter.all")}</option>
              </select>
            </label>
            <label className="gcs-field">
              {t("new.type")}
              <select className="gcs-input" name="type" defaultValue={type ?? ""}>
                <option value="">{t("filter.anyType")}</option>
                {TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(`types.${ty}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="gcs-field">
              {t("filter.search")}
              <input className="gcs-input" name="q" defaultValue={sp.q ?? ""} maxLength={100} />
            </label>
            <button type="submit" className="gcs-btn gcs-btn--ghost">
              {t("filter.apply")}
            </button>
          </form>
          {list.rows.length === 0 ? (
            <p style={muted}>{t("empty")}</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {list.rows.map((b) => {
                const status = b.liftedAt ? "lifted" : b.expiresAt && b.expiresAt <= now ? "expired" : "active";
                return (
                  <li key={b.id} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid var(--gcs-border)", paddingTop: 10 }} data-testid="gcs-bans-row">
                    <GcsBadge tone="neutral">{t(`types.${b.type}`)}</GcsBadge>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <strong>{b.type === "ACCOUNT" && b.user ? <Link href={`/admin/members/${b.user.id}`}>{b.user.name}</Link> : b.value}</strong>
                      <p style={muted}>
                        {b.reason} · {b.createdBy ? t("by", { name: b.createdBy.name }) : t("bySystem")} · {format.dateTime(b.createdAt, { dateStyle: "medium" })} ·{" "}
                        {b.expiresAt ? t("until", { date: format.dateTime(b.expiresAt, { dateStyle: "medium", timeStyle: "short" }) }) : t("permanent")}
                      </p>
                    </div>
                    <GcsBadge tone={status === "active" ? "accent" : "neutral"} data-state={status}>
                      {t(`status.${status}`)}
                    </GcsBadge>
                    {status === "active" && (
                      <GcsActionForm compact variant="ghost" action={liftBanAction.bind(null, b.id)} submitLabel={t("lift")} submitKind="lift" confirm={t("liftConfirm")} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {list.pages > 1 && (
            <p style={{ display: "flex", gap: 12, margin: 0 }}>
              {list.page > 1 && <Link href={href(list.page - 1)}>{t("prev")}</Link>}
              <span style={muted}>{t("page", { page: list.page, pages: list.pages })}</span>
              {list.page < list.pages && <Link href={href(list.page + 1)}>{t("next")}</Link>}
            </p>
          )}
        </GcsCard>
      </div>
    </>
  );
}
