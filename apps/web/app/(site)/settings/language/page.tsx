import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { localeOptions } from "@/lib/locales";
import { services } from "@/lib/services";
import { setLocale } from "../../actions";
import { GcsTimezoneForm } from "../../_components/settings/GcsSettingsExtra";
import { GcsIcon } from "@gcs/ui/icons";
import { SETTINGS_ICONS } from "../../_components/settings/sections";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("nav.language") };
}

/** Setări → Limbă și fus orar (specul etapei 5): limba interfeței (și a emailurilor) și fusul orar al datelor. */
export default async function LanguageSettingsPage() {
  const actor = await currentActor();
  const [t, locale, locales, user] = await Promise.all([
    getTranslations("settings.language"),
    getLocale(),
    localeOptions(),
    services().db.user.findUniqueOrThrow({ where: { id: actor.userId! }, select: { timezone: true } }),
  ]);
  const zones = Intl.supportedValuesOf("timeZone");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <h2 className="gcs-settingsTitle">
        <GcsIcon name={SETTINGS_ICONS.language} className="gcs-hIcon" />
        {t("title")}
      </h2>
      <form action={setLocale} className="gcs-settingsForm" aria-label={t("language")}>
        <h3 className="gcs-settingsSubtitle">
          <GcsIcon name="fa-solid fa-language" className="gcs-hIcon" />
          {t("language")}
        </h3>
        <div className="gcs-seg__group" style={{ flexWrap: "wrap" }}>
          {locales.map((l) => (
            <button key={l.code} type="submit" name="locale" value={l.code} className={l.code === locale ? "gcs-seg gcs-seg--active" : "gcs-seg"} aria-pressed={l.code === locale} lang={l.code}>
              {l.label}
            </button>
          ))}
        </div>
      </form>
      <div>
        <h3 className="gcs-settingsSubtitle">
          <GcsIcon name="fa-solid fa-clock" className="gcs-hIcon" />
          {t("timezone")}
        </h3>
        <GcsTimezoneForm current={zones.includes(user.timezone) ? user.timezone : "Europe/Bucharest"} zones={zones} labels={{ timezone: t("timezone"), save: t("save"), saved: t("saved") }} />
      </div>
    </div>
  );
}
