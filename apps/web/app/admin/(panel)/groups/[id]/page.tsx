import type { GcsNameStyle } from "@gcs/core";
import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { deleteGroup, updateGroupDetails, updateGroupSettings } from "../actions";
import { NameStyleEditor } from "./NameStyleEditor";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const group = await services().db.group.findUnique({ where: { id: Number((await params).id) || 0 }, select: { name: true } });
  return { title: group?.name };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <GcsCard as="section" aria-label={title}>
      <div className="gcs-acpWidget__header">
        <h2 className="gcs-acpWidget__title">{title}</h2>
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
  const t = await getTranslations("acp.group");
  const tAll = await getTranslations();
  const saved = (await getTranslations("acp"))("saved");

  const stored = new Map(group.settings.map((s) => [s.key, s.value]));
  const defs = registry.permissionDefs().filter((d) => d.scope === "group");
  const settings = defs.map((def) => {
    const value = stored.has(def.key) ? stored.get(def.key) : def.default[group.key];
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
      <Link href="/admin/groups" style={{ fontSize: 13 }}>
        ← {t("back")}
      </Link>
      <h1 className="gcs-display" style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>
        <span className={`gcs-name--${group.key}`}>{group.name}</span>
      </h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Section title={t("details.title")}>
            <GcsActionForm action={updateGroupDetails.bind(null, group.id)} submitLabel={t("details.save")}>
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

          <Section title={t("style.title")}>
            <NameStyleEditor
              groupId={group.id}
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

          <Section title={t("delete.title")}>
            {group.isProtected ? (
              <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14 }}>{t("delete.protected")}</p>
            ) : (
              <GcsActionForm
                action={deleteGroup.bind(null, group.id)}
                submitLabel={t("delete.submit")}
                variant="ghost"
                redirectTo="/admin/groups"
                confirm={t("delete.body")}
              >
                <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14 }}>{t("delete.body")}</p>
              </GcsActionForm>
            )}
          </Section>
        </div>

        <Section title={t("settings.title")}>
          <GcsActionForm action={updateGroupSettings.bind(null, group.id)} submitLabel={t("settings.save")}>
            <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 13 }}>{t("settings.unlimited")}</p>
            {settings.map(({ def, kind, value }) => (
              <div key={def.key}>
                <input type="hidden" name={`kind:${def.key}`} value={kind} />
                {kind === "text" ? (
                  <label className="gcs-field">
                    {tAll.has(def.labelKey) ? tAll(def.labelKey) : def.key}
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
                    {tAll.has(def.labelKey) ? tAll(def.labelKey) : def.key}
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
                    {tAll.has(def.labelKey) ? tAll(def.labelKey) : def.key}
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
