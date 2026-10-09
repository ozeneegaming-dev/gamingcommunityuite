import { APPS_ACP_SECTION, appAccessKey, pluginRegistryKey, pluginSchema, trustedPluginKeys, type GcsAppInfo, type GcsModule, type GcsPluginRow } from "@gcs/core";
import { GcsPluginTexts, pluginIcon } from "@gcs/modules";
import { GcsButton, GcsCard } from "@gcs/ui";
import { resolveIcon } from "@gcs/ui/icon-registry";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { requireAcpSection } from "@/lib/acp";
import { permissionLabel } from "@/lib/permission-label";
import { services } from "@/lib/services";
import { GCS_APP_VERSION } from "@/lib/system-info";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../_components/GcsAcpTitle";
import type { GcsAcpIconDef } from "../../_components/types";
import { GcsAppList, type GcsAppAccess, type GcsAppGroup, type GcsAppRow } from "./GcsAppList";
import { GcsPluginCapabilities, GcsPluginDeclarations } from "./GcsPluginParts";
import { GcsPluginUpload } from "./GcsPluginUpload";
import { pluginAuthor } from "./plugin-ui";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.plugins"))("title") };
}

const VENDOR = "GamingCommunitySuite";

/** Iconița rezolvată pe server (la client ajung doar datele SVG). */
function iconDef(name: string | undefined): GcsAcpIconDef | null {
  const def = resolveIcon(name);
  return def ? { prefix: def.prefix, iconName: def.iconName, icon: def.icon } : null;
}

/** Un rând „fapt” din dialogul Detalii. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * ACP → Sistem → Aplicații și pluginuri (specul 2026-10-09-acp-navigatie-aplicatii §2): o listă compactă cu aplicațiile
 * (Nucleu și Forum blocate) și pluginurile, cu versiunea, autorul, certificarea, starea, pornirea (★), accesul pe grup,
 * comutatorul, secțiunile, meniul „⋯” și ordinea (tragere sau butoanele sus / jos). Dedesubt, încărcarea unui plugin.
 */
export default async function AcpApplicationsPage() {
  const panel = await requireAcpSection(APPS_ACP_SECTION);
  const { apps, pluginAdmin, acp, registry, db } = services();
  const [t, tp, tAll, locale, catalog, order, landing, pluginList, groupRows, canEdit, canDelete] = await Promise.all([
    getTranslations("acp.appsPage"),
    getTranslations("acp.plugins"),
    getTranslations(),
    getLocale(),
    apps.catalog(),
    apps.order(),
    apps.landingKey(),
    pluginAdmin.list(),
    db.group.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true, key: true } }),
    acp.can(panel.actor, APPS_ACP_SECTION, "edit"),
    acp.can(panel.actor, APPS_ACP_SECTION, "delete"),
  ]);
  const label = (key: string) => (tAll.has(key) ? tAll(key) : key);
  const trusted = trustedPluginKeys();
  // Banat nu apare în dialogul de acces: bannul anulează oricum tot.
  const groups: GcsAppGroup[] = groupRows.filter((g) => g.key !== "banned").map((g) => ({ id: g.id, name: g.name, root: g.key === "root_admin" }));

  /** Accesul unei permisiuni de grup (dialogul 🔒), dacă e editabilă de aici. */
  const access = async (permission: string | undefined, title: string): Promise<GcsAppAccess | null> => {
    if (!permission) return null;
    const def = registry.permissionDef(permission);
    if (!def || def.scope !== "group" || Object.values(def.default).some((v) => typeof v !== "boolean")) return null;
    return { permission, title, allowed: await apps.accessGroups(permission), label: permissionLabel(def, tAll, registry) };
  };

  /** Ce aduce o aplicație: paginile din ACP, widget-urile și permisiunile modulului. */
  const adds = (m: GcsModule | undefined, sitePages: string[]) => {
    const acpPages = (m?.acpMenu ?? []).flatMap((s) => s.items.filter((i) => !i.alias).map((i) => label(i.labelKey)));
    const widgets = m ? registry.widgetDefs().filter((w) => w.module === m.key).map((w) => label(w.def.labelKey)) : [];
    const permissions = m ? registry.permissionDefs().filter((p) => p.key.startsWith(`${m.key}.`) || m.permissions.some((own) => own.key === p.key)).map((p) => permissionLabel(p, tAll, registry)) : [];
    const lists: [string, string[]][] = [
      [t("details.sitePages"), sitePages],
      [t("details.acpPages"), acpPages],
      [t("details.widgets"), widgets],
      [t("details.permissions"), permissions],
    ];
    const rows = lists.map(([title, items]): [string, string[]] => [title, [...new Set(items)]]);
    return (
      <dl className="gcs-appDetails__adds">
        {rows.map(([title, items]) => (
          <div key={title}>
            <dt>{title}</dt>
            <dd>{items.length > 0 ? items.map((item) => <span key={item}>{item}</span>) : <span className="gcs-muted">{t("details.none")}</span>}</dd>
          </div>
        ))}
      </dl>
    );
  };

  const details: Record<string, ReactNode> = {};

  // ─── Aplicațiile ───
  const statusOf = (a: GcsAppInfo): GcsAppRow["status"] => (a.locked ? "locked" : a.enabled ? "active" : "stopped");
  const appRows: GcsAppRow[] = await Promise.all(
    catalog.map(async (a) => {
      const name = label(a.labelKey);
      const m = registry.module(a.key);
      const description = a.descriptionKey ? label(a.descriptionKey) : "";
      const sections = await Promise.all(
        a.sections.map(async (s) => ({
          key: s.key,
          label: label(s.labelKey),
          href: s.href,
          icon: iconDef(s.icon),
          access: await access(s.permission, t("access.sectionTitle", { name: label(s.labelKey) })),
        })),
      );
      details[a.key] = (
        <div className="gcs-appDetails">
          {description && <p className="gcs-appDetails__desc">{description}</p>}
          <dl className="gcs-appDetails__facts">
            <Fact label={t("details.version")}>v{GCS_APP_VERSION}</Fact>
            <Fact label={t("details.author")}>{VENDOR}</Fact>
            <Fact label={t("details.status")}>{t(`status.${statusOf(a)}`)}</Fact>
            {a.landing && <Fact label={t("details.landing")}>{a.landing.home ? "/" : a.landing.href}</Fact>}
          </dl>
          <h3 className="gcs-appDetails__title">{t("details.adds")}</h3>
          {adds(m, a.sections.map((s) => `${label(s.labelKey)} (${s.href})`))}
          {a.locked && (
            <p className="gcs-appDetails__note">
              <GcsIcon name="fa-solid fa-lock" /> {t("details.lockedNote")}
            </p>
          )}
        </div>
      );
      return {
        id: a.key,
        orderKey: a.key,
        kind: "app",
        name,
        description,
        icon: iconDef(a.icon),
        version: GCS_APP_VERSION,
        author: VENDOR,
        certificate: null,
        status: statusOf(a),
        autoDisabled: false,
        error: null,
        enabled: a.enabled,
        canToggle: canEdit && a.optional && !a.locked,
        landing: a.landing ? { possible: true } : null,
        access: a.access ? await access(a.access, t("access.title", { name })) : null,
        accessNote: null,
        sections,
        manageHref: null,
        exportHref: null,
        uninstall: null,
      } satisfies GcsAppRow;
    }),
  );

  // ─── Pluginurile (aceeași ordine salvată: cheile modulelor `plugin.<cheie>`) ───
  const rank = (p: GcsPluginRow) => {
    const at = order.indexOf(pluginRegistryKey(p.key));
    return at === -1 ? order.length : at;
  };
  const sortedPlugins = [...pluginList].sort((a, b) => rank(a) - rank(b));
  const pluginRows: GcsAppRow[] = await Promise.all(
    sortedPlugins.map(async (p) => {
      const installed = p.status === "installed";
      const moduleKey = pluginRegistryKey(p.key);
      const loaded = registry.module(moduleKey);
      const texts = new GcsPluginTexts(p.key, p.manifest, await pluginAdmin.langs(p.key));
      const text = (l: string) => texts.text(l, locale);
      const sitePages = p.manifest.routes.pages.filter((r) => !r.path.includes(":"));
      const sections = await Promise.all(
        sitePages.map(async (r) => {
          const pageLabel = r.title ? text(r.title) : p.name;
          return {
            key: r.path,
            label: pageLabel,
            href: `/p/${p.key}${r.path === "/" ? "" : r.path}`,
            icon: iconDef(pluginIcon(p.manifest.icon)),
            access: loaded && r.permission ? await access(`${moduleKey}.${r.permission}`, t("access.sectionTitle", { name: pageLabel })) : null,
          };
        }),
      );
      const status: GcsAppRow["status"] = !installed ? "removed" : p.enabled ? "active" : "stopped";
      details[p.key] = (
        <div className="gcs-appDetails">
          {p.manifest.description && <p className="gcs-appDetails__desc">{p.manifest.description}</p>}
          <dl className="gcs-appDetails__facts">
            <Fact label={t("details.version")}>v{p.version}</Fact>
            <Fact label={t("details.author")}>{pluginAuthor(p)}</Fact>
            <Fact label={t("details.key")}>
              <code>{p.key}</code>
            </Fact>
            <Fact label={t("details.certificate")}>{p.signed ? t("certified.title", { keyId: p.signatureKeyId ?? "" }) : t("uncertified.title")}</Fact>
            {p.capabilities.includes("db") && (
              <Fact label={t("details.database")}>
                <code>{pluginSchema(p.key)}</code>
              </Fact>
            )}
          </dl>
          <h3 className="gcs-appDetails__title">{t("details.adds")}</h3>
          <GcsPluginDeclarations manifest={p.manifest} texts={texts} />
          <h3 className="gcs-appDetails__title">{t("details.capabilities")}</h3>
          <GcsPluginCapabilities capabilities={p.capabilities} />
        </div>
      );
      const removes = [
        ...(p.capabilities.includes("db") ? [t("uninstall.removes.schema", { schema: pluginSchema(p.key) })] : []),
        t("uninstall.removes.settings"),
        ...(p.manifest.widgets.length > 0 ? [t("uninstall.removes.widgets")] : []),
        ...(p.capabilities.includes("media") ? [t("uninstall.removes.files")] : []),
        ...(p.manifest.routes.acp.length > 0 ? [t("uninstall.removes.acp")] : []),
      ];
      return {
        id: p.key,
        orderKey: moduleKey,
        kind: "plugin",
        name: p.name,
        description: p.manifest.description,
        icon: iconDef(pluginIcon(p.manifest.icon)),
        version: p.version,
        author: pluginAuthor(p),
        certificate: { signed: p.signed, keyId: p.signatureKeyId },
        status,
        autoDisabled: installed && !p.enabled && p.disabledReason === "auto",
        error: p.disabledReason === "auto" ? p.lastError : null,
        enabled: installed && p.enabled,
        canToggle: canEdit && installed,
        landing: null,
        access: loaded ? await access(appAccessKey(moduleKey), t("access.title", { name: p.name })) : null,
        accessNote: loaded ? null : t("access.pluginStopped"),
        sections,
        manageHref: `/admin/system/applications/plugins/${p.key}`,
        exportHref: installed && canEdit ? `/api/acp/plugins/${encodeURIComponent(p.key)}/package` : null,
        uninstall: canDelete ? { removes, key: p.key } : null,
      } satisfies GcsAppRow;
    }),
  );

  const landingName = appRows.find((a) => a.id === landing)?.name ?? label("apps.forums");
  const uploadLabels = { file: tp("upload.file"), hint: tp("upload.hint"), submit: tp("upload.submit"), uploading: tp("upload.uploading"), network: tp("upload.network") };

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-cubes"
        description={t("description")}
        actions={
          <>
            {/* Verificarea actualizărilor vine odată cu licențele (etapa 11): butonul rămâne dezactivat, cu explicația. */}
            <span className="gcs-appUpdates" tabIndex={0} aria-describedby="gcs-app-updates-hint" data-testid="gcs-apps-check-updates">
              <GcsButton variant="ghost" disabled icon={<GcsIcon name="fa-solid fa-rotate" />}>
                {t("checkUpdates")}
              </GcsButton>
              <span id="gcs-app-updates-hint" role="tooltip" className="gcs-appUpdates__tip">
                {t("checkUpdatesHint")}
              </span>
            </span>
            {canEdit && (
              <GcsButton variant="primary" asChild icon={<GcsIcon name="fa-solid fa-upload" />}>
                <a href="#upload">{tp("upload.title")}</a>
              </GcsButton>
            )}
          </>
        }
      >
        {tp("title")}
      </GcsAcpTitle>

      <GcsAppList apps={appRows} plugins={pluginRows} groups={groups} details={details} landing={landing} landingName={landingName} canEdit={canEdit} uploadLabels={uploadLabels} />

      {canEdit && (
        <GcsCard as="section" id="upload" aria-labelledby="gcs-plugin-upload-title">
          <div className="gcs-acpWidget__header">
            <h2 id="gcs-plugin-upload-title" className="gcs-acpWidget__title">
              <GcsAcpTitleIcon name="fa-solid fa-upload" />
              {tp("upload.title")}
            </h2>
          </div>
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <p className="gcs-muted" style={{ margin: 0 }}>
              {tp("upload.body")}
            </p>
            <GcsPluginUpload labels={uploadLabels} />
            <p className="gcs-muted gcs-pluginKeys" data-testid="gcs-plugin-trusted-keys">
              <GcsIcon name="fa-solid fa-key" />{" "}
              {trusted.keys.size > 0 ? tp("upload.trusted", { keys: [...trusted.keys.keys()].join(", ") }) : tp("upload.noTrusted")}
            </p>
          </div>
        </GcsCard>
      )}
    </>
  );
}
