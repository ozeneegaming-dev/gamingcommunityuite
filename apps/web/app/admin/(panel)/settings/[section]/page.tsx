import { settingsAcpSection } from "@gcs/core";
import { GcsButton, GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAcpPanel, requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsSettingsForm, type GcsSettingsField } from "../../_components/GcsSettingsForm";
import { saveSettings } from "./actions";
import { TestEmailButton } from "./TestEmailButton";

type Props = { params: Promise<{ section: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { section } = await params;
  const t = await getTranslations("acp.settings.titles");
  return { title: t.has(section) ? t(section) : section };
}

/**
 * O secțiune de setări din ACP (spec §12.1, Sistem → Setări), generată din setările declarate de module.
 * Secțiunile din meniu care nu au încă setări (Termeni, Postare…) arată „vine într-o etapă următoare”.
 */
export default async function AcpSettingsPage({ params }: Props) {
  const { section } = await params;
  const { registry, settings, db } = services();
  const defs = registry.settingDefs().filter((d) => d.section === section);

  if (defs.length === 0) {
    const panel = await requireAcpPanel();
    const item = panel.menu.flatMap((s) => s.items).find((i) => i.href === `/admin/settings/${section}`);
    if (!item) notFound();
    const t = await getTranslations();
    return (
      <GcsCard as="section" style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
        <h1 className="gcs-display" style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>
          {t.has(item.labelKey) ? t(item.labelKey) : item.key}
        </h1>
        <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 15 }}>{t("acp.comingSoon.body")}</p>
        <GcsButton variant="ghost" asChild>
          <Link href="/admin">{t("acp.comingSoon.back")}</Link>
        </GcsButton>
      </GcsCard>
    );
  }

  const panel = await requireAcpSection(settingsAcpSection(section));
  const t = await getTranslations("acp.settings");
  const tAll = await getTranslations();
  const label = (key: string) => (tAll.has(key) ? tAll(key) : key);

  const fields: GcsSettingsField[] = await Promise.all(
    defs.map(async (def) => {
      const value = await settings.get(def.key);
      const f: GcsSettingsField = { key: def.key, label: label(def.labelKey), type: def.type, value: def.type === "secret" ? "" : value };
      if (def.type === "secret") f.secretSet = typeof value === "string" && value !== "";
      if (def.options) f.options = def.options.map((o) => ({ value: o, label: label(`settings.choices.${o}`) }));
      return f;
    }),
  );
  const me = await db.user.findUnique({ where: { id: panel.user.id }, select: { email: true } });

  return (
    <>
      <h1 className="gcs-display" style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>
        {t.has(`titles.${section}`) ? t(`titles.${section}`) : section}
      </h1>
      <GcsCard style={{ padding: 20, maxWidth: 720 }}>
        <GcsSettingsForm
          fields={fields}
          action={saveSettings.bind(null, section)}
          labels={{ save: t("save"), saved: tAll("acp.saved"), secretSet: t("secretSet"), secretEmpty: t("secretEmpty"), on: t("on") }}
        />
      </GcsCard>
      {section === "email" && (
        <GcsCard as="section" aria-label={t("testEmail.title")} style={{ padding: 20, maxWidth: 720, display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 className="gcs-acpWidget__title">{t("testEmail.title")}</h2>
          <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14 }}>{t("testEmail.body", { email: me?.email ?? "" })}</p>
          <TestEmailButton labels={{ submit: t("testEmail.submit"), sent: t.raw("testEmail.sent"), failed: t.raw("testEmail.failed") }} />
        </GcsCard>
      )}
    </>
  );
}
