import { ACP_WIDGETS, checkHealth, serviceStatus, type GcsAcpWidget } from "@gcs/core";
import { GcsCard, GcsUserLink } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { requireAcpPanel } from "@/lib/acp";
import { getHealthDeps } from "@/lib/health-deps";
import { services } from "@/lib/services";
import { GcsAcpDashboard } from "./_components/GcsAcpDashboard";
import { GcsAcpTitle } from "./_components/GcsAcpTitle";
import { AdminNotesWidget } from "./_components/widgets/AdminNotesWidget";
import { RegistrationsWidget } from "./_components/widgets/RegistrationsWidget";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("acp.dashboard");
  return { title: t("title") };
}

const muted = { color: "var(--gcs-muted)", fontSize: 13 } as const;
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
};

const row = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: "1px solid var(--gcs-border)", fontSize: 13 } as const;

export default async function AcpDashboardPage() {
  const panel = await requireAcpPanel();
  const { acp, acpDashboard, moderation, redis, vip } = services();
  if (!(await acp.can(panel.actor, "system.dashboard", "view"))) {
    // Un admin fără dashboard ajunge pe prima secțiune pe care o vede.
    const first = panel.menu[0]?.items[0]?.href;
    if (first && first !== "/admin") redirect(first);
    // Fără niciun drept ACP: nimic de arătat (ca pentru cine nu are acces).
    notFound();
  }

  const t = await getTranslations("acp.dashboard");
  const format = await getFormatter();
  const siteName = await services().settings.get<string>("site.name");
  const [layout, totals, registrations, health, note, online, admins, failed, canEditNote, queue, worker, [expiring], realtime] = await Promise.all([
    acpDashboard.getLayout(panel.user.id),
    acpDashboard.totals(),
    acpDashboard.registrations(14),
    checkHealth(getHealthDeps()),
    acpDashboard.getNote(),
    acpDashboard.onlineCount(),
    acpDashboard.onlineAdmins(),
    acpDashboard.failedAcpLogins(5),
    acp.can(panel.actor, "system.dashboard", "edit"),
    moderation.queueCount(panel.actor),
    serviceStatus(redis, "worker").catch(() => ({ up: false, lastBeatAt: null })),
    vip.subscribers({ expiringDays: 7, page: 1, perPage: 8 }),
    serviceStatus(redis, "realtime").catch(() => ({ up: false, lastBeatAt: null })),
  ]);

  const w = (key: GcsAcpWidget, k: string, values?: Record<string, string | number>) => t(`widgets.${key}.${k}`, values);
  const status = (ok: boolean) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span className="gcs-dot" style={{ background: ok ? "var(--gcs-ok)" : "#FF4D57" }} />
      {ok ? w("system_health", "ok") : w("system_health", "down")}
    </span>
  );

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
          <div style={row}>
            <span>{w("moderation_queue", "pending", { count: queue.pending })}</span>
          </div>
          <div style={row}>
            <span>{w("moderation_queue", "reports", { count: queue.reports })}</span>
          </div>
          <p style={{ margin: 0, padding: "12px 16px" }}>
            <Link href="/admin/members/moderation/queue">{w("moderation_queue", "open")}</Link>
          </p>
        </div>
      ),
    },
    vip_expiring: {
      title: w("vip_expiring", "title"),
      body: (
        <div data-testid="gcs-widget-vip-expiring">
          {expiring.length === 0 && (
            <div style={{ ...row, borderBottom: 0 }}>
              <span style={muted}>{w("vip_expiring", "empty")}</span>
            </div>
          )}
          {expiring.map((s) => (
            <div key={s.id} style={row}>
              <Link href={`/admin/members/${s.user.id}`}>{s.user.name}</Link>
              <span style={muted}>
                {s.group.name} · {s.expiresAt ? format.relativeTime(s.expiresAt) : "—"}
              </span>
            </div>
          ))}
          <div style={{ ...row, borderBottom: 0 }}>
            <Link href="/admin/vip/subscribers?expiring=1">{w("vip_expiring", "all")}</Link>
          </div>
        </div>
      ),
    },
    system_health: {
      title: w("system_health", "title"),
      body: (
        <div>
          <div style={row}>
            <span>{w("system_health", "db")}</span>
            {status(health.db)}
          </div>
          <div style={row}>
            <span>{w("system_health", "redis")}</span>
            {status(health.redis)}
          </div>
          <div style={row} data-testid="gcs-health-worker">
            <span>{w("system_health", "worker")}</span>
            {status(worker.up)}
          </div>
          <div style={{ ...row, borderBottom: 0 }} data-testid="gcs-health-realtime">
            <span>{w("system_health", "realtime")}</span>
            {status(realtime.up)}
          </div>
        </div>
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
        <p style={{ margin: 0, padding: "14px 16px", fontSize: 14 }}>
          <strong className="gcs-display" style={{ fontSize: 26, marginRight: 8 }} data-testid="gcs-online-users-count">
            {online}
          </strong>
          <span style={muted}>{w("online_users", "body", { count: online })}</span>
        </p>
      ),
    },
    online_admins: {
      title: w("online_admins", "title"),
      body:
        admins.length === 0 ? (
          <p style={{ ...muted, margin: 0, padding: "14px 16px" }}>{w("online_admins", "empty")}</p>
        ) : (
          <div>
            {admins.map((a) => (
              <div key={a.id} style={row}>
                <GcsUserLink userId={a.id} name={a.name} nameKey={a.groupKey} href={`/admin/members/${a.id}`} />
              </div>
            ))}
          </div>
        ),
    },
    failed_acp_logins: {
      title: w("failed_acp_logins", "title"),
      body:
        failed.length === 0 ? (
          <p style={{ ...muted, margin: 0, padding: "14px 16px" }}>{w("failed_acp_logins", "empty")}</p>
        ) : (
          <div>
            {failed.map((f, i) => (
              <div key={i} style={row}>
                <span>{f.userName ?? w("failed_acp_logins", "unknown")}</span>
                <span style={muted}>
                  {f.ip ?? "—"} · {format.relativeTime(f.at)}
                </span>
              </div>
            ))}
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
  const kpis = [
    { label: t("kpis.members"), value: totals.members, icon: "fa-solid fa-users" },
    { label: t("kpis.today"), value: totals.today, icon: "fa-solid fa-user-plus" },
    { label: t("kpis.online"), value: totals.online, icon: "fa-solid fa-signal" },
  ];

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <GcsAcpTitle icon="fa-solid fa-gauge-high">{t("title")}</GcsAcpTitle>
        <span style={muted}>{allOk ? t("statusOk", { site: siteName }) : t("statusDegraded", { site: siteName })}</span>
      </div>

      {!worker.up && (
        <GcsCard role="alert" data-testid="gcs-banner-worker" style={{ padding: "14px 18px", borderColor: "#FF4D57", display: "flex", flexDirection: "column", gap: 4 }}>
          <strong style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <GcsIcon name="fa-solid fa-triangle-exclamation" className="gcs-acpTitle__icon" />
            {t("banners.workerDown.title")}
          </strong>
          <span style={muted}>
            {worker.lastBeatAt
              ? t("banners.workerDown.since", { time: format.relativeTime(worker.lastBeatAt) })
              : t("banners.workerDown.never")}
          </span>
        </GcsCard>
      )}

      {!realtime.up && (
        <GcsCard role="alert" data-testid="gcs-banner-realtime" style={{ padding: "14px 18px", borderColor: "#FF4D57", display: "flex", flexDirection: "column", gap: 4 }}>
          <strong style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <GcsIcon name="fa-solid fa-triangle-exclamation" className="gcs-acpTitle__icon" />
            {t("banners.realtimeDown.title")}
          </strong>
          <span style={muted}>{t("banners.realtimeDown.body")}</span>
        </GcsCard>
      )}

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
        {kpis.map((k) => (
          <GcsCard key={k.label} style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
            <span
              style={{ fontSize: 12, color: "var(--gcs-muted)", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}
            >
              <GcsIcon name={k.icon} className="gcs-acpTitle__icon" />
              {k.label}
            </span>
            <span className="gcs-display" style={{ fontSize: 30, fontWeight: 700 }}>
              {format.number(k.value)}
            </span>
          </GcsCard>
        ))}
      </section>

      <GcsAcpDashboard
        layout={{ main: layout.main, side: layout.side, collapsed: layout.collapsed }}
        widgets={withIcons}
        labels={{ move: per("move"), collapse: per("collapse"), expand: per("expand"), moveToOther: per("moveToOther") }}
      />
    </>
  );
}
