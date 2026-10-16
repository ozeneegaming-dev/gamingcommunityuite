import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsContentViewForm } from "../../_components/settings/GcsSettingsV2";
import { SETTINGS_ICONS } from "../../_components/settings/sections";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("nav.content") };
}

/** Setări → Vizualizarea conținutului (setările contului v2): un topic deschis din liste pornește de la prima necitită, de la început sau de la ultima postare. */
export default async function ContentViewSettingsPage() {
  const actor = await currentActor();
  const [t, prefs] = await Promise.all([getTranslations("settings.content"), services().memberPrefs.get(actor.userId!)]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 className="gcs-settingsTitle">
        <GcsIcon name={SETTINGS_ICONS.content} className="gcs-hIcon" />
        {t("title")}
      </h2>
      <GcsContentViewForm
        value={prefs.topicOpen}
        labels={{
          legend: t("legend"),
          save: t("save"),
          saved: t("saved"),
          options: {
            unread: { label: t("unread"), hint: t("unreadHint") },
            start: { label: t("start"), hint: t("startHint") },
            last: { label: t("last"), hint: t("lastHint") },
          },
        }}
      />
    </div>
  );
}
