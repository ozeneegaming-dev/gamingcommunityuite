import { HOOKS_ACP_SECTION, PLUGIN_EVENTS, PLUGIN_FILTER_POINTS, PLUGIN_HOOK_POINTS, pluginHooks, type GcsPluginHookKind, type GcsPluginRow } from "@gcs/core";
import { pluginIcon } from "@gcs/modules";
import { GcsBadge, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../_components/GcsAcpTitle";
import { savePluginHook } from "../applications/plugin-actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.plugins.hooks"))("title") };
}

type Use = { plugin: GcsPluginRow; kind: GcsPluginHookKind; hook: string; priority: number; enabled: boolean; custom: boolean };

const SECTION_ICONS: Record<string, string> = {
  event: "fa-solid fa-bolt",
  filter: "fa-solid fa-filter",
  hook: "fa-solid fa-puzzle-piece",
  widget: "fa-solid fa-table-cells-large",
  page: "fa-solid fa-file-lines",
  acp: "fa-solid fa-screwdriver-wrench",
  api: "fa-solid fa-code",
  job: "fa-solid fa-clock-rotate-left",
  menu: "fa-solid fa-bars",
};

/**
 * ACP → Sistem → Hook-uri (etapa 6 §2.3): punctele de extensie și evenimentele, cine le folosește, ordinea (prioritatea,
 * mai mic = mai devreme) și comutatorul fiecărui hook al fiecărui plugin. Se aplică imediat, în toate procesele.
 */
export default async function AcpHooksPage() {
  const panel = await requireAcpSection(HOOKS_ACP_SECTION);
  const { pluginAdmin, acp } = services();
  const [t, tp, rows, settings, canEdit] = await Promise.all([
    getTranslations("acp.plugins.hooks"),
    getTranslations("acp.plugins"),
    pluginAdmin.list(),
    pluginAdmin.hookSettings(),
    acp.can(panel.actor, HOOKS_ACP_SECTION, "edit"),
  ]);
  const custom = new Map(settings.map((s) => [`${s.pluginKey}|${s.hook}`, s]));
  const uses: Use[] = rows
    .filter((p) => p.status === "installed")
    .flatMap((p) =>
      pluginHooks(p.manifest).map((h) => {
        const s = custom.get(`${p.key}|${h.hook}`);
        return { plugin: p, kind: h.kind, hook: h.hook, priority: s?.priority ?? h.priority, enabled: s?.enabled ?? true, custom: Boolean(s) };
      }),
    )
    .sort((a, b) => a.priority - b.priority || a.plugin.key.localeCompare(b.plugin.key));
  const usersOf = (kind: GcsPluginHookKind, hook: string) => uses.filter((u) => u.kind === kind && u.hook === hook);
  const catalogKey = (name: string) => `catalog.${name.replace(/\./g, "_")}`;

  const UseRow = ({ use }: { use: Use }) => (
    <li className="gcs-hookUse" data-testid={`gcs-hook-${use.plugin.key}-${use.hook}`}>
      <span className="gcs-hookUse__plugin">
        <GcsIcon name={pluginIcon(use.plugin.manifest.icon)} />
        <Link href={`/admin/system/applications/plugins/${use.plugin.key}`}>{use.plugin.name}</Link>
        {!use.plugin.enabled && <GcsBadge tone="neutral">{tp("status.disabled")}</GcsBadge>}
        {use.kind !== "event" && use.kind !== "filter" && use.kind !== "hook" && <code>{use.hook}</code>}
      </span>
      <GcsActionForm action={savePluginHook.bind(null, use.plugin.key, use.hook)} submitLabel={t("save")} submitKind="save" variant="ghost" compact>
        <fieldset disabled={!canEdit} className="gcs-hookUse__controls">
          <label className="gcs-hookUse__priority">
            <span>{t("priority")}</span>
            <input className="gcs-input" type="number" name="priority" min={0} max={100} defaultValue={use.priority} aria-label={t("priorityOf", { name: use.plugin.name })} />
          </label>
          <label className="gcs-hookUse__switch">
            <input type="checkbox" role="switch" name="enabled" defaultChecked={use.enabled} aria-label={t("enabledOf", { name: use.plugin.name })} />
            <span>{t("enabled")}</span>
          </label>
        </fieldset>
      </GcsActionForm>
    </li>
  );

  const Point = ({ kind, name }: { kind: GcsPluginHookKind; name: string }) => {
    const users = usersOf(kind, name);
    return (
      <li className="gcs-hookPoint" data-testid={`gcs-hook-point-${name}`}>
        <div className="gcs-hookPoint__head">
          <code className="gcs-hookPoint__name">{name}</code>
          <span className="gcs-muted">{t.has(catalogKey(name)) ? t(catalogKey(name)) : ""}</span>
          <GcsBadge tone={users.length > 0 ? "accent" : "neutral"}>{t("users", { count: users.length })}</GcsBadge>
        </div>
        {users.length > 0 && (
          <ul className="gcs-hookPoint__uses">
            {users.map((u) => (
              <UseRow key={`${u.plugin.key}|${u.hook}`} use={u} />
            ))}
          </ul>
        )}
      </li>
    );
  };

  const catalog: { kind: GcsPluginHookKind; names: readonly string[] }[] = [
    { kind: "event", names: PLUGIN_EVENTS },
    { kind: "filter", names: PLUGIN_FILTER_POINTS },
    { kind: "hook", names: PLUGIN_HOOK_POINTS },
  ];
  const ownKinds: GcsPluginHookKind[] = ["widget", "page", "acp", "api", "job", "menu"];

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-code-branch" description={t("description")}>
        {t("title")}
      </GcsAcpTitle>
      {catalog.map(({ kind, names }) => (
        <GcsCard key={kind} as="section" aria-labelledby={`gcs-hooks-${kind}`} data-testid={`gcs-hooks-${kind}`}>
          <div className="gcs-acpWidget__header">
            <h2 id={`gcs-hooks-${kind}`} className="gcs-acpWidget__title">
              <GcsAcpTitleIcon name={SECTION_ICONS[kind]} />
              {t(`sections.${kind}`)}
            </h2>
          </div>
          <p className="gcs-muted" style={{ margin: 0, padding: "12px 16px 0" }}>
            {t(`sectionHints.${kind}`)}
          </p>
          <ul className="gcs-hookPoints">
            {names.map((name) => (
              <Point key={name} kind={kind} name={name} />
            ))}
          </ul>
        </GcsCard>
      ))}
      <GcsCard as="section" aria-labelledby="gcs-hooks-own" data-testid="gcs-hooks-own">
        <div className="gcs-acpWidget__header">
          <h2 id="gcs-hooks-own" className="gcs-acpWidget__title">
            <GcsAcpTitleIcon name="fa-solid fa-cubes" />
            {t("sections.own")}
          </h2>
        </div>
        <p className="gcs-muted" style={{ margin: 0, padding: "12px 16px 0" }}>
          {t("sectionHints.own")}
        </p>
        {uses.some((u) => ownKinds.includes(u.kind)) ? (
          <ul className="gcs-hookPoints">
            {ownKinds
              .filter((kind) => uses.some((u) => u.kind === kind))
              .map((kind) => (
                <li key={kind} className="gcs-hookPoint">
                  <div className="gcs-hookPoint__head">
                    <GcsIcon name={SECTION_ICONS[kind]!} />
                    <strong>{t(`sections.${kind}`)}</strong>
                  </div>
                  <ul className="gcs-hookPoint__uses">
                    {uses
                      .filter((u) => u.kind === kind)
                      .map((u) => (
                        <UseRow key={`${u.plugin.key}|${u.hook}`} use={u} />
                      ))}
                  </ul>
                </li>
              ))}
          </ul>
        ) : (
          <p className="gcs-acpList__empty" style={{ padding: 16 }}>
            {t("noPlugins")}
          </p>
        )}
      </GcsCard>
    </>
  );
}
