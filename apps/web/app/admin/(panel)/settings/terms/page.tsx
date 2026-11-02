import { NOTIFICATIONS_PRUNE_DAYS_SETTING } from "@gcs/core";
import {
  COOKIE_BANNER_SETTING,
  COOKIE_TEXT_SETTING,
  IP_RETENTION_SETTING,
  LEGAL_ACP_SECTION,
  LEGAL_DOCS,
  LEGAL_HREFS,
  LEGAL_MODES,
  REQUIRE_TERMS_SETTING,
  RETENTION_SETTING_DEFS,
  isCommunityRules,
  legalSetting,
  type GcsLegalMode,
} from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { JSONContent } from "@tiptap/core";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../_components/GcsAcpTitle";
import { GcsSettingsForm, type GcsSettingsField } from "../../_components/GcsSettingsForm";
import { saveLegalOptions, saveRetention } from "./actions";
import { GcsLegalDocEditor } from "./GcsLegalDocEditor";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.legal"))("title") };
}

/**
 * ACP → Setări → Termeni și confidențialitate: termenii și politica de confidențialitate (pagina de pe site, scrisă cu
 * editorul postărilor, sau o adresă externă), acceptarea termenilor la înregistrare, banda de cookie-uri și perioadele
 * de păstrare a datelor (jobul zilnic `system.retention`; IP-urile și notificările au setările lor, arătate aici).
 */
export default async function AcpLegalPage() {
  await requireAcpSection(LEGAL_ACP_SECTION);
  const { settings, registry } = services();
  const [t, tAll] = await Promise.all([getTranslations("acp.legal"), getTranslations()]);
  const label = (key: string) => (tAll.has(key) ? tAll(key) : key);
  const defs = new Map(registry.settingDefs().map((d) => [d.key, d]));

  const docs = await Promise.all(
    LEGAL_DOCS.map(async (kind) => {
      const [mode, url, content] = await Promise.all([
        settings.get<string>(legalSetting(kind, "mode")),
        settings.get<string>(legalSetting(kind, "url")),
        settings.get<unknown>(legalSetting(kind, "content")),
      ]);
      return {
        kind,
        mode: (LEGAL_MODES.includes(mode as GcsLegalMode) ? mode : "none") as GcsLegalMode,
        url: typeof url === "string" ? url : "",
        doc: isCommunityRules(content) ? (content.doc as JSONContent) : null,
      };
    }),
  );

  const fieldsFor = (keys: string[]): Promise<GcsSettingsField[]> =>
    Promise.all(
      keys.map(async (key) => {
        const def = defs.get(key)!;
        const f: GcsSettingsField = { key, label: label(def.labelKey), type: def.type, value: await settings.get(key) };
        if (def.multiline) f.multiline = true;
        if (tAll.has(`${def.labelKey}_hint`)) f.hint = tAll(`${def.labelKey}_hint`);
        return f;
      }),
    );
  const [optionFields, retentionFields, ipDays, notificationDays] = await Promise.all([
    fieldsFor([REQUIRE_TERMS_SETTING, COOKIE_BANNER_SETTING, COOKIE_TEXT_SETTING]),
    fieldsFor(RETENTION_SETTING_DEFS.map((d) => d.key)),
    settings.get<number>(IP_RETENTION_SETTING),
    settings.get<number>(NOTIFICATIONS_PRUNE_DAYS_SETTING),
  ]);
  const formLabels = { save: t("save"), saved: tAll("acp.saved"), secretSet: "", secretEmpty: "", on: tAll("acp.settings.on") };
  const days = (n: number) => (n > 0 ? t("retention.days", { days: n }) : t("retention.forever"));

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-file-contract">{t("title")}</GcsAcpTitle>
      {docs.map((d) => (
        <GcsCard key={d.kind} as="section" aria-labelledby={`gcs-legal-${d.kind}-title`} style={{ padding: 20, maxWidth: 900, display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 id={`gcs-legal-${d.kind}-title`} className="gcs-acpWidget__title">
            <GcsAcpTitleIcon name={d.kind === "terms" ? "fa-solid fa-file-contract" : "fa-solid fa-user-shield"} />
            {t(`${d.kind}.title`)}
          </h2>
          <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14 }}>
            {t(`${d.kind}.hint`)}{" "}
            <Link href={LEGAL_HREFS[d.kind]} target="_blank" rel="noopener">
              <GcsIcon name="fa-solid fa-arrow-up-right-from-square" className="gcs-hIcon" />
              {t("view")}
            </Link>
          </p>
          <GcsLegalDocEditor
            kind={d.kind}
            initial={{ mode: d.mode, url: d.url, doc: d.doc }}
            labels={{
              mode: t("mode"),
              modes: { none: t("modes.none"), page: t("modes.page"), external: t("modes.external") },
              url: t("url"),
              urlHint: t("urlHint"),
              content: t("content"),
              save: t("saveDoc"),
              saved: t("savedDoc"),
            }}
          />
        </GcsCard>
      ))}

      <GcsCard as="section" aria-labelledby="gcs-legal-options-title" style={{ padding: 20, maxWidth: 720, display: "flex", flexDirection: "column", gap: 12 }} data-testid="gcs-legal-options">
        <h2 id="gcs-legal-options-title" className="gcs-acpWidget__title">
          <GcsAcpTitleIcon name="fa-solid fa-cookie-bite" />
          {t("options")}
        </h2>
        <GcsSettingsForm fields={optionFields} action={saveLegalOptions} labels={formLabels} />
      </GcsCard>

      <GcsCard as="section" aria-labelledby="gcs-legal-retention-title" style={{ padding: 20, maxWidth: 720, display: "flex", flexDirection: "column", gap: 12 }} data-testid="gcs-legal-retention">
        <h2 id="gcs-legal-retention-title" className="gcs-acpWidget__title">
          <GcsAcpTitleIcon name="fa-solid fa-box-archive" />
          {t("retention.title")}
        </h2>
        <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14 }}>{t("retention.hint")}</p>
        <GcsSettingsForm fields={retentionFields} action={saveRetention} labels={formLabels} />
        {/* Setările păstrate în paginile lor (aceleași valori, nu dubluri): IP-urile și notificările citite. */}
        <ul className="gcs-plainList" style={{ margin: 0, display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }} data-testid="gcs-legal-retention-other">
          <li>
            {t("retention.ips", { value: days(ipDays) })} <Link href="/admin/members/ip-tools">{t("retention.edit")}</Link>
          </li>
          <li>
            {t("retention.notifications", { value: days(notificationDays) })} <Link href="/admin/members/settings/notifications">{t("retention.edit")}</Link>
          </li>
        </ul>
      </GcsCard>
    </>
  );
}
