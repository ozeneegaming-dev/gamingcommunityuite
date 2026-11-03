import { faBan, faGavel, faPen } from "@fortawesome/free-solid-svg-icons";
import type { BanType } from "@gcs/db";
import { GcsCard, GcsIconSvg } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpEditPanel } from "../../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { createBanAction, liftBanAction, updateBanAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.bans"))("title") };
}

type Props = { searchParams: Promise<{ state?: string; type?: string; q?: string; page?: string }> };
const SECTION = "members.bans";
const TYPES: BanType[] = ["ACCOUNT", "IP", "EMAIL"];
const DURATIONS = ["permanent", "d1", "d7", "d30", "d365"] as const;
const TYPE_ICONS: Record<BanType, string> = { ACCOUNT: "fa-solid fa-user-slash", IP: "fa-solid fa-network-wired", EMAIL: "fa-solid fa-envelope" };

/**
 * ACP › Membri › Banuri: toate banurile (pe cont, pe IP sau interval, pe email sau domeniu) cu motivul, cine a banat și
 * până când. „Ban nou” și panoul fiecărui ban (motivul, durata, „Ridică”) se deschid în dreapta. Banurile se aplică și
 * la înregistrare și la autentificare, nu doar pe paginile site-ului.
 */
export default async function AcpBansPage({ searchParams }: Props) {
  const panel = await requireAcpSection(SECTION);
  const sp = await searchParams;
  const state = sp.state === "all" ? "all" : "active";
  const type = TYPES.includes(sp.type as BanType) ? (sp.type as BanType) : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const { bans, acp } = services();
  const [t, format, list, canEdit] = await Promise.all([
    getTranslations("acp.bans"),
    getFormatter(),
    bans.list({ state, ...(type ? { type } : {}), ...(sp.q ? { q: sp.q } : {}), page }),
    acp.can(panel.actor, SECTION, "edit"),
  ]);
  const now = new Date();
  const href = (p: number) => `?${new URLSearchParams({ state, ...(type ? { type } : {}), ...(sp.q ? { q: sp.q } : {}), page: String(p) })}`;
  const when = (d: Date) => format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-ban"
        description={t("new.body")}
        actions={
          canEdit && (
            <GcsAcpEditPanel label={t("new.title")} variant="primary" buttonIcon={<GcsIconSvg icon={faGavel} />} title={t("new.title")} titleIcon={<GcsIconSvg icon={faBan} />} testId="gcs-bans-new">
              <GcsActionForm action={createBanAction} submitLabel={t("new.submit")} submitKind="ban">
                <fieldset className="gcs-formSec">
                  <legend>{t("new.what")}</legend>
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
                </fieldset>
                <fieldset className="gcs-formSec">
                  <legend>{t("new.details")}</legend>
                  <label className="gcs-field">
                    {t("new.duration")}
                    <select className="gcs-input" name="duration" defaultValue="permanent">
                      {DURATIONS.map((d) => (
                        <option key={d} value={d}>
                          {t(`durations.${d}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="gcs-field">
                    {t("new.reason")}
                    <input className="gcs-input" name="reason" required maxLength={500} data-testid="gcs-bans-reason" />
                  </label>
                </fieldset>
              </GcsActionForm>
            </GcsAcpEditPanel>
          )
        }
      >
        {t("title")}
      </GcsAcpTitle>

      <GcsCard className="gcs-acpPanel" data-testid="gcs-bans-list">
        <form method="get" className="gcs-bansFilter">
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
            <GcsIcon name="fa-solid fa-filter" className="gcs-btn__icon" />
            {t("filter.apply")}
          </button>
        </form>
        {list.rows.length === 0 ? (
          <p className="gcs-acpList__empty gcs-sysEmpty">
            <GcsIcon name="fa-solid fa-ban" /> {t("empty")}
          </p>
        ) : (
          <ul className="gcs-sysList">
            {list.rows.map((b) => {
              const status = b.liftedAt ? "lifted" : b.expiresAt && b.expiresAt <= now ? "expired" : "active";
              const subject = b.type === "ACCOUNT" && b.user ? b.user.name : b.value;
              return (
                <li key={b.id} className="gcs-sysList__row" data-testid="gcs-bans-row" data-state={status}>
                  <span className="gcs-sysList__icon" aria-hidden="true">
                    <GcsIcon name={TYPE_ICONS[b.type]} />
                  </span>
                  <span className="gcs-sysList__body">
                    <strong>{b.type === "ACCOUNT" && b.user ? <Link href={`/admin/members/${b.user.id}`}>{b.user.name}</Link> : b.value}</strong>
                    <small>
                      {t(`types.${b.type}`)} · {b.reason} · {b.createdBy ? t("by", { name: b.createdBy.name }) : t("bySystem")} · {format.dateTime(b.createdAt, { dateStyle: "medium" })} ·{" "}
                      {b.expiresAt ? t("until", { date: when(b.expiresAt) }) : t("permanent")}
                    </small>
                  </span>
                  <span className={`gcs-sysChip gcs-sysChip--${status === "active" ? "down" : "off"}`} data-state={status}>
                    {t(`status.${status}`)}
                  </span>
                  {canEdit && (
                    <GcsAcpEditPanel
                      title={subject}
                      titleIcon={<GcsIconSvg icon={faPen} />}
                      testId="gcs-bans-edit"
                      footer={
                        status === "active" ? (
                          <GcsActionForm compact variant="ghost" action={liftBanAction.bind(null, b.id)} submitLabel={t("lift")} submitKind="lift" confirm={t("liftConfirm")}>
                            {null}
                          </GcsActionForm>
                        ) : undefined
                      }
                    >
                      <GcsActionForm action={updateBanAction.bind(null, b.id)} submitLabel={t("save")} submitKind="save">
                        <p className="gcs-sysMuted" style={{ margin: 0 }}>
                          {t(`types.${b.type}`)} · {t(`status.${status}`)}
                          {b.liftedAt && ` · ${t("liftedAt", { date: when(b.liftedAt) })}`}
                        </p>
                        <label className="gcs-field">
                          {t("new.reason")}
                          <input className="gcs-input" name="reason" required maxLength={500} defaultValue={b.reason} />
                        </label>
                        {!b.liftedAt && (
                          <label className="gcs-field">
                            {t("new.duration")}
                            <select className="gcs-input" name="duration" defaultValue="keep">
                              <option value="keep">{b.expiresAt ? t("keepUntil", { date: when(b.expiresAt) }) : t("keepPermanent")}</option>
                              {DURATIONS.map((d) => (
                                <option key={d} value={d}>
                                  {d === "permanent" ? t("durations.permanent") : t("fromNow", { duration: t(`durations.${d}`) })}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </GcsActionForm>
                    </GcsAcpEditPanel>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {list.pages > 1 && (
          <p className="gcs-bansPager">
            {list.page > 1 && <Link href={href(list.page - 1)}>{t("prev")}</Link>}
            <span className="gcs-sysMuted">{t("page", { page: list.page, pages: list.pages })}</span>
            {list.page < list.pages && <Link href={href(list.page + 1)}>{t("next")}</Link>}
          </p>
        )}
      </GcsCard>
    </>
  );
}
