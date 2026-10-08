import { BRIDGE_SETTING, GCS_ADMIN_FLAGS, SERVER_ADMINS_ACP_SECTION, type GcsAdminPresence } from "@gcs/modules";
import { GcsButton, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../_components/GcsAcpTitle";
import { deleteAdminPreset, deleteServerAdmin, saveAdminPreset } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.serverAdmins"))("title") };
}

type Props = { searchParams: Promise<{ server?: string; q?: string; inactive?: string }> };

const SUBJECT_ICON = { USER: "fa-solid fa-user", PLAYER: "fa-solid fa-gamepad", NAME: "fa-solid fa-signature" } as const;

/** Bifele flag-urilor unei presetări (formularul presetărilor). */
function FlagBoxes({ flags, label }: { flags: string; label: (f: string) => string }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
      {[...GCS_ADMIN_FLAGS].map((f) => (
        <label key={f} className="gcs-checkRow" title={label(f)} style={{ fontSize: 13 }}>
          <input type="checkbox" name="flag" value={f} defaultChecked={flags.includes(f)} />
          <code>{f}</code>
        </label>
      ))}
    </div>
  );
}

/**
 * ACP → Gaming → Admini servere (specul 2026-10-08-servere-bridge §7.4): lista (filtru pe server, căutare), adăugarea /
 * editarea, ștergerea și presetările (listă editabilă). Fiecare schimbare intră în jurnal și ajunge la servere (ETag nou).
 */
export default async function AcpServerAdminsPage({ searchParams }: Props) {
  const { actor } = await requireAcpSection(SERVER_ADMINS_ACP_SECTION);
  const sp = await searchParams;
  const serverId = /^\d{1,9}$/.test(sp.server ?? "") ? Number(sp.server) : null;
  const q = (sp.q ?? "").slice(0, 40);
  const { bridge, db, acp, settings } = services();
  const [t, format, all, presets, servers, canEdit, canDelete, presence, inactiveDays] = await Promise.all([
    getTranslations("acp.serverAdmins"),
    getFormatter(),
    bridge.admins.list(actor, { serverId, q }),
    bridge.admins.presets(),
    db.gameServer.findMany({ where: { game: { in: ["cs16", "cs2"] } }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
    acp.can(actor, SERVER_ADMINS_ACP_SECTION, "edit"),
    acp.can(actor, SERVER_ADMINS_ACP_SECTION, "delete"),
    // Prezența (specul 2026-10-08-servere-pagini §6): ultima apariție și inactivitatea, după `servers.admin_inactive_days`.
    bridge.presence.list(actor).catch(() => [] as GcsAdminPresence[]),
    settings.get<number>(BRIDGE_SETTING.adminInactiveDays),
  ]);
  const seen = new Map(presence.map((p) => [p.id, p]));
  const inactiveOnly = sp.inactive === "1";
  const inactive = all.filter((a) => !a.expired && seen.get(a.id)?.inactive);
  const rows = inactiveOnly ? inactive : all;
  const flagLabel = (f: string) => t(`flags.${f}`);
  /** Starea prezenței unui admin: online acum, ultima apariție, inactiv de N zile sau nevăzut niciodată. */
  const presenceBadge = (id: number) => {
    const p = seen.get(id);
    if (!p) return null;
    if (p.online) return <span className="gcs-badge gcs-badge--ok">{t("presence.online", { server: p.online.serverName })}</span>;
    if (!p.lastSeenAt) return <span className="gcs-badge gcs-badge--warn">{t("presence.never")}</span>;
    const days = Math.floor((Date.now() - Date.parse(p.lastSeenAt)) / 86_400_000);
    return p.inactive ? (
      <span className="gcs-badge gcs-badge--warn" data-testid="gcs-admin-inactive">
        {t("presence.inactive", { days })}
      </span>
    ) : (
      <span className="gcs-badge">{t("presence.seen", { time: format.relativeTime(new Date(p.lastSeenAt)) })}</span>
    );
  };

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-user-shield"
        description={t("lead")}
        actions={
          canEdit ? (
            <GcsButton variant="primary" asChild icon={<GcsIcon name="fa-solid fa-plus" />}>
              <Link href="/admin/gaming/server-admins/new" data-testid="gcs-server-admin-add">
                {t("add")}
              </Link>
            </GcsButton>
          ) : undefined
        }
      >
        {t("title")}
      </GcsAcpTitle>

      <form method="get" action="/admin/gaming/server-admins" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="gcs-field" style={{ width: 240 }}>
          {t("filterServer")}
          <select className="gcs-input" name="server" defaultValue={serverId ?? ""}>
            <option value="">{t("allAdmins")}</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="gcs-field" style={{ width: 240 }}>
          {t("search")}
          <input className="gcs-input" type="search" name="q" defaultValue={q} maxLength={40} />
        </label>
        <label className="gcs-checkRow" style={{ minHeight: 40 }}>
          <input type="checkbox" name="inactive" value="1" defaultChecked={inactiveOnly} />
          {t("presence.onlyInactive")}
        </label>
        <button type="submit" className="gcs-btn gcs-btn--ghost">
          {t("searchSubmit")}
        </button>
      </form>

      {inactive.length > 0 && (
        <p className="gcs-notice gcs-notice--warn" role="status" data-testid="gcs-admins-inactive-warning">
          <GcsIcon name="fa-solid fa-triangle-exclamation" />{" "}
          {t("presence.warning", { count: inactive.length, days: inactiveDays })}{" "}
          {!inactiveOnly && <Link href={`/admin/gaming/server-admins?inactive=1${serverId ? `&server=${serverId}` : ""}`}>{t("presence.showInactive")}</Link>}
          {" · "}
          <Link href="/admin/settings/servers_bridge">{t("presence.setting")}</Link>
        </p>
      )}

      <GcsCard as="section" aria-label={t("title")} style={{ overflow: "hidden" }}>
        {rows.length === 0 ? (
          <p className="gcs-acpList__empty">
            <GcsIcon name="fa-solid fa-user-shield" />
            {t("empty")}
          </p>
        ) : (
          <ul className="gcs-acpList" data-testid="gcs-server-admins">
            {rows.map((a) => (
              <li key={a.id} className="gcs-acpList__row" style={{ flexWrap: "wrap" }} data-testid="gcs-server-admin" data-admin={a.id}>
                <span className="gcs-acpList__main">
                  <span className="gcs-acpList__icon">
                    <GcsIcon name={SUBJECT_ICON[a.subject]} />
                  </span>
                  <span className="gcs-acpList__text">
                    <Link href={`/admin/gaming/server-admins/${a.id}`} style={{ fontWeight: 700 }}>
                      {a.label || "—"}
                    </Link>
                    <span className="gcs-acpList__sub">
                      {t(`subjects.${a.subject}`)} · {a.server?.name ?? t("allServers")} · {a.preset?.name ?? t("customFlagsShort")} · <code>{a.flags}</code> · {t("immunityShort", { value: a.immunity })}
                      {a.expiresAt && ` · ${a.expired ? t("expired") : t("expires", { date: format.dateTime(new Date(a.expiresAt), { dateStyle: "medium", timeStyle: "short" }) })}`}
                    </span>
                    <span style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                      {!a.expired && presenceBadge(a.id)}
                      {a.warnings.map((w) => (
                        <span key={w} className="gcs-badge gcs-badge--warn">
                          {t(`warnings.${w}`)}
                        </span>
                      ))}
                    </span>
                  </span>
                </span>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {canEdit && (
                    <Link className="gcs-btn gcs-btn--ghost gcs-btn--sm" href={`/admin/gaming/server-admins/${a.id}`}>
                      {t("edit")}
                    </Link>
                  )}
                  {canDelete && <GcsActionForm action={deleteServerAdmin.bind(null, a.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("deleteConfirm", { name: a.label })} />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </GcsCard>

      <GcsCard as="section" aria-labelledby="gcs-admin-presets" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 id="gcs-admin-presets" className="gcs-acpWidget__title">
          <GcsAcpTitleIcon name="fa-solid fa-layer-group" />
          {t("presets.title")}
        </h2>
        <p className="gcs-muted" style={{ margin: 0, fontSize: 14 }}>
          {t("presets.lead")}
        </p>
        <ul className="gcs-acpList" data-testid="gcs-admin-presets">
          {presets.map((p) => (
            <li key={p.id} className="gcs-acpList__row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
              {canEdit ? (
                <GcsActionForm action={saveAdminPreset.bind(null, p.id)} submitLabel={t("presets.save")} submitKind="save" variant="ghost" style={{ gap: 8 }}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <label className="gcs-field" style={{ width: 200 }}>
                      {t("presets.name")}
                      <input className="gcs-input" name="name" defaultValue={p.name} maxLength={40} required />
                    </label>
                    <label className="gcs-field" style={{ width: 120 }}>
                      {t("fields.immunity")}
                      <input className="gcs-input" type="number" name="immunity" defaultValue={p.immunity} min={0} max={100} required />
                    </label>
                    <span className="gcs-muted" style={{ fontSize: 13 }}>
                      {t("presets.used", { count: p.admins })}
                    </span>
                  </div>
                  <FlagBoxes flags={p.flags} label={flagLabel} />
                </GcsActionForm>
              ) : (
                <span>
                  <strong>{p.name}</strong> · <code>{p.flags}</code> · {t("immunityShort", { value: p.immunity })}
                </span>
              )}
              {canDelete && <GcsActionForm action={deleteAdminPreset.bind(null, p.id)} submitLabel={t("presets.delete")} submitKind="delete" variant="ghost" compact confirm={t("presets.deleteConfirm", { name: p.name })} />}
            </li>
          ))}
        </ul>
        {canEdit && (
          <GcsActionForm action={saveAdminPreset.bind(null, null)} submitLabel={t("presets.add")} submitKind="create">
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label className="gcs-field" style={{ width: 200 }}>
                {t("presets.name")}
                <input className="gcs-input" name="name" maxLength={40} required />
              </label>
              <label className="gcs-field" style={{ width: 120 }}>
                {t("fields.immunity")}
                <input className="gcs-input" type="number" name="immunity" defaultValue={0} min={0} max={100} required />
              </label>
            </div>
            <FlagBoxes flags="" label={flagLabel} />
          </GcsActionForm>
        )}
      </GcsCard>

      <GcsCard as="section" aria-labelledby="gcs-admin-flags" style={{ padding: 16 }}>
        <h2 id="gcs-admin-flags" className="gcs-acpWidget__title" style={{ marginBottom: 8 }}>
          <GcsAcpTitleIcon name="fa-solid fa-flag" />
          {t("flagsLegend")}
        </h2>
        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "4px 16px", fontSize: 14 }}>
          {[...GCS_ADMIN_FLAGS].map((f) => (
            <div key={f} style={{ display: "flex", gap: 8 }}>
              <dt>
                <code>{f}</code>
              </dt>
              <dd style={{ margin: 0 }}>{flagLabel(f)}</dd>
            </div>
          ))}
        </dl>
      </GcsCard>
    </>
  );
}
