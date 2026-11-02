import { MFA_REQUIRED_GROUPS_SETTING, loadMfaRequiredGroups, settingsAcpSection } from "@gcs/core";
import { GCS_LOCALE_KEYS, SECURITY_SECTION, SEO_SECTION, UPLOADS_SECTION } from "@gcs/modules";
import { GcsButton, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAcpPanel, requireAcpSection } from "@/lib/acp";
import { LOCALE_NAMES } from "@/lib/locales";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../_components/GcsAcpTitle";
import { GcsSettingsForm, type GcsSettingsField } from "../../_components/GcsSettingsForm";
import { saveActiveLocales, saveMfaGroups, saveSettings } from "./actions";
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
  // Opțiunile clanurilor au pagina lor (tab-uri, liste de grupuri și categorii), nu formularul generic.
  if (section === "clans") redirect("/admin/gaming/clans/settings");
  // Pornirea și ordinea aplicațiilor se schimbă din pagina Aplicații (nu au formular generic).
  if (section === "apps") redirect("/admin/system/applications");
  // Subsolul are pagina lui (coloane de linkuri, iconițe), sub Aspect.
  if (section === "footer") redirect("/admin/appearance/footer");
  // Perechea comutatorului lună / soare se alege în pagina temelor.
  if (section === "themes") redirect("/admin/appearance/themes");
  // Setările SEO au pagina lor, sub Promovare (robots.txt, sitemap, IndexNow, metadatele, linkurile).
  if (section === SEO_SECTION) redirect("/admin/system/seo");
  const { registry, settings, db } = services();
  const defs = registry.settingDefs().filter((d) => d.section === section);

  if (defs.length === 0) {
    const panel = await requireAcpPanel();
    const item = panel.menu.flatMap((s) => s.items).find((i) => i.href === `/admin/settings/${section}`);
    if (!item) notFound();
    const t = await getTranslations();
    return (
      <>
        <GcsAcpTitle icon={item.icon}>{t.has(item.labelKey) ? t(item.labelKey) : item.key}</GcsAcpTitle>
        <GcsCard as="section" style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
          <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 15 }}>{t("acp.comingSoon.body")}</p>
          <GcsButton variant="ghost" asChild icon={<GcsIcon name="fa-solid fa-arrow-left" />}>
            <Link href="/admin">{t("acp.comingSoon.back")}</Link>
          </GcsButton>
        </GcsCard>
      </>
    );
  }

  const panel = await requireAcpSection(settingsAcpSection(section));
  const t = await getTranslations("acp.settings");
  const tAll = await getTranslations();
  const label = (key: string) => (tAll.has(key) ? tAll(key) : key);
  // Iconița titlului: a intrării din meniu pentru secțiune.
  const icon = registry.acpMenu().flatMap((s) => s.items).find((i) => i.href === `/admin/settings/${section}`)?.icon ?? "fa-solid fa-sliders";

  // Limbile active și grupurile cu 2FA obligatoriu au formularul lor (căsuțe), nu câmpul JSON generic.
  const shown = section === "languages" ? defs.filter((d) => d.key !== "i18n.locales") : section === SECURITY_SECTION ? defs.filter((d) => d.key !== MFA_REQUIRED_GROUPS_SETTING) : defs;
  const fields: GcsSettingsField[] = await Promise.all(
    shown.map(async (def) => {
      const value = await settings.get(def.key);
      const f: GcsSettingsField = { key: def.key, label: label(def.labelKey), type: def.type, value: def.type === "secret" ? "" : value };
      if (def.type === "secret") f.secretSet = typeof value === "string" && value !== "";
      if (def.options) f.options = def.options.map((o) => ({ value: o, label: label(`settings.choices.${o}`) }));
      if (def.multiline) f.multiline = true;
      // Ajutorul câmpului, dacă are unul (`<eticheta>_hint`).
      if (tAll.has(`${def.labelKey}_hint`)) f.hint = tAll(`${def.labelKey}_hint`);
      return f;
    }),
  );
  const me = await db.user.findUnique({ where: { id: panel.user.id }, select: { email: true } });

  return (
    <>
      <GcsAcpTitle icon={icon}>{t.has(`titles.${section}`) ? t(`titles.${section}`) : section}</GcsAcpTitle>
      <GcsCard style={{ padding: 20, maxWidth: 720 }}>
        <GcsSettingsForm
          fields={fields}
          action={saveSettings.bind(null, section)}
          labels={{ save: t("save"), saved: tAll("acp.saved"), secretSet: t("secretSet"), secretEmpty: t("secretEmpty"), on: t("on") }}
        />
      </GcsCard>
      {section === "languages" && <LanguagesCard />}
      {section === SECURITY_SECTION && <MfaGroupsCard />}
      {section === UPLOADS_SECTION && <UploadsInfoCard />}
      {section === "email" && (
        <GcsCard as="section" aria-label={t("testEmail.title")} style={{ padding: 20, maxWidth: 720, display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 className="gcs-acpWidget__title"><GcsAcpTitleIcon name="fa-solid fa-paper-plane" />{t("testEmail.title")}</h2>
          <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14 }}>{t("testEmail.body", { email: me?.email ?? "" })}</p>
          <TestEmailButton labels={{ submit: t("testEmail.submit"), sent: t.raw("testEmail.sent"), failed: t.raw("testEmail.failed") }} />
        </GcsCard>
      )}
    </>
  );
}

/**
 * ACP → Setări → Securitate: grupurile ai căror membri trebuie să-și activeze 2FA înainte să folosească site-ul
 * (căsuțe; vizitatorii nu au cont, deci lipsesc). ACP-ul cere oricum 2FA tuturor celor cu acces.
 */
async function MfaGroupsCard() {
  const { settings, db } = services();
  const [t, selected, groups] = await Promise.all([
    getTranslations("acp.securitySettings"),
    loadMfaRequiredGroups(settings),
    db.group.findMany({ where: { key: { not: "guest" } }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
  ]);
  return (
    <GcsCard as="section" aria-label={t("mfaGroups")} style={{ padding: 20, maxWidth: 720, display: "flex", flexDirection: "column", gap: 12 }} data-testid="gcs-acp-mfa-groups">
      <h2 className="gcs-acpWidget__title">
        <GcsAcpTitleIcon name="fa-solid fa-user-shield" />
        {t("mfaGroups")}
      </h2>
      <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14 }}>{t("mfaGroupsHint")}</p>
      <GcsActionForm action={saveMfaGroups} submitLabel={t("save")} submitKind="save">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {groups.map((g) => (
            <label key={g.id} className="gcs-checkRow">
              <input type="checkbox" name="group" value={g.id} defaultChecked={selected.includes(g.id)} />
              {g.name}
            </label>
          ))}
        </div>
      </GcsActionForm>
    </GcsCard>
  );
}

/**
 * ACP → Setări → Încărcări și imagini: unde stau fișierele (driverul de stocare, read-only: se schimbă din mediul
 * serverului), limita de mărime pe grup (setarea `upload.max_mb`, editată la fiecare grup) și fișierele încă nelegate.
 */
async function UploadsInfoCard() {
  const { files, db } = services();
  const [t, groups, limits, unattached] = await Promise.all([
    getTranslations("acp.uploads"),
    db.group.findMany({ where: { key: { not: "guest" } }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
    db.groupSetting.findMany({ where: { key: "upload.max_mb" }, select: { groupId: true, value: true } }),
    db.attachment.count({ where: { contentType: null } }),
  ]);
  const store = files.describe?.() ?? null;
  const limit = new Map(limits.map((l) => [l.groupId, l.value]));
  const mb = (v: unknown) => (v === -1 ? t("unlimited") : typeof v === "number" && v > 0 ? t("mb", { mb: v }) : t("none"));
  return (
    <GcsCard as="section" aria-labelledby="gcs-uploads-info-title" style={{ padding: 20, maxWidth: 720, display: "flex", flexDirection: "column", gap: 12 }} data-testid="gcs-acp-uploads-info">
      <h2 id="gcs-uploads-info-title" className="gcs-acpWidget__title">
        <GcsAcpTitleIcon name="fa-solid fa-hard-drive" />
        {t("storageTitle")}
      </h2>
      <p style={{ margin: 0 }} data-testid="gcs-uploads-driver">
        {t("driver")}: <strong>{store ? t(`drivers.${store.driver}`) : t("drivers.unknown")}</strong>
        {store && (
          <>
            {" "}
            <code style={{ fontSize: 13, wordBreak: "break-all" }}>{store.location}</code>
          </>
        )}
      </p>
      <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14 }}>{t("driverHint")}</p>
      <h3 style={{ margin: "8px 0 0", fontSize: 15 }}>{t("limitsTitle")}</h3>
      <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14 }}>{t("limitsHint")}</p>
      <ul className="gcs-plainList" style={{ margin: 0, display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }} data-testid="gcs-uploads-limits">
        {groups.map((g) => (
          <li key={g.id}>
            <Link href={`/admin/groups/${g.id}`}>{g.name}</Link>: {mb(limit.get(g.id))}
          </li>
        ))}
      </ul>
      <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14 }} data-testid="gcs-uploads-unattached">
        {t("unattached", { count: unattached })}
      </p>
    </GcsCard>
  );
}

/** Limbile active (căsuțe) și starea serviciului de traducere (o traducere de probă). */
async function LanguagesCard() {
  const { settings, translation } = services();
  const [t, active, status] = await Promise.all([getTranslations("acp.languages"), settings.get<string[]>("i18n.locales"), translation.status()]);
  return (
    <GcsCard as="section" aria-label={t("title")} style={{ padding: 20, maxWidth: 720, display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 className="gcs-acpWidget__title"><GcsAcpTitleIcon name="fa-solid fa-language" />{t("title")}</h2>
      <p style={{ margin: 0 }} data-testid="gcs-translate-status">
        {t("status")}: <strong className={status === "ok" ? "gcs-rep--pos" : status === "error" ? "gcs-rep--neg" : "gcs-muted"}>{t(`statuses.${status}`)}</strong>
      </p>
      <GcsActionForm action={saveActiveLocales} submitLabel={t("save")} submitKind="save">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }} data-testid="gcs-acp-locales">
          {GCS_LOCALE_KEYS.map((code) => (
            <label key={code} className="gcs-checkRow">
              <input type="checkbox" name="locale" value={code} defaultChecked={active.includes(code)} />
              {LOCALE_NAMES[code] ?? code}
            </label>
          ))}
        </div>
      </GcsActionForm>
    </GcsCard>
  );
}
