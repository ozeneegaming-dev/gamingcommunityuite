import { DONATIONS_ACP_SECTION, DONATION_STATUSES, dayKey, type GcsDonationFilter } from "@gcs/modules";
import { GcsBadge, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { formatMoney } from "@/lib/donations";
import { pageParam } from "@/lib/forum-page";
import { GcsMemberLink } from "@/lib/member-names";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { addDonation, confirmDonation, deleteDonation, rejectDonation } from "./actions";
import { GcsDonationFields } from "./GcsDonationFields";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.donations"))("title") };
}

type Props = { searchParams: Promise<{ status?: string; q?: string; method?: string; from?: string; to?: string; page?: string }> };

const TONES = { CONFIRMED: "ok", PENDING: "warn", REJECTED: "neutral" } as const;

/**
 * ACP › VIP & Magazin › Donații: sumarul (cereri în așteptare, totalul lunii), filtrele (stare, căutare, metodă,
 * interval) cu exportul CSV al aceleiași liste, adăugarea și rândurile cu confirmarea / respingerea cererilor „Am donat”
 * (dialog în pagină), editarea și ștergerea.
 */
export default async function AcpDonationsPage({ searchParams }: Props) {
  const panel = await requireAcpSection(DONATIONS_ACP_SECTION);
  const q = await searchParams;
  const [t, ts, format, locale] = await Promise.all([getTranslations("acp.donations"), getTranslations("donations.status"), getFormatter(), getLocale()]);
  const { donations, acp, settings } = services();
  const filter: GcsDonationFilter = { status: q.status, q: q.q, method: q.method, from: q.from, to: q.to, page: pageParam(q.page) };
  const [list, summary, currency, methods, canEdit, canDelete, tz] = await Promise.all([
    donations.adminList(filter),
    donations.summary(),
    donations.mainCurrency(),
    donations.methods(),
    acp.can(panel.actor, DONATIONS_ACP_SECTION, "edit"),
    acp.can(panel.actor, DONATIONS_ACP_SECTION, "delete"),
    settings.get<string>("site.timezone"),
  ]);
  const params = (patch: Record<string, string | undefined>) =>
    new URLSearchParams(Object.entries({ status: q.status, q: q.q, method: q.method, from: q.from, to: q.to, ...patch }).filter(([, v]) => v) as [string, string][]);
  const pageHref = (p: number) => {
    const s = params({ page: p > 1 ? String(p) : undefined });
    return `/admin/vip/donations${s.size ? `?${s}` : ""}`;
  };
  const csvHref = () => {
    const s = params({});
    return `/admin/donations.csv${s.size ? `?${s}` : ""}`;
  };
  const money = (amount: number, cur: string) => formatMoney(amount, cur, locale);

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-hand-holding-dollar">{t("title")}</GcsAcpTitle>

      <div className="gcs-donKpis">
        <Link href="/admin/vip/donations?status=PENDING" className="gcs-donKpi" data-testid="gcs-acp-donations-pending">
          <GcsIcon name="fa-solid fa-hourglass-half" />
          <span className="gcs-donKpi__value">{format.number(summary.pending)}</span>
          <span className="gcs-donKpi__label">{t("kpi.pending")}</span>
        </Link>
        <div className="gcs-donKpi">
          <GcsIcon name="fa-solid fa-calendar-check" />
          <span className="gcs-donKpi__value">{money(summary.month, summary.currency)}</span>
          <span className="gcs-donKpi__label">{t("kpi.month")}</span>
        </div>
        <Link href="/admin/vip/donations/goals" className="gcs-donKpi">
          <GcsIcon name="fa-solid fa-bullseye" />
          <span className="gcs-donKpi__value">{t("kpi.goals")}</span>
          <span className="gcs-donKpi__label">{t("kpi.goalsHint")}</span>
        </Link>
      </div>

      <form method="get" className="gcs-donFilters" data-testid="gcs-acp-donations-filters">
        <label className="gcs-field">
          {t("filters.status")}
          <select className="gcs-input" name="status" defaultValue={q.status ?? ""}>
            <option value="">{t("filters.all")}</option>
            {DONATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ts(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="gcs-field">
          {t("filters.q")}
          <input className="gcs-input" name="q" defaultValue={q.q ?? ""} maxLength={60} placeholder={t("filters.qHint")} />
        </label>
        <label className="gcs-field">
          {t("filters.method")}
          <input className="gcs-input" name="method" defaultValue={q.method ?? ""} maxLength={40} list="gcs-acp-don-filter-methods" />
          <datalist id="gcs-acp-don-filter-methods">
            {methods.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <label className="gcs-field">
          {t("filters.from")}
          <input className="gcs-input" name="from" type="date" defaultValue={q.from ?? ""} />
        </label>
        <label className="gcs-field">
          {t("filters.to")}
          <input className="gcs-input" name="to" type="date" defaultValue={q.to ?? ""} />
        </label>
        <div className="gcs-donFilters__actions">
          <button type="submit" className="gcs-btn gcs-btn--ghost">
            <GcsIcon name="fa-solid fa-filter" />
            {t("filters.apply")}
          </button>
          <a href={csvHref()} className="gcs-btn gcs-btn--ghost" data-testid="gcs-acp-donations-csv" download>
            <GcsIcon name="fa-solid fa-file-csv" />
            {t("csv")}
          </a>
        </div>
      </form>

      {canEdit && (
        <GcsCard as="section" className="gcs-donAdd" aria-labelledby="gcs-acp-don-add">
          <details data-testid="gcs-acp-donation-add">
            <summary id="gcs-acp-don-add" className="gcs-donAdd__summary">
              <GcsIcon name="fa-solid fa-plus" />
              {t("add")}
            </summary>
            <GcsActionForm action={addDonation} submitLabel={t("addSubmit")} submitKind="create">
              <GcsDonationFields idPrefix="gcs-acp-don-add" methods={methods} values={{ member: "", donorName: "", amount: "", currency, donatedAt: dayKey(new Date(), tz), method: "", reference: "", note: "", anonymous: false, status: "CONFIRMED" }} />
            </GcsActionForm>
          </details>
        </GcsCard>
      )}

      <GcsCard as="section" className="gcs-donTable" aria-label={t("list")}>
        {list.rows.length === 0 && (
          <p className="gcs-muted" style={{ padding: 16, margin: 0 }} data-testid="gcs-acp-donations-empty">
            {t("empty")}
          </p>
        )}
        {list.rows.map((d) => (
          <div key={d.id} className="gcs-donTable__row" data-testid="gcs-acp-donation" data-status={d.status}>
            <div className="gcs-donTable__main">
              <span className="gcs-donTable__amount">{money(d.amount, d.currency)}</span>
              <span className="gcs-donTable__who">
                {d.user ? <GcsMemberLink user={d.user} href={`/admin/members/${d.user.id}`} /> : <span>{d.donorName || t("noName")}</span>}
                {d.anonymous && <GcsBadge tone="neutral">{t("anonymous")}</GcsBadge>}
                <GcsBadge tone={TONES[d.status]} data-testid="gcs-acp-donation-status-badge">
                  {ts(d.status)}
                </GcsBadge>
              </span>
              <span className="gcs-donTable__meta">
                {format.dateTime(d.donatedAt, { dateStyle: "medium" })}
                {d.method && ` · ${d.method}`}
                {d.reference && ` · ${t("ref", { ref: d.reference })}`}
                {d.source !== "manual" && ` · ${t(`sources.${d.source === "member" ? "member" : "provider"}`, { source: d.source })}`}
              </span>
              {(d.note || d.rejectReason) && <span className="gcs-donTable__note">{[d.note, d.rejectReason && t("rejectedBecause", { reason: d.rejectReason })].filter(Boolean).join(" · ")}</span>}
            </div>
            <div className="gcs-donTable__actions">
              {canEdit && d.status !== "CONFIRMED" && (
                <GcsActionForm action={confirmDonation.bind(null, d.id)} submitLabel={t("confirm")} submitKind="approve" variant="primary" compact confirm={t("confirmBody", { amount: money(d.amount, d.currency) })}>
                  {null}
                </GcsActionForm>
              )}
              {canEdit && d.status === "PENDING" && (
                <GcsActionForm action={rejectDonation.bind(null, d.id)} submitLabel={t("reject")} submitKind="reject" variant="ghost" compact confirm={t("rejectBody")}>
                  <input className="gcs-input gcs-donTable__reason" name="reason" maxLength={200} placeholder={t("reason")} aria-label={t("reason")} />
                </GcsActionForm>
              )}
              {canEdit && (
                <Link href={`/admin/vip/donations/${d.id}`} className="gcs-btn gcs-btn--ghost gcs-btn--sm" aria-label={t("editLabel", { id: d.id })} title={t("editLabel", { id: d.id })}>
                  <GcsIcon name="fa-solid fa-pen" />
                  {t("edit")}
                </Link>
              )}
              {canDelete && (
                <GcsActionForm action={deleteDonation.bind(null, d.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("deleteBody")}>
                  {null}
                </GcsActionForm>
              )}
            </div>
          </div>
        ))}
      </GcsCard>

      {list.pages > 1 && (
        <nav className="gcs-acpPager" aria-label={t("pages")}>
          {list.page > 1 && (
            <Link href={pageHref(list.page - 1)} aria-label={t("prev")} title={t("prev")}>
              <GcsIcon name="fa-solid fa-chevron-left" />
            </Link>
          )}
          <span>
            {list.page} / {list.pages}
          </span>
          {list.page < list.pages && (
            <Link href={pageHref(list.page + 1)} aria-label={t("next")} title={t("next")}>
              <GcsIcon name="fa-solid fa-chevron-right" />
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
