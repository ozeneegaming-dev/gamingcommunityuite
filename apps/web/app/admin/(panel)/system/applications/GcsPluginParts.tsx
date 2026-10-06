import { CAPABILITY_ICONS, CAPABILITY_RISK, PLUGIN_CAPABILITIES, type GcsPluginCheck, type GcsPluginManifest } from "@gcs/core";
import type { GcsPluginTexts } from "@gcs/modules";
import { GcsBadge } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import { getLocale, getTranslations } from "next-intl/server";

const CHECK_ICONS = { ok: "fa-solid fa-circle-check", warn: "fa-solid fa-triangle-exclamation", error: "fa-solid fa-circle-xmark" } as const;
const RISK_TONES = { low: "ok", medium: "warn", high: "accent" } as const;

/** Raportul verificărilor pachetului (ecranul de confirmare): iconița nivelului și mesajul tradus. */
export async function GcsPluginChecks({ checks }: { checks: GcsPluginCheck[] }) {
  const t = await getTranslations("acp.plugins.checks");
  return (
    <ul className="gcs-pluginChecks" data-testid="gcs-plugin-checks">
      {checks.map((c, i) => (
        <li key={i} className={`gcs-pluginChecks__item gcs-pluginChecks__item--${c.level}`} data-level={c.level} data-code={c.code}>
          <GcsIcon name={CHECK_ICONS[c.level]} />
          <span>{t.has(c.code) ? t(c.code, { path: "", issue: "", detail: "", key: "", keyId: "", ...c.params }) : `${c.code} ${JSON.stringify(c.params ?? {})}`}</span>
        </li>
      ))}
    </ul>
  );
}

/** Capabilitățile cerute, explicate pe înțeles, cu nivelul de risc; cele noi (la actualizare) sunt marcate. */
export async function GcsPluginCapabilities({ capabilities, fresh = [] }: { capabilities: readonly string[]; fresh?: readonly string[] }) {
  const t = await getTranslations("acp.plugins");
  const list = PLUGIN_CAPABILITIES.filter((c) => capabilities.includes(c));
  if (list.length === 0) return <p className="gcs-muted">{t("capabilities.none")}</p>;
  return (
    <ul className="gcs-pluginCaps" data-testid="gcs-plugin-capabilities">
      {list.map((c) => (
        <li key={c} className="gcs-pluginCaps__item" data-capability={c}>
          <span className="gcs-pluginCaps__icon" aria-hidden="true">
            <GcsIcon name={CAPABILITY_ICONS[c]} />
          </span>
          <span className="gcs-pluginCaps__text">
            <strong>
              {t(`capabilities.${c}.title`)}
              <GcsBadge tone={RISK_TONES[CAPABILITY_RISK[c]]}>{t(`risk.${CAPABILITY_RISK[c]}`)}</GcsBadge>
              {fresh.includes(c) && <GcsBadge tone="info">{t("capabilities.new")}</GcsBadge>}
            </strong>
            <small>{t(`capabilities.${c}.body`)}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Ce declară pluginul în manifest: permisiuni, widget-uri, pagini, rute, evenimente, filtre, puncte de extensie, joburi, meniuri. */
export async function GcsPluginDeclarations({ manifest, texts }: { manifest: GcsPluginManifest; texts: GcsPluginTexts }) {
  const [t, locale] = await Promise.all([getTranslations("acp.plugins.declared"), getLocale()]);
  const text = (label: string) => texts.text(label, locale);
  const rows: { key: string; icon: string; items: string[] }[] = [
    { key: "permissions", icon: "fa-solid fa-user-shield", items: manifest.permissions.map((p) => `${text(p.label)} (${p.scope === "group" ? t("scopeGroup") : t("scopeContainer", { type: p.containerType ?? "" })})`) },
    { key: "widgets", icon: "fa-solid fa-table-cells-large", items: manifest.widgets.map((w) => text(w.label)) },
    { key: "pages", icon: "fa-solid fa-file-lines", items: manifest.routes.pages.map((r) => `/p/${manifest.key}${r.path === "/" ? "" : r.path}`) },
    { key: "acp", icon: "fa-solid fa-screwdriver-wrench", items: manifest.routes.acp.map((r) => `/admin/plugins/${manifest.key}${r.path === "/" ? "" : r.path}`) },
    { key: "api", icon: "fa-solid fa-code", items: manifest.routes.api.map((r) => `${r.methods.join("/")} /api/plugins/${manifest.key}${r.path === "/" ? "" : r.path}`) },
    { key: "events", icon: "fa-solid fa-bolt", items: [...manifest.events] },
    { key: "filters", icon: "fa-solid fa-filter", items: manifest.filters.map((f) => f.point) },
    { key: "hooks", icon: "fa-solid fa-puzzle-piece", items: manifest.hooks.map((h) => h.point) },
    { key: "jobs", icon: "fa-solid fa-clock-rotate-left", items: manifest.jobs.map((j) => (j.everyMinutes ? t("jobEvery", { name: j.label ? text(j.label) : j.key, minutes: j.everyMinutes }) : j.label ? text(j.label) : j.key)) },
    { key: "menus", icon: "fa-solid fa-bars", items: [...manifest.menus.site, ...manifest.menus.user].map((m) => `${text(m.label)} → ${m.href}`) },
  ].filter((r) => r.items.length > 0);
  if (rows.length === 0) return null;
  return (
    <dl className="gcs-pluginDecl" data-testid="gcs-plugin-declarations">
      {rows.map((r) => (
        <div key={r.key} className="gcs-pluginDecl__row">
          <dt>
            <GcsIcon name={r.icon} /> {t(r.key)}
          </dt>
          <dd>
            {r.items.map((item) => (
              <code key={item}>{item}</code>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}
