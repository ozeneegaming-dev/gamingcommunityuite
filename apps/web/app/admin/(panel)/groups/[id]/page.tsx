import {
  GROUP_DESCRIPTION_MAX,
  GROUP_MENTION_LIMITS,
  GROUP_MENTION_NEVER,
  GROUP_MENTION_STAFF,
  GROUP_PRIORITY_RANGE,
  mentionSettingsOf,
  type GcsNameStyle,
} from "@gcs/core";
import { GcsCard } from "@gcs/ui";
import { isGcsIcon } from "@gcs/ui/icon-registry";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { requireAcpSection } from "@/lib/acp";
import { permissionLabel } from "@/lib/permission-label";
import { services } from "@/lib/services";
import { GcsIconInput } from "@/lib/ui-inputs";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { deleteGroup, updateGroupDetails, updateGroupDisplay, updateGroupLegend, updateGroupLook, updateGroupMentions, updateGroupOptIn, updateGroupSettings, updateGroupStyle } from "../actions";
import { NameStyleEditor } from "./NameStyleEditor";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../_components/GcsAcpTitle";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const group = await services().db.group.findUnique({ where: { id: Number((await params).id) || 0 }, select: { name: true } });
  return { title: group?.name };
}

function Section({ title, icon, children }: { title: string; icon: string; children: ReactNode }) {
  return (
    <GcsCard as="section" aria-label={title}>
      <div className="gcs-acpWidget__header">
        <h2 className="gcs-acpWidget__title">
          <GcsAcpTitleIcon name={icon} />
          {title}
        </h2>
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </GcsCard>
  );
}

const checkbox = { width: 18, height: 18, accentColor: "var(--gcs-accent)" } as const;

export default async function AcpGroupPage({ params }: Props) {
  await requireAcpSection("members.groups");
  const id = Number((await params).id);
  const { db, registry } = services();
  const group = Number.isInteger(id) ? await db.group.findUnique({ where: { id }, include: { settings: true } }) : null;
  if (!group) notFound();
  const stored = new Map(group.settings.map((s) => [s.key, s.value]));
  // Mențiuni v2: setările efective ale grupului (din bază, nu din cache) și grupurile care pot primi dreptul de a-l menționa.
  const allGroups = await db.group.findMany({
    where: { key: { notIn: [...GROUP_MENTION_NEVER] } },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, key: true, name: true },
  });
  const mention = mentionSettingsOf(
    group.key,
    stored,
    allGroups.filter((g) => GROUP_MENTION_STAFF.includes(g.key)).map((g) => g.id),
  );
  const neverMentionable = GROUP_MENTION_NEVER.includes(group.key);
  // Setările de afișare efective (prioritate, alegere, secundar, doar principal, pagina membrilor, descriere).
  const display = (await services().groupDisplay.info()).get(group.id)?.settings;
  // Grupuri Pro (premium): locul grupului în legenda pe categorii, doar cu aplicația pornită.
  const legendOn = await services()
    .apps.enabled("groups_pro")
    .catch(() => false);
  const [legendCategories, legendPlaces] = legendOn ? await Promise.all([services().groupsPro.categories(), services().groupsPro.places()]) : [[], new Map()];
  const legendPlace = legendPlaces.get(group.id) ?? { category: "", parentId: null };
  const tCategory = await getTranslations("groupsPro.category");
  const legendParents = legendOn
    ? (await db.group.findMany({ where: { id: { not: group.id } }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } })).filter(
        (g) => (legendPlaces.get(g.id)?.parentId ?? null) === null && (legendPlaces.get(g.id)?.category ?? "") !== "",
      )
    : [];
  const t = await getTranslations("acp.group");
  const tAll = await getTranslations();
  const saved = (await getTranslations("acp"))("saved");

  const defs = registry.permissionDefs().filter((d) => d.scope === "group");
  const settings = defs.map((def) => {
    const value = stored.has(def.key) ? stored.get(def.key) : (def.default[group.key] ?? def.fallback);
    // Tipul setării: după valorile implicite ale grupurilor (text, număr sau da/nu).
    const defaults = Object.values(def.default);
    const kind = defaults.some((v) => typeof v === "string") || typeof value === "string"
      ? "text"
      : defaults.some((v) => typeof v === "number") || typeof value === "number"
        ? "number"
        : "boolean";
    return { def, kind, value };
  });
  // Setările pe secțiuni, după aplicația care le declară (în ordinea modulelor); cele de bază, la „Generale”.
  const moduleOf = new Map<string, { key: string; label: string }>();
  for (const m of registry.all()) {
    if (!m.app) continue;
    const section = { key: m.key, label: tAll.has(m.app.labelKey as never) ? tAll(m.app.labelKey as never) : m.key };
    for (const p of m.permissions) moduleOf.set(p.key, section);
    moduleOf.set(`${m.key}.app_access`, section);
  }
  const settingSections = new Map<string, { label: string; items: typeof settings }>();
  for (const s of settings) {
    const section = moduleOf.get(s.def.key) ?? { key: "", label: t("settings.general") };
    const entry = settingSections.get(section.key) ?? { label: section.label, items: [] };
    entry.items.push(s);
    settingSections.set(section.key, entry);
  }

  return (
    <>
      <Link href="/admin/groups" className="gcs-acpBack">
        <GcsIcon name="fa-solid fa-arrow-left" />
        {t("back")}
      </Link>
      <GcsAcpTitle icon={isGcsIcon(group.icon) ? group.icon : "fa-solid fa-users"}>
        <span className={`gcs-name--${group.key}`}>{group.name}</span>
      </GcsAcpTitle>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Section title={t("details.title")} icon="fa-solid fa-circle-info">
            <GcsActionForm action={updateGroupDetails.bind(null, group.id)} submitLabel={t("details.save")} submitKind="save">
              <label className="gcs-field">
                {t("details.name")}
                <input className="gcs-input" name="name" defaultValue={group.name} required maxLength={64} />
              </label>
              <label className="gcs-field">
                {t("details.groupTitle")}
                <input className="gcs-input" name="title" defaultValue={group.title ?? ""} maxLength={64} />
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, minHeight: 36 }}>
                <input type="checkbox" name="isVip" defaultChecked={group.isVip} style={checkbox} />
                {t("details.isVip")}
              </label>
            </GcsActionForm>
          </Section>

          <Section title={t("look.title")} icon="fa-solid fa-image">
            <GcsActionForm action={updateGroupLook.bind(null, group.id)} submitLabel={t("look.save")} submitKind="save">
              <div className="gcs-field" role="group" aria-label={t("look.icon")}>
                <span>{t("look.icon")}</span>
                <GcsIconInput name="icon" value={group.icon} testId="gcs-group-icon" />
              </div>
              <label className="gcs-field">
                {t("look.banner")}
                <input className="gcs-input" name="banner" defaultValue={group.banner ?? ""} maxLength={80} placeholder="linear-gradient(135deg, #D62839, #8B0F1C)" />
                <span className="gcs-field__hint">{t("look.bannerHint")}</span>
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, minHeight: 36 }}>
                <input type="checkbox" name="inLegend" defaultChecked={group.inLegend} style={checkbox} />
                {t("look.inLegend")}
              </label>
            </GcsActionForm>
          </Section>

          {/* Membri v2: grupul public (opt-in): membrii intră / ies singuri din Setări → Grupuri. */}
          <Section title={t("optIn.title")} icon="fa-solid fa-people-group">
            <GcsActionForm action={updateGroupOptIn.bind(null, group.id)} submitLabel={t("optIn.save")} submitKind="save">
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, minHeight: 36 }}>
                <input type="checkbox" name="optIn" defaultChecked={group.optIn} style={checkbox} data-testid="gcs-group-optin" />
                {t("optIn.label")}
              </label>
              <span className="gcs-field__hint">{t("optIn.hint")}</span>
            </GcsActionForm>
          </Section>

          {display && (
            <Section title={t("display.title")} icon="fa-solid fa-id-badge">
              <GcsActionForm action={updateGroupDisplay.bind(null, group.id)} submitLabel={t("display.save")} submitKind="save">
                <label className="gcs-field">
                  {t("display.priority")}
                  <input
                    className="gcs-input"
                    type="number"
                    name="displayPriority"
                    min={GROUP_PRIORITY_RANGE.min}
                    max={GROUP_PRIORITY_RANGE.max}
                    step={1}
                    required
                    defaultValue={display.priority}
                    style={{ maxWidth: 180 }}
                    data-testid="gcs-group-display-priority"
                  />
                  <span className="gcs-field__hint">{t("display.priorityHint")}</span>
                </label>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, minHeight: 36 }}>
                  <input type="checkbox" name="displaySelectable" defaultChecked={display.selectable} style={checkbox} />
                  {t("display.selectable")}
                </label>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, minHeight: 36 }}>
                  <input type="checkbox" name="displaySecondary" defaultChecked={display.showSecondary} style={checkbox} />
                  {t("display.showSecondary")}
                </label>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, minHeight: 36 }}>
                  <input type="checkbox" name="displayPrimaryOnly" defaultChecked={display.primaryOnly} style={checkbox} />
                  {t("display.primaryOnly")}
                </label>
                {group.key !== "guest" && (
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, minHeight: 36 }}>
                    <input type="hidden" name="displayPublicField" value="1" />
                    <input type="checkbox" name="displayPublic" defaultChecked={display.public} style={checkbox} />
                    {t("display.public")}
                  </label>
                )}
                <label className="gcs-field">
                  {t("display.description")}
                  <input
                    className="gcs-input"
                    name="displayDescription"
                    defaultValue={display.description}
                    maxLength={GROUP_DESCRIPTION_MAX}
                    data-testid="gcs-group-display-description"
                  />
                  <span className="gcs-field__hint">{t("display.descriptionHint")}</span>
                </label>
              </GcsActionForm>
            </Section>
          )}

          {legendOn && (
            <Section title={t("legend.title")} icon="fa-solid fa-layer-group">
              <GcsActionForm action={updateGroupLegend.bind(null, group.id)} submitLabel={t("legend.save")} submitKind="save">
                <label className="gcs-field">
                  {t("legend.category")}
                  <select className="gcs-input" name="legendCategory" defaultValue={legendPlace.category} style={{ maxWidth: 280 }} data-testid="gcs-group-legend-category">
                    <option value="">{t("legend.hidden")}</option>
                    {legendCategories.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label || (tCategory.has(c.key as never) ? tCategory(c.key as never) : c.key)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="gcs-field">
                  {t("legend.parent")}
                  <select className="gcs-input" name="legendParent" defaultValue={legendPlace.parentId ?? ""} style={{ maxWidth: 280 }} data-testid="gcs-group-legend-parent">
                    <option value="">{t("legend.parentNone")}</option>
                    {legendParents.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                  <span className="gcs-field__hint">{t("legend.parentHint")}</span>
                </label>
              </GcsActionForm>
            </Section>
          )}

          <Section title={t("style.title")} icon="fa-solid fa-signature">
            <NameStyleEditor
              onSave={updateGroupStyle.bind(null, group.id)}
              name={group.name}
              initial={(group.nameStyle as GcsNameStyle | null) ?? {}}
              fallbackColor={group.color ?? "#ECEDF1"}
              labels={{
                color: t("style.color"),
                useGradient: t("style.useGradient"),
                gradientColor: [t("style.gradientColor", { n: 1 }), t("style.gradientColor", { n: 2 }), t("style.gradientColor", { n: 3 })],
                animated: t("style.animated"),
                glow: t("style.glow"),
                bold: t("style.bold"),
                italic: t("style.italic"),
                icon: t("style.icon"),
                preview: t("style.preview"),
                save: t("style.save"),
                saved,
              }}
            />
          </Section>

          <Section title={t("mentions.title")} icon="fa-solid fa-at">
            {neverMentionable ? (
              <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14 }} data-testid="gcs-group-mentions-never">
                {t("mentions.never")}
              </p>
            ) : (
              <GcsActionForm action={updateGroupMentions.bind(null, group.id)} submitLabel={t("mentions.save")} submitKind="save">
                <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 13 }}>{t("mentions.hint")}</p>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, minHeight: 36 }}>
                  <input type="checkbox" name="mentionEnabled" defaultChecked={mention.enabled} style={checkbox} />
                  {t("mentions.enabled")}
                </label>
                <fieldset className="gcs-appAccess__groups" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 150px), 1fr))" }}>
                  <legend style={{ fontSize: 14, marginBottom: 8, padding: 0 }}>{t("mentions.allowed")}</legend>
                  {allGroups.map((g) =>
                    g.key === "root_admin" ? (
                      <label key={g.id} className="gcs-appAccess__group gcs-appAccess__group--fixed" title={t("mentions.rootAlways")}>
                        <input type="checkbox" checked disabled readOnly />
                        <span>{g.name}</span>
                      </label>
                    ) : (
                      <label key={g.id} className="gcs-appAccess__group">
                        <input type="checkbox" name="mentionAllowed" value={g.id} defaultChecked={mention.allowedGroupIds.includes(g.id)} />
                        <span>{g.name}</span>
                      </label>
                    ),
                  )}
                </fieldset>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, minHeight: 36 }}>
                  <input type="checkbox" name="mentionNotify" defaultChecked={mention.notify} style={checkbox} />
                  {t("mentions.notify")}
                </label>
                <label className="gcs-field">
                  {t("mentions.limit")}
                  <input
                    className="gcs-input"
                    type="number"
                    name="mentionLimit"
                    min={GROUP_MENTION_LIMITS.notifyLimit.min}
                    max={GROUP_MENTION_LIMITS.notifyLimit.max}
                    step={1}
                    required
                    defaultValue={mention.notifyLimit}
                    style={{ maxWidth: 180 }}
                  />
                </label>
                <label className="gcs-field">
                  {t("mentions.cooldown")}
                  <input
                    className="gcs-input"
                    type="number"
                    name="mentionCooldown"
                    min={GROUP_MENTION_LIMITS.cooldownMinutes.min}
                    max={GROUP_MENTION_LIMITS.cooldownMinutes.max}
                    step={1}
                    required
                    defaultValue={mention.cooldownMinutes}
                    style={{ maxWidth: 180 }}
                  />
                  <span className="gcs-field__hint">{t("mentions.cooldownHint")}</span>
                </label>
              </GcsActionForm>
            )}
          </Section>

          <Section title={t("delete.title")} icon="fa-solid fa-trash">
            {group.isProtected ? (
              <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14 }}>{t("delete.protected")}</p>
            ) : (
              <GcsActionForm
                action={deleteGroup.bind(null, group.id)}
                submitLabel={t("delete.submit")} submitKind="delete"
                variant="ghost"
                redirectTo="/admin/groups"
                confirm={t("delete.body")}
              >
                <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14 }}>{t("delete.body")}</p>
              </GcsActionForm>
            )}
          </Section>
        </div>

        <Section title={t("settings.title")} icon="fa-solid fa-sliders">
          <GcsActionForm action={updateGroupSettings.bind(null, group.id)} submitLabel={t("settings.save")} submitKind="save">
            <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 13 }}>{t("settings.unlimited")}</p>
            {[...settingSections.entries()].map(([key, section]) => {
              const toggles = section.items.filter((s) => s.kind === "boolean");
              const fields = section.items.filter((s) => s.kind !== "boolean");
              return (
                <fieldset key={key || "general"} className="gcs-formSec" data-testid="gcs-group-settings-section">
                  <legend>{section.label}</legend>
                  {toggles.length > 0 && (
                    <div className="gcs-formGrid gcs-acpGroup__toggles">
                      {toggles.map(({ def, kind, value }) => (
                        <label key={def.key} className="gcs-toggleRow gcs-acpGroup__toggle">
                          <input type="hidden" name={`kind:${def.key}`} value={kind} />
                          <span>{permissionLabel(def, tAll, registry)}</span>
                          <input type="checkbox" className="gcs-switch" name={`setting:${def.key}`} defaultChecked={value === true} />
                        </label>
                      ))}
                    </div>
                  )}
                  {fields.length > 0 && (
                    <div className="gcs-formGrid gcs-acpGroup__fields">
                      {fields.map(({ def, kind, value }) => (
                        <label key={def.key} className="gcs-field">
                          <input type="hidden" name={`kind:${def.key}`} value={kind} />
                          {permissionLabel(def, tAll, registry)}
                          {kind === "text" ? (
                            <input className="gcs-input" type="text" maxLength={40} name={`setting:${def.key}`} defaultValue={typeof value === "string" ? value : ""} />
                          ) : (
                            <input className="gcs-input" type="number" min={-1} step={1} name={`setting:${def.key}`} defaultValue={typeof value === "number" ? value : 0} />
                          )}
                        </label>
                      ))}
                    </div>
                  )}
                </fieldset>
              );
            })}
          </GcsActionForm>
        </Section>
      </div>
    </>
  );
}
