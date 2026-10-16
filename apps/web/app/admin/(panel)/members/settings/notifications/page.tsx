import { GCS_CHANNEL_STATES, GCS_EMAIL_MODES, GCS_NOTIFY_CHANNELS, NOTIFICATIONS_ACP_SECTION, NOTIFICATIONS_PRUNE_DAYS_SETTING, NOTIFICATIONS_PRUNE_UNREAD_SETTING } from "@gcs/core";
import { WEEKLY_DAY_SETTING, WEEKLY_ENABLED_SETTING, WEEKLY_HOUR_SETTING } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { GcsMemberLink } from "@/lib/member-names";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import {
  resetAllNotificationPreferences,
  resetNotificationDefaults,
  saveNotificationDefaults,
  saveNotificationPrune,
  saveNotificationSchedule,
  setMemberEmailsOff,
} from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.notifications"))("title") };
}

const STATS_DAYS = 30;

/**
 * ACP → Membri → Setări membri → Notificări (Notificări v2): valorile implicite pe categorii și tipuri (fiecare canal
 * pornit / doar important / oprit, blocat „forțat” sau „dezactivat”, modul emailului), programul digesturilor și al
 * rezumatului săptămânal, curățenia, statisticile pe canal, „Oprește toate emailurile” pentru un membru și resetările
 * (cu confirmare în pagină).
 */
export default async function AcpNotificationDefaultsPage() {
  await requireAcpSection(NOTIFICATIONS_ACP_SECTION);
  const [t, tAll, ts, format] = await Promise.all([getTranslations("acp.notifications"), getTranslations(), getTranslations("settings.notifications"), getFormatter()]);
  const { notifications, settings, db } = services();
  const [catalog, defaults, digestHour, weeklyEnabled, weeklyDay, weeklyHour, pruneDays, pruneUnread, stats, blocked] = await Promise.all([
    notifications.catalog(),
    notifications.defaults(),
    settings.get<number>("notifications.digest_hour"),
    settings.get<boolean>(WEEKLY_ENABLED_SETTING),
    settings.get<number>(WEEKLY_DAY_SETTING),
    settings.get<number>(WEEKLY_HOUR_SETTING),
    settings.get<number>(NOTIFICATIONS_PRUNE_DAYS_SETTING),
    settings.get<boolean>(NOTIFICATIONS_PRUNE_UNREAD_SETTING),
    notifications.stats(STATS_DAYS),
    db.notificationMember.findMany({ where: { emailsOff: true }, orderBy: { emailsOffAt: "desc" }, take: 50, select: { userId: true, emailsOffAt: true, user: { select: { id: true, name: true } } } }),
  ]);
  const label = (key: string, fallback: string) => (tAll.has(key) ? tAll(key) : fallback);
  const typeLabels = new Map(catalog.flatMap((c) => c.types.map((x) => [x.key, label(x.labelKey, x.key)] as const)));
  const pct = (clicked: number, sent: number) => (sent > 0 ? format.number(clicked / sent, { style: "percent", maximumFractionDigits: 1 }) : "—");
  const days = [0, 1, 2, 3, 4, 5, 6];

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-bell">{t("title")}</GcsAcpTitle>

      <GcsCard as="section" aria-label={t("defaultsTitle")} className="gcs-acpNotif__card">
        <h2 className="gcs-acpNotif__title">
          <GcsIcon name="fa-solid fa-sliders" className="gcs-hIcon" />
          {t("defaultsTitle")}
        </h2>
        <p className="gcs-muted gcs-acpNotif__hint">{t("hint")}</p>
        <GcsActionForm action={saveNotificationDefaults} submitLabel={t("save")} submitKind="save">
          {catalog.map((cat) => (
            <details key={cat.key} className="gcs-prefGrid__category" open data-testid={`gcs-acp-notif-category-${cat.key}`}>
              <summary className="gcs-prefGrid__summary">
                <span className="gcs-prefGrid__catIcon" aria-hidden="true">
                  <GcsIcon name={cat.icon} />
                </span>
                <span className="gcs-prefGrid__catName">{label(cat.labelKey, cat.key)}</span>
                <span className="gcs-prefGrid__catCount">{cat.types.length}</span>
              </summary>
              <div className="gcs-prefGrid__table gcs-prefGrid__table--acp" role="table" aria-label={label(cat.labelKey, cat.key)}>
                <div className="gcs-prefGrid__row gcs-prefGrid__row--head" role="row">
                  <span role="columnheader">{ts("type")}</span>
                  {GCS_NOTIFY_CHANNELS.map((ch) => (
                    <span key={ch} role="columnheader">
                      {ts(`channel_${ch}`)}
                    </span>
                  ))}
                  <span role="columnheader">{ts("emailMode")}</span>
                </div>
                {cat.types.map((x) => {
                  const d = defaults[x.key]!;
                  const name = label(x.labelKey, x.key);
                  return (
                    <div key={x.key} className="gcs-prefGrid__row" role="row" data-testid={`gcs-acp-notif-${x.key}`}>
                      <span role="rowheader" className="gcs-prefGrid__label">
                        {name}
                        {x.important && (
                          <span className="gcs-prefGrid__important" title={ts("importantType")}>
                            <GcsIcon name="fa-solid fa-star" />
                          </span>
                        )}
                      </span>
                      {GCS_NOTIFY_CHANNELS.map((ch) => (
                        <span key={ch} role="cell" className="gcs-prefGrid__cell gcs-prefGrid__cell--acp">
                          <span className="gcs-prefGrid__cellLabel">{ts(`channel_${ch}`)}</span>
                          <select className="gcs-input gcs-prefGrid__select" name={`ch:${x.key}:${ch}`} defaultValue={d[ch]} aria-label={`${ts(`channel_${ch}`)}: ${name}`} data-testid={`gcs-acp-notif-${x.key}-${ch}`}>
                            {GCS_CHANNEL_STATES.map((s) => (
                              <option key={s} value={s}>
                                {ts(`state_${s}`)}
                              </option>
                            ))}
                          </select>
                          <select
                            className="gcs-input gcs-prefGrid__select gcs-prefGrid__select--lock"
                            name={`lock:${x.key}:${ch}`}
                            defaultValue={d.locks[ch] ?? ""}
                            aria-label={`${t("lock")} ${ts(`channel_${ch}`)}: ${name}`}
                            data-testid={`gcs-acp-notif-${x.key}-${ch}-lock`}
                          >
                            <option value="">{t("lockNone")}</option>
                            <option value="forced">{t("lockForced")}</option>
                            <option value="disabled">{t("lockDisabled")}</option>
                          </select>
                        </span>
                      ))}
                      <span role="cell" className="gcs-prefGrid__cell">
                        <span className="gcs-prefGrid__cellLabel">{ts("emailMode")}</span>
                        <select className="gcs-input gcs-prefGrid__select" name={`mode:${x.key}`} defaultValue={d.emailMode} aria-label={`${ts("emailMode")}: ${name}`} data-testid={`gcs-acp-notif-${x.key}-emailMode`}>
                          {GCS_EMAIL_MODES.map((m) => (
                            <option key={m} value={m}>
                              {ts(`mode_${m}`)}
                            </option>
                          ))}
                        </select>
                      </span>
                    </div>
                  );
                })}
              </div>
            </details>
          ))}
        </GcsActionForm>
        <div className="gcs-acpNotif__resets">
          <GcsActionForm action={resetAllNotificationPreferences} submitLabel={t("resetMembers")} submitKind="reset" variant="ghost" confirm={t("resetMembersConfirm")} />
          <GcsActionForm action={resetNotificationDefaults} submitLabel={t("resetDefaults")} submitKind="reset" variant="ghost" confirm={t("resetDefaultsConfirm")} />
        </div>
      </GcsCard>

      <div className="gcs-acpNotif__grid">
        <GcsCard as="section" aria-label={t("scheduleTitle")} className="gcs-acpNotif__card">
          <h2 className="gcs-acpNotif__title">
            <GcsIcon name="fa-solid fa-clock" className="gcs-hIcon" />
            {t("scheduleTitle")}
          </h2>
          <GcsActionForm action={saveNotificationSchedule} submitLabel={t("save")} submitKind="save">
            <label className="gcs-field">
              {ts("digest_hour")}
              <input className="gcs-input" name="digestHour" type="number" min={0} max={23} defaultValue={digestHour} required />
            </label>
            <label className="gcs-check">
              <input type="checkbox" name="weeklyEnabled" defaultChecked={weeklyEnabled} />
              {ts("weekly_enabled")}
            </label>
            <label className="gcs-field">
              {ts("weekly_day")}
              <select className="gcs-input" name="weeklyDay" defaultValue={String(weeklyDay)}>
                {days.map((d) => (
                  <option key={d} value={d}>
                    {t(`days.${d}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="gcs-field">
              {ts("weekly_hour")}
              <input className="gcs-input" name="weeklyHour" type="number" min={0} max={23} defaultValue={weeklyHour} required />
            </label>
          </GcsActionForm>
        </GcsCard>

        <GcsCard as="section" aria-label={t("pruneTitle")} className="gcs-acpNotif__card">
          <h2 className="gcs-acpNotif__title">
            <GcsIcon name="fa-solid fa-broom" className="gcs-hIcon" />
            {t("pruneTitle")}
          </h2>
          <p className="gcs-muted gcs-acpNotif__hint">{t("pruneHint")}</p>
          <GcsActionForm action={saveNotificationPrune} submitLabel={t("save")} submitKind="save">
            <label className="gcs-field">
              {ts("prune_days")}
              <input className="gcs-input" name="pruneDays" type="number" min={1} max={3650} defaultValue={pruneDays} required data-testid="gcs-acp-notif-prune-days" />
            </label>
            <label className="gcs-check">
              <input type="checkbox" name="pruneUnread" defaultChecked={pruneUnread} />
              {ts("prune_unread")}
            </label>
          </GcsActionForm>
        </GcsCard>
      </div>

      <GcsCard as="section" aria-label={t("statsTitle")} className="gcs-acpNotif__card" data-testid="gcs-acp-notif-stats">
        <h2 className="gcs-acpNotif__title">
          <GcsIcon name="fa-solid fa-chart-column" className="gcs-hIcon" />
          {t("statsTitle", { days: STATS_DAYS })}
        </h2>
        <div className="gcs-acpNotif__tiles">
          {stats.channels.map((c) => (
            <div key={c.channel} className="gcs-acpNotif__tile" data-testid={`gcs-acp-notif-stat-${c.channel}`}>
              <span className="gcs-acpNotif__tileLabel">{ts(`channel_${c.channel}`)}</span>
              <strong className="gcs-acpNotif__tileValue">{format.number(c.sent)}</strong>
              <span className="gcs-acpNotif__tileSub">{t("statsClicked", { clicked: format.number(c.clicked), rate: pct(c.clicked, c.sent) })}</span>
            </div>
          ))}
        </div>
        {stats.types.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table className="gcs-prefTable gcs-acpNotif__statsTable">
              <thead>
                <tr>
                  <th scope="col">{ts("type")}</th>
                  <th scope="col">{t("statsSent")}</th>
                  <th scope="col">{t("statsOpened")}</th>
                  <th scope="col">{t("statsRate")}</th>
                </tr>
              </thead>
              <tbody>
                {stats.types.slice(0, 15).map((r) => (
                  <tr key={r.type}>
                    <th scope="row">{typeLabels.get(r.type) ?? r.type}</th>
                    <td>{format.number(r.sent)}</td>
                    <td>{format.number(r.clicked)}</td>
                    <td>{pct(r.clicked, r.sent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GcsCard>

      <GcsCard as="section" aria-label={t("emailsOffTitle")} className="gcs-acpNotif__card" data-testid="gcs-acp-notif-emails-off">
        <h2 className="gcs-acpNotif__title">
          <GcsIcon name="fa-solid fa-envelope-circle-check" className="gcs-hIcon" />
          {t("emailsOffTitle")}
        </h2>
        <p className="gcs-muted gcs-acpNotif__hint">{t("emailsOffHint")}</p>
        <GcsActionForm action={setMemberEmailsOff} submitLabel={t("emailsOffButton")} submitKind="ban" confirm={t("emailsOffConfirm")}>
          <label className="gcs-field" style={{ maxWidth: 360 }}>
            {t("emailsOffMember")}
            <input className="gcs-input" name="member" required maxLength={200} autoComplete="off" data-testid="gcs-acp-notif-emails-off-member" />
          </label>
        </GcsActionForm>
        {blocked.length > 0 && (
          <ul className="gcs-acpNotif__blocked">
            {blocked.map((b) => (
              <li key={b.userId} className="gcs-acpNotif__blockedRow" data-testid="gcs-acp-notif-emails-off-row">
                <GcsMemberLink user={b.user} />
                {b.emailsOffAt && <span className="gcs-muted">{format.dateTime(b.emailsOffAt, { dateStyle: "medium" })}</span>}
                <GcsActionForm action={setMemberEmailsOff} submitLabel={t("emailsOnButton")} submitKind="lift" variant="ghost" compact>
                  <input type="hidden" name="userId" value={b.userId} />
                  <input type="hidden" name="off" value="0" />
                </GcsActionForm>
              </li>
            ))}
          </ul>
        )}
      </GcsCard>
    </>
  );
}
