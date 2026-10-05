import { ACP_WIDGETS, checkHealth, type GcsAcpWidget } from "@gcs/core";
import { GcsCard, GcsUserLink } from "@gcs/ui";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { requireAcpPanel } from "@/lib/acp";
import { getHealthDeps } from "@/lib/health-deps";
import { services } from "@/lib/services";
import { GcsAcpDashboard } from "./_components/GcsAcpDashboard";
import { AdminNotesWidget } from "./_components/widgets/AdminNotesWidget";
import { RegistrationsWidget } from "./_components/widgets/RegistrationsWidget";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("acp.dashboard");
  return { title: t("title") };
}

const muted = { color: "var(--gcs-muted)", fontSize: 13 } as const;
const row = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: "1px solid var(--gcs-border)", fontSize: 13 } as const;

export default async function AcpDashboardPage() {
  const panel = await requireAcpPanel();
  const { acp, acpDashboard } = services();
  if (!(await acp.can(panel.actor, "system.dashboard", "view"))) {
    // Un admin fără dashboard ajunge pe prima secțiune pe care o vede.
    const first = panel.menu[0]?.items[0]?.href;
    if (first && first !== "/admin") redirect(first);
    // Fără niciun drept ACP: nimic de arătat (ca pentru cine nu are acces).
    notFound();
  }

  const t = await getTranslations("acp.dashboard");
  const format = await getFormatter();
  const [layout, totals, registrations, health, note, online, admins, failed, canEditNote] = await Promise.all([
    acpDashboard.getLayout(panel.user.id),
    acpDashboard.totals(),
    acpDashboard.registrations(14),
    checkHealth(getHealthDeps()),
    acpDashboard.getNote(),
    acpDashboard.onlineCount(),
    acpDashboard.onlineAdmins(),
    acpDashboard.failedAcpLogins(5),
    acp.can(panel.actor, "system.dashboard", "edit"),
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
    system_health: {
      title: w("system_health", "title"),
      body: (
        <div>
          <div style={row}>
            <span>{w("system_health", "db")}</span>
            {status(health.db)}
          </div>
          <div style={{ ...row, borderBottom: 0 }}>
            <span>{w("system_health", "redis")}</span>
            {status(health.redis)}
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
          <strong className="gcs-display" style={{ fontSize: 26, marginRight: 8 }}>
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
                <GcsUserLink userId={a.id} name={a.name} groupKey={a.groupKey} href={`/admin/members/${a.id}`} />
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

  const per = (key: string) =>
    Object.fromEntries(ACP_WIDGETS.map((id) => [id, t(key, { title: widgets[id].title })])) as Record<string, string>;
  const allOk = health.db && health.redis;
  const kpis = [
    { label: t("kpis.members"), value: totals.members },
    { label: t("kpis.today"), value: totals.today },
    { label: t("kpis.online"), value: totals.online },
  ];

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h1 className="gcs-display" style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>
          {t("title")}
        </h1>
        <span style={muted}>{allOk ? t("statusOk") : t("statusDegraded")}</span>
      </div>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
        {kpis.map((k) => (
          <GcsCard key={k.label} style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--gcs-muted)", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700 }}>
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
        widgets={widgets}
        labels={{ move: per("move"), collapse: per("collapse"), expand: per("expand"), moveToOther: per("moveToOther") }}
      />
    </>
  );
}
