import { ACP_WIDGETS, checkHealth, CRON_STALE_MS, realtimeStatus, serviceStatus, type GcsAcpWidget } from "@gcs/core";
import { GcsAvatar, GcsButton, GcsCard, GcsMemberName } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { requireAcpPanel } from "@/lib/acp";
import { cronLastRun } from "@/lib/cron";
import { getHealthDeps } from "@/lib/health-deps";
import { services } from "@/lib/services";
import { diskUsage, GCS_APP_VERSION } from "@/lib/system-info";
import { GcsAcpAreaChart } from "./_components/dashboard/GcsAcpAreaChart";
import { changePct, GcsAcpKpiCard, GcsAcpSparkCard, type GcsAcpTone } from "./_components/dashboard/GcsAcpCharts";
import { GcsAcpDashboard } from "./_components/GcsAcpDashboard";
import { GcsAcpPageHeader } from "./_components/GcsAcpPageHeader";
import { AdminNotesWidget } from "./_components/widgets/AdminNotesWidget";
import { RegistrationsWidget } from "./_components/widgets/RegistrationsWidget";
import { GcsMemberLink } from "@/lib/member-names";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("acp.dashboard");
  return { title: t("title") };
}

/** Iconițele titlurilor widgeturilor de pe dashboard. */
const WIDGET_ICONS: Record<GcsAcpWidget, string> = {
  registrations: "fa-solid fa-user-plus",
  moderation_queue: "fa-solid fa-inbox",
  vip_expiring: "fa-solid fa-hourglass-half",
  system_health: "fa-solid fa-heart-pulse",
  admin_notes: "fa-solid fa-note-sticky",
  online_users: "fa-solid fa-signal",
  online_admins: "fa-solid fa-user-shield",
  failed_acp_logins: "fa-solid fa-user-lock",
  latest_members: "fa-solid fa-user-clock",
  pending_content: "fa-solid fa-hourglass-start",
  open_reports: "fa-solid fa-flag",
  acp_log: "fa-solid fa-clipboard-list",
};

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** Un rând dintr-o listă rapidă: conținutul în stânga, detaliile (estompate) în dreapta. */
function Row({ children, meta, testId }: { children: ReactNode; meta?: ReactNode; testId?: string }) {
  return (
    <li className="gcs-acpList__row" data-testid={testId}>
      <span className="gcs-acpList__main">{children}</span>
      {meta && <span className="gcs-acpList__meta">{meta}</span>}
    </li>
  );
}

function Empty({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <p className="gcs-acpList__empty">
      <GcsIcon name={icon} />
      {children}
    </p>
  );
}

function More({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p className="gcs-acpList__more">
      <Link href={href} className="gcs-acpBack">
        {children}
        <GcsIcon name="fa-solid fa-arrow-right" />
      </Link>
    </p>
  );
}

export default async function AcpDashboardPage() {
  const panel = await requireAcpPanel();
  const { acp, acpDashboard, moderation, kv, edition, settings, vip, licenseOnline } = services();
  if (!(await acp.can(panel.actor, "system.dashboard", "view"))) {
    // Un admin fără dashboard ajunge pe prima secțiune pe care o vede.
    const first = panel.menu[0]?.items[0]?.href;
    if (first && first !== "/admin") redirect(first);
    // Fără niciun drept ACP: nimic de arătat (ca pentru cine nu are acces).
    notFound();
  }

  const t = await getTranslations("acp.dashboard");
  const format = await getFormatter();
  const locale = await getLocale();
  const [siteName, timeZone] = await Promise.all([settings.get<string>("site.name"), settings.get<string>("site.timezone").catch(() => "Europe/Bucharest")]);
  const canLogs = panel.rights["system.logs"]?.view === true;
  const [layout, overview, registrations, health, note, online, admins, failed, canEditNote, queueCount, queue, worker, [expiring], realtime, disk, cronAt, licenseState] =
    await Promise.all([
      acpDashboard.getLayout(panel.user.id),
      acpDashboard.overview(new Date(), timeZone),
      acpDashboard.registrations(14),
      checkHealth(getHealthDeps()),
      acpDashboard.getNote(),
      acpDashboard.onlineCount(),
      acpDashboard.onlineAdmins(),
      acpDashboard.failedAcpLogins(5),
      acp.can(panel.actor, "system.dashboard", "edit"),
      moderation.queueCount(panel.actor),
      moderation.queue(panel.actor, { page: 1 }),
      serviceStatus(kv, "worker").catch(() => ({ up: false, lastBeatAt: null })),
      vip.subscribers({ expiringDays: 7, page: 1, perPage: 8 }),
      realtimeStatus(kv, edition).catch(() => ({ up: false, lastBeatAt: null })),
      diskUsage(),
      // Ediția Lite: joburile programate rulează la cron-ul gazdei (fără el, doar cât procesul e treaz).
      edition === "lite" ? cronLastRun() : Promise.resolve(null),
      licenseOnline.read().catch(() => null),
    ]);
  // Licența declarată invalidă de platforma-mamă: perioada de grație (aplicațiile premium încă pornite) sau după ea.
  const licenseGraceEnds = licenseOnline.graceEndsAt(licenseState);
  const licenseBlocked = licenseGraceEnds !== null && Date.now() >= licenseGraceEnds.getTime();
  const cronStale = edition === "lite" && (cronAt === null || Date.now() - cronAt > CRON_STALE_MS);

  const w = (key: GcsAcpWidget, k: string, values?: Record<string, string | number>) => t(`widgets.${key}.${k}`, values);
  const status = (ok: boolean) => (
    <span className={`gcs-acpStatus gcs-acpStatus--${ok ? "ok" : "down"}`}>
      <GcsIcon name={ok ? "fa-solid fa-circle-check" : "fa-solid fa-circle-xmark"} />
      {ok ? w("system_health", "ok") : w("system_health", "down")}
    </span>
  );
  const ago = (iso: string) => format.relativeTime(new Date(iso));
  const gb = (bytes: number) => format.number(bytes / 1e9, { maximumFractionDigits: 1 });

  const widgets: Record<GcsAcpWidget, { title: string; body: ReactNode }> = {
    registrations: {
      title: w("registrations", "title"),
      body: (
        <RegistrationsWidget
          data={registrations}
          labels={{
            subtitle: w("registrations", "subtitle"),
            series: w("registrations", "series"),
            area: w("registrations", "area"),
            column: w("registrations", "column"),
            bar: w("registrations", "bar"),
            csv: w("registrations", "csv"),
          }}
        />
      ),
    },
    moderation_queue: {
      title: w("moderation_queue", "title"),
      body: (
        <div data-testid="gcs-widget-moderation">
          <ul className="gcs-acpList">
            <Row meta={<GcsIcon name="fa-solid fa-hourglass-half" />}>{w("moderation_queue", "pending", { count: queueCount.pending })}</Row>
            <Row meta={<GcsIcon name="fa-solid fa-flag" />}>{w("moderation_queue", "reports", { count: queueCount.reports })}</Row>
          </ul>
          <More href="/admin/members/moderation/queue">{w("moderation_queue", "open")}</More>
        </div>
      ),
    },
    vip_expiring: {
      title: w("vip_expiring", "title"),
      body: (
        <div data-testid="gcs-widget-vip-expiring">
          {expiring.length === 0 ? (
            <Empty icon="fa-solid fa-crown">{w("vip_expiring", "empty")}</Empty>
          ) : (
            <ul className="gcs-acpList">
              {expiring.map((s) => (
                <Row key={s.id} meta={`${s.group.name} · ${s.expiresAt ? format.relativeTime(s.expiresAt) : "—"}`}>
                  <GcsMemberLink user={s.user} href={`/admin/members/${s.user.id}`} />
                </Row>
              ))}
            </ul>
          )}
          <More href="/admin/vip/subscribers?expiring=1">{w("vip_expiring", "all")}</More>
        </div>
      ),
    },
    system_health: {
      title: w("system_health", "title"),
      body: (
        <ul className="gcs-acpList" data-testid="gcs-widget-system">
          <Row meta={status(health.db)}>
            <GcsIcon name="fa-solid fa-database" className="gcs-acpList__icon" />
            {w("system_health", "db")}
          </Row>
          <Row meta={status(health.redis)}>
            <GcsIcon name="fa-solid fa-layer-group" className="gcs-acpList__icon" />
            {w("system_health", "redis")}
          </Row>
          <Row meta={status(worker.up)} testId="gcs-health-worker">
            <GcsIcon name="fa-solid fa-gears" className="gcs-acpList__icon" />
            {w("system_health", "worker")}
          </Row>
          <Row meta={status(realtime.up)} testId="gcs-health-realtime">
            <GcsIcon name="fa-solid fa-tower-broadcast" className="gcs-acpList__icon" />
            {w("system_health", "realtime")}
          </Row>
          <Row
            meta={disk ? w("system_health", "diskValue", { free: gb(disk.free), total: gb(disk.total) }) : w("system_health", "diskUnknown")}
            testId="gcs-health-disk"
          >
            <GcsIcon name="fa-solid fa-hard-drive" className="gcs-acpList__icon" />
            {w("system_health", "disk")}
          </Row>
          <Row meta={<code>{GCS_APP_VERSION}</code>} testId="gcs-health-version">
            <GcsIcon name="fa-solid fa-code-branch" className="gcs-acpList__icon" />
            {w("system_health", "version")}
          </Row>
        </ul>
      ),
    },
    admin_notes: {
      title: w("admin_notes", "title"),
      body: (
        <AdminNotesWidget
          initial={note.body}
          canEdit={canEditNote}
          updatedLine={
            note.updatedAt
              ? w("admin_notes", "updated", { name: note.updatedBy ?? "—", time: format.relativeTime(note.updatedAt) })
              : w("admin_notes", "never")
          }
          labels={{ label: w("admin_notes", "label"), save: w("admin_notes", "save"), saved: w("admin_notes", "saved") }}
        />
      ),
    },
    online_users: {
      title: w("online_users", "title"),
      body: (
        <p className="gcs-acpWidget__stat">
          <strong className="gcs-display" data-testid="gcs-online-users-count">
            {online}
          </strong>
          <span>{w("online_users", "body", { count: online })}</span>
        </p>
      ),
    },
    online_admins: {
      title: w("online_admins", "title"),
      body:
        admins.length === 0 ? (
          <Empty icon="fa-solid fa-user-shield">{w("online_admins", "empty")}</Empty>
        ) : (
          <ul className="gcs-acpList">
            {admins.map((a) => (
              <Row key={a.id}>
                <GcsMemberLink user={a} href={`/admin/members/${a.id}`} />
              </Row>
            ))}
          </ul>
        ),
    },
    failed_acp_logins: {
      title: w("failed_acp_logins", "title"),
      body:
        failed.length === 0 ? (
          <Empty icon="fa-solid fa-lock">{w("failed_acp_logins", "empty")}</Empty>
        ) : (
          <ul className="gcs-acpList">
            {failed.map((f, i) => (
              <Row key={i} meta={`${f.ip ?? "—"} · ${format.relativeTime(f.at)}`}>
                {f.userName ?? w("failed_acp_logins", "unknown")}
              </Row>
            ))}
          </ul>
        ),
    },
    latest_members: {
      title: w("latest_members", "title"),
      body: (
        <div data-testid="gcs-widget-latest-members">
          {overview.latestMembers.length === 0 ? (
            <Empty icon="fa-solid fa-user">{w("latest_members", "empty")}</Empty>
          ) : (
            <ul className="gcs-acpList">
              {overview.latestMembers.map((m) => (
                <Row key={m.id} meta={ago(m.createdAt)}>
                  <GcsAvatar name={m.name} size="xs" {...(m.image ? { src: m.image } : {})} />
                  <GcsMemberLink user={m} href={`/admin/members/${m.id}`} />
                  <span className="gcs-acpList__sub">{m.groupName}</span>
                </Row>
              ))}
            </ul>
          )}
          <More href="/admin/members">{w("latest_members", "all")}</More>
        </div>
      ),
    },
    pending_content: {
      title: w("pending_content", "title"),
      body: (
        <div data-testid="gcs-widget-pending">
          {queue.pending.length === 0 ? (
            <Empty icon="fa-solid fa-circle-check">{w("pending_content", "empty")}</Empty>
          ) : (
            <ul className="gcs-acpList">
              {queue.pending.slice(0, 5).map((p) => (
                <Row key={p.postId} meta={ago(p.createdAt)}>
                  <GcsIcon name={p.isTopic ? "fa-solid fa-file-circle-plus" : "fa-solid fa-reply"} className="gcs-acpList__icon" />
                  <span className="gcs-acpList__text">
                    {p.topicTitle}
                    <span className="gcs-acpList__sub">
                      {p.isTopic ? w("pending_content", "topic") : w("pending_content", "reply")} · {p.forumName}
                      {p.author ? (
                        <>
                          {" · "}
                          <GcsMemberName userId={p.author.id} name={p.author.name} nameKey={p.author.nameKey} />
                        </>
                      ) : (
                        ""
                      )}
                    </span>
                  </span>
                </Row>
              ))}
            </ul>
          )}
          <More href="/admin/members/moderation/queue">{w("pending_content", "all")}</More>
        </div>
      ),
    },
    open_reports: {
      title: w("open_reports", "title"),
      body: (
        <div data-testid="gcs-widget-open-reports">
          {queue.reports.length === 0 ? (
            <Empty icon="fa-solid fa-circle-check">{w("open_reports", "empty")}</Empty>
          ) : (
            <ul className="gcs-acpList">
              {queue.reports.slice(0, 5).map((r) => (
                <Row key={`${r.contentType}:${r.contentId}`} meta={r.reasons[0] ? ago(r.reasons[0].createdAt) : undefined}>
                  <GcsIcon name="fa-solid fa-flag" className="gcs-acpList__icon" />
                  <span className="gcs-acpList__text">
                    {r.topicTitle}
                    <span className="gcs-acpList__sub">
                      {w("open_reports", "reasons", { count: r.reasons.length })}
                      {r.reasons[0] ? ` · ${r.reasons[0].reason}` : ""}
                    </span>
                  </span>
                </Row>
              ))}
            </ul>
          )}
          <More href="/admin/members/moderation/reports">{w("open_reports", "all")}</More>
        </div>
      ),
    },
    acp_log: {
      title: w("acp_log", "title"),
      body: (
        <div data-testid="gcs-widget-acp-log">
          {!canLogs ? (
            <Empty icon="fa-solid fa-lock">{w("acp_log", "noAccess")}</Empty>
          ) : overview.audit.length === 0 ? (
            <Empty icon="fa-solid fa-clipboard">{w("acp_log", "empty")}</Empty>
          ) : (
            <ul className="gcs-acpList">
              {overview.audit.map((a) => (
                <Row key={a.id} meta={ago(a.createdAt)}>
                  <GcsIcon name="fa-solid fa-pen-to-square" className="gcs-acpList__icon" />
                  <span className="gcs-acpList__text">
                    <span>
                      <strong>{a.actorId && a.actorName ? <GcsMemberLink user={{ id: a.actorId, name: a.actorName }} href={`/admin/members/${a.actorId}`} /> : (a.actorName ?? w("acp_log", "system"))}</strong>{" "}
                      <code className="gcs-acpList__code">{a.action}</code>
                    </span>
                    <span className="gcs-acpList__sub">
                      {a.targetType} #{a.targetId}
                    </span>
                  </span>
                </Row>
              ))}
            </ul>
          )}
          {canLogs && <More href="/admin/logs">{w("acp_log", "all")}</More>}
        </div>
      ),
    },
  };

  const withIcons = Object.fromEntries(
    ACP_WIDGETS.map((id) => [id, { ...widgets[id], icon: <GcsIcon name={WIDGET_ICONS[id]} /> }]),
  ) as Record<GcsAcpWidget, { title: string; icon: ReactNode; body: ReactNode }>;

  const per = (key: string) =>
    Object.fromEntries(ACP_WIDGETS.map((id) => [id, t(key, { title: widgets[id].title })])) as Record<string, string>;
  const allOk = health.db && health.redis;
  const { totals, periods, series, days } = overview;
  const change = (current: number, previous: number, good: "up" | "down" = "up") => {
    const value = changePct(current, previous);
    return { pct: value, good, text: t("kpis.change", { change: `${value > 0 ? "+" : ""}${value}%` }) };
  };

  const kpis: { key: string; icon: string; tone: GcsAcpTone; value: number; change: ReturnType<typeof change>; bar: number }[] = [
    { key: "members", icon: "fa-solid fa-users", tone: 1, value: totals.members, change: change(periods.registrations.current, periods.registrations.previous), bar: pct(totals.active30, totals.members) },
    { key: "posts", icon: "fa-solid fa-comment-dots", tone: 2, value: totals.posts, change: change(periods.posts.current, periods.posts.previous), bar: pct(periods.posts.current, totals.posts) },
    { key: "topics", icon: "fa-solid fa-file-lines", tone: 3, value: totals.topics, change: change(periods.topics.current, periods.topics.previous), bar: pct(periods.topics.current, totals.topics) },
    { key: "online", icon: "fa-solid fa-signal", tone: 4, value: online, change: change(periods.active.current, periods.active.previous), bar: pct(online, totals.active30) },
    { key: "vips", icon: "fa-solid fa-crown", tone: 5, value: totals.vips, change: change(periods.vips.current, periods.vips.previous), bar: pct(totals.vips, totals.members) },
    { key: "reports", icon: "fa-solid fa-flag", tone: 6, value: totals.openReports, change: change(periods.reports.current, periods.reports.previous, "down"), bar: pct(totals.openReports, totals.reports) },
  ];

  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const sparks: { key: "active" | "topics" | "reports"; icon: string; tone: GcsAcpTone; values: number[]; total: number }[] = [
    { key: "active", icon: "fa-solid fa-user-check", tone: 1, values: series.active, total: series.active.at(-1) ?? 0 },
    { key: "topics", icon: "fa-solid fa-file-circle-plus", tone: 3, values: series.topics, total: sum(series.topics) },
    { key: "reports", icon: "fa-solid fa-flag", tone: 6, values: series.reports, total: sum(series.reports) },
  ];

  return (
    <>
      <GcsAcpPageHeader
        icon="fa-solid fa-gauge-high"
        title={t("title")}
        description={
          <span className={`gcs-acpStatus gcs-acpStatus--${allOk ? "ok" : "down"}`}>
            <GcsIcon name={allOk ? "fa-solid fa-circle-check" : "fa-solid fa-triangle-exclamation"} />
            {allOk ? t("statusOk", { site: siteName }) : t("statusDegraded", { site: siteName })}
          </span>
        }
        actions={
          <>
            {canLogs && (
              <GcsButton variant="ghost" size="sm" asChild icon={<GcsIcon name="fa-solid fa-clipboard-list" />}>
                <Link href="/admin/logs">{t("actions.logs")}</Link>
              </GcsButton>
            )}
            <GcsButton variant="primary" size="sm" asChild icon={<GcsIcon name="fa-solid fa-file-csv" />}>
              <a href="/admin/registrations.csv">{t("actions.export")}</a>
            </GcsButton>
          </>
        }
      />

      {!worker.up && (
        <GcsCard role="alert" data-testid="gcs-banner-worker" className="gcs-acpBanner">
          <strong>
            <GcsIcon name="fa-solid fa-triangle-exclamation" />
            {t("banners.workerDown.title")}
          </strong>
          <span>
            {worker.lastBeatAt ? t("banners.workerDown.since", { time: format.relativeTime(worker.lastBeatAt) }) : t("banners.workerDown.never")}
          </span>
        </GcsCard>
      )}

      {licenseGraceEnds && (
        <GcsCard role="alert" data-testid="gcs-banner-license" className="gcs-acpBanner">
          <strong>
            <GcsIcon name="fa-solid fa-certificate" />
            {t("banners.license.title", { reason: t.has(`banners.license.reasons.${licenseState?.status}`) ? t(`banners.license.reasons.${licenseState?.status}`) : (licenseState?.status ?? "") })}
          </strong>
          <span>
            {licenseBlocked ? t("banners.license.blocked") : t("banners.license.grace", { date: format.dateTime(licenseGraceEnds, { dateStyle: "long" }) })}
          </span>
        </GcsCard>
      )}

      {cronStale && (
        <GcsCard role="alert" data-testid="gcs-banner-cron" className="gcs-acpBanner">
          <strong>
            <GcsIcon name="fa-solid fa-clock" />
            {t("banners.cronStale.title")}
          </strong>
          <span>
            {cronAt === null ? t("banners.cronStale.never") : t("banners.cronStale.since", { time: format.relativeTime(cronAt) })}{" "}
            <Link href="/admin/system/cron">{t("banners.cronStale.link")}</Link>
          </span>
        </GcsCard>
      )}

      {!realtime.up && (
        <GcsCard role="alert" data-testid="gcs-banner-realtime" className="gcs-acpBanner">
          <strong>
            <GcsIcon name="fa-solid fa-triangle-exclamation" />
            {t("banners.realtimeDown.title")}
          </strong>
          <span>{t("banners.realtimeDown.body")}</span>
        </GcsCard>
      )}

      <div className="gcs-acpKpis" data-testid="gcs-acp-kpis">
        {kpis.map((k) => (
          <GcsAcpKpiCard
            key={k.key}
            testId={`gcs-acp-kpi-${k.key}`}
            label={t(`kpis.${k.key}`)}
            value={format.number(k.value)}
            icon={k.icon}
            tone={k.tone}
            change={k.change}
            bar={{ pct: k.bar, text: t(`kpis.bars.${k.key}`, { pct: k.bar }) }}
          />
        ))}
      </div>

      <div className="gcs-acpDash__charts">
        <section className="gcs-card gcs-acpPanel" aria-labelledby="gcs-acp-activity-title">
          <div className="gcs-acpPanel__head">
            <h2 id="gcs-acp-activity-title" className="gcs-acpPanel__title">
              <GcsIcon name="fa-solid fa-chart-area" className="gcs-acpTitle__icon" />
              {t("chart.title")}
            </h2>
            <span className="gcs-acpPanel__sub">{t("chart.subtitle")}</span>
          </div>
          <div className="gcs-acpPanel__body">
            <GcsAcpAreaChart
              days={days}
              locale={locale}
              series={[
                { key: "registrations", label: t("chart.registrations"), values: series.registrations },
                { key: "posts", label: t("chart.posts"), values: series.posts },
              ]}
              labels={{ title: t("chart.title"), caption: t("chart.caption"), day: t("chart.day") }}
            />
          </div>
        </section>
        <div className="gcs-acpDash__sparks">
          {sparks.map((s) => (
            <GcsAcpSparkCard
              key={s.key}
              testId={`gcs-acp-spark-${s.key}`}
              title={t(`sparks.${s.key}`)}
              values={s.values}
              days={days}
              total={format.number(s.total)}
              hint={t(`sparks.${s.key}Hint`)}
              icon={s.icon}
              tone={s.tone}
            />
          ))}
        </div>
      </div>

      <GcsAcpDashboard
        layout={{ main: layout.main, side: layout.side, collapsed: layout.collapsed }}
        widgets={withIcons}
        labels={{ move: per("move"), collapse: per("collapse"), expand: per("expand"), moveToOther: per("moveToOther") }}
      />
    </>
  );
}
