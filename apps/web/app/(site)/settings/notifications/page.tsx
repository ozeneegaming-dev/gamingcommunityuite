import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { alertPrefs } from "@/lib/appearance";
import { services } from "@/lib/services";
import { GcsNotificationPrefsForm } from "../../_components/settings/GcsNotificationPrefsForm";
import { GcsAlertPrefsForm } from "../../_components/settings/GcsSettingsExtra";
import { GcsIcon } from "@gcs/ui/icons";
import { SETTINGS_ICONS } from "../../_components/settings/sections";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("nav.notifications") };
}

const KEYS = ["saved", "save", "type", "site", "email", "email_OFF", "email_INSTANT", "email_DIGEST", "hint"];

export default async function NotificationSettingsPage() {
  const actor = await currentActor();
  const [t, tn] = await Promise.all([getTranslations("settings.notifications"), getTranslations()]);
  const { notifications, registry } = services();
  const [prefs, alerts] = await Promise.all([notifications.preferences(actor.userId!), alertPrefs(actor.userId)]);
  const rows = registry.notificationTypes().map((def) => ({ type: def.key, label: tn(def.labelKey), ...prefs[def.key]! }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 className="gcs-settingsTitle">
        <GcsIcon name={SETTINGS_ICONS.notifications} className="gcs-hIcon" />
        {t("title")}
      </h2>
      <p className="gcs-field__hint" style={{ margin: 0 }}>
        {t("hint")}
      </p>
      <GcsAlertPrefsForm
        toasts={alerts.toasts}
        sound={alerts.sound}
        labels={{ title: t("alertsTitle"), toasts: t("toasts"), sound: t("sound"), save: t("alertsSave"), saved: t("saved") }}
      />
      <GcsNotificationPrefsForm rows={rows} labels={Object.fromEntries(KEYS.map((k) => [k, t(k)]))} />
    </div>
  );
}
