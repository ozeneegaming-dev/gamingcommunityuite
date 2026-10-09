import { GROUP_MENTION_LIMITS, GROUP_MENTION_NEVER, GROUP_MENTION_STAFF, mentionSettingsOf, type GcsNameStyle } from "@gcs/core";
import { GcsCard, GcsIconPicker } from "@gcs/ui";
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
import { GcsActionForm } from "../../_components/GcsActionForm";
import { deleteGroup, updateGroupDetails, updateGroupLook, updateGroupMentions, updateGroupSettings, updateGroupStyle } from "../actions";
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
                <GcsIconPicker name="icon" value={group.icon} searchUrl="/api/icons/search" labels={{ search: t("look.iconSearch"), none: t("look.iconNone"), noResults: t("look.iconNoResults") }} />
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
            {settings.map(({ def, kind, value }) => (
              <div key={def.key}>
                <input type="hidden" name={`kind:${def.key}`} value={kind} />
                {kind === "text" ? (
                  <label className="gcs-field">
                    {permissionLabel(def, tAll, registry)}
                    <input
                      className="gcs-input"
                      type="text"
                      maxLength={40}
                      name={`setting:${def.key}`}
                      defaultValue={typeof value === "string" ? value : ""}
                      style={{ maxWidth: 280 }}
                    />
                  </label>
                ) : kind === "number" ? (
                  <label className="gcs-field">
                    {permissionLabel(def, tAll, registry)}
                    <input
                      className="gcs-input"
                      type="number"
                      min={-1}
                      step={1}
                      name={`setting:${def.key}`}
                      defaultValue={typeof value === "number" ? value : 0}
                      style={{ maxWidth: 180 }}
                    />
                  </label>
                ) : (
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, minHeight: 36 }}>
                    <input type="checkbox" name={`setting:${def.key}`} defaultChecked={value === true} style={checkbox} />
                    {permissionLabel(def, tAll, registry)}
                  </label>
                )}
              </div>
            ))}
          </GcsActionForm>
        </Section>
      </div>
    </>
  );
}
