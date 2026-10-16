import "server-only";
import type { GcsActor, GcsMemberPanelSurface } from "@gcs/core";
import { clanHref } from "@gcs/modules/clans-text";
import { GcsBadge } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { GcsNamedHtml } from "./member-names";
import { pluginHost, safeModeActive } from "./plugins";
import { services } from "./services";

/**
 * Panourile de membru (Membri v2): cardurile și taburile aduse de module (`GcsModule.memberPanels`) și de pluginuri
 * (`memberPanels` din manifest + punctul `member.panel`), pe fișa ACP a membrului și pe profilul public. Un panou apare
 * doar cu aplicația lui pornită (pe profil: și accesibilă vizitatorului) și dispare când e oprită sau dezinstalată.
 */
export type GcsMemberPanel = {
  key: string;
  label: string;
  icon: string;
  kind: "card" | "tab";
  position: number;
  /** Modulul care îl aduce (`servers`, `clans`…) sau `plugin.<cheie>`. */
  owner: string;
  plugin: string | null;
};

export async function memberPanels(surface: GcsMemberPanelSurface, viewer: GcsActor): Promise<GcsMemberPanel[]> {
  const { registry, apps } = services();
  const [usable, tAll, locale] = await Promise.all([surface === "acp" ? apps.enabledFilter() : apps.accessFilter(viewer), getTranslations(), getLocale()]);
  const out: GcsMemberPanel[] = registry
    .memberPanels(surface)
    .filter((p) => {
      const app = registry.module(p.module)?.app;
      return !app || app.locked || usable(p.module);
    })
    .map((p) => ({ key: p.def.key, label: tAll(p.def.labelKey as never), icon: p.def.icon, kind: p.def.kind, position: p.def.position, owner: p.module, plugin: null }));
  if (!(await safeModeActive())) {
    const host = await pluginHost();
    for (const p of host.memberPanels(surface, locale)) {
      out.push({ key: `${p.plugin}.${p.key}`, label: p.label, icon: p.icon, kind: p.kind, position: p.position, owner: `plugin.${p.plugin}`, plugin: p.plugin });
    }
  }
  return out.sort((a, b) => a.position - b.position);
}

/** Conținutul unui panou (null = fără date): randat de site după cheie (modulele) sau HTML-ul sanitizat al pluginului. */
async function panelContent({ panel, userId, surface, viewer }: { panel: GcsMemberPanel; userId: string; surface: GcsMemberPanelSurface; viewer: GcsActor }): Promise<ReactNode | null> {
  const t = await getTranslations("acp.member.panels");
  const format = await getFormatter();
  const { memberPanels: data } = services();
  const empty = null;
  if (panel.plugin) {
    const host = await pluginHost();
    const html = await host.renderMemberPanel(panel.plugin, panel.key.slice(panel.plugin.length + 1), { userId, surface }, { actor: viewer, locale: await getLocale() });
    // HTML-ul sanitizat al pluginului, cu numele membrilor aduse la stilul comun.
    return html ? <GcsNamedHtml html={html} className="gcs-pluginHook gcs-memberPanel__plugin" /> : empty;
  }
  const date = (d: Date) => format.dateTime(d, { dateStyle: "medium" });
  switch (panel.key) {
    case "connections": {
      const rows = await data.connections(userId);
      if (rows.length === 0) return empty;
      return (
        <ul className="gcs-memberPanel__list">
          {rows.map((r) => (
            <li key={`${r.provider}:${r.accountId}`} data-provider={r.provider}>
              <GcsIcon name={r.provider === "steam" ? "fa-brands fa-steam" : r.provider === "discord" ? "fa-brands fa-discord" : r.provider === "google" ? "fa-brands fa-google" : "fa-solid fa-link"} />
              <strong>{t(`providers.${["steam", "discord", "google"].includes(r.provider) ? r.provider : "other"}`)}</strong>
              <code className="gcs-memberPanel__mono">{r.accountId}</code>
              <span className="gcs-memberPanel__muted">{t("linkedOn", { date: date(r.linkedAt) })}</span>
            </li>
          ))}
        </ul>
      );
    }
    case "game_identities": {
      const rows = await data.gameIdentities(userId);
      if (rows.length === 0) return empty;
      return (
        <ul className="gcs-memberPanel__list">
          {rows.map((r) => (
            <li key={r.id}>
              <GcsBadge tone="neutral">{r.kind}</GcsBadge>
              <strong>{r.name || r.value}</strong>
              <code className="gcs-memberPanel__mono">{r.value}</code>
              <span className="gcs-memberPanel__muted">{t("lastSeen", { date: date(r.lastSeenAt) })}</span>
            </li>
          ))}
        </ul>
      );
    }
    case "mix_elo": {
      const elo = await data.mixElo(userId);
      if (!elo) return empty;
      return (
        <dl className="gcs-memberPanel__stats" data-testid="gcs-member-panel-elo">
          <div>
            <dt>{t("elo.elo")}</dt>
            <dd>{elo.elo}</dd>
          </div>
          <div>
            <dt>{t("elo.peak")}</dt>
            <dd>{elo.peak}</dd>
          </div>
          <div>
            <dt>{t("elo.record")}</dt>
            <dd>
              {elo.wins}–{elo.losses}–{elo.draws}
            </dd>
          </div>
          <div>
            <dt>{t("elo.matches")}</dt>
            <dd>{elo.matches}</dd>
          </div>
        </dl>
      );
    }
    case "server_sanctions": {
      const rows = await data.serverSanctions(userId);
      if (rows.length === 0) return empty;
      return (
        <ul className="gcs-memberPanel__list">
          {rows.map((r) => (
            <li key={r.id}>
              <GcsBadge tone={r.unbannedAt || (r.expiresAt && r.expiresAt < new Date()) ? "neutral" : "accent"}>{r.type}</GcsBadge>
              <strong>{r.reason}</strong>
              <span className="gcs-memberPanel__muted">
                {r.serverName ?? t("allServers")} · {date(r.createdAt)} · {r.expiresAt ? t("until", { date: date(r.expiresAt) }) : t("permanent")} · {r.adminName}
              </span>
            </li>
          ))}
        </ul>
      );
    }
    case "clan_membership": {
      const rows = await data.clanMembership(userId);
      if (rows.length === 0) return empty;
      return (
        <ul className="gcs-memberPanel__list">
          {rows.map((r) => (
            <li key={r.id}>
              <GcsBadge tone="accent">[{r.tag}]</GcsBadge>
              <Link href={clanHref(r)}>{r.name}</Link>
              <span className="gcs-memberPanel__muted">
                {t(`clanRoles.${r.role}` as never)} · {t("joinedOn", { date: date(r.joinedAt) })}
              </span>
            </li>
          ))}
        </ul>
      );
    }
    default:
      return empty;
  }
}

/** Conținutul unui panou; fără date: textul „Nimic de arătat”. */
export async function GcsMemberPanelBody(props: { panel: GcsMemberPanel; userId: string; surface: GcsMemberPanelSurface; viewer: GcsActor }) {
  const content = await panelContent(props);
  if (content !== null) return content;
  const t = await getTranslations("acp.member.panels");
  return <p className="gcs-memberPanel__empty">{t("empty")}</p>;
}

/** Cardul unui panou pe profilul public: nu apare deloc dacă membrul nu are date în aplicație. */
export async function GcsProfilePanelCard(props: { panel: GcsMemberPanel; userId: string; viewer: GcsActor }) {
  const content = await panelContent({ ...props, surface: "profile" });
  if (content === null) return null;
  return (
    <section className="gcs-card gcs-titledBox gcs-memberPanel" data-testid={`gcs-profile-panel-${props.panel.key}`}>
      <h2 className="gcs-display gcs-titleBand gcs-cardTitle">
        <GcsIcon name={props.panel.icon} className="gcs-hIcon" />
        {props.panel.label}
      </h2>
      {content}
    </section>
  );
}
