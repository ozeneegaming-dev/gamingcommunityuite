import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { GcsIcon } from "@gcs/ui/icons";
import { currentActor } from "@/lib/actor";
import { alertPrefs } from "@/lib/appearance";
import { services } from "@/lib/services";
import { GcsNotificationPrefsForm, type GcsNotificationPrefCategory } from "../../_components/settings/GcsNotificationPrefsForm";
import { GcsPushSettings } from "../../_components/settings/GcsPushSettings";
import { GcsAlertPrefsForm } from "../../_components/settings/GcsSettingsExtra";
import { SETTINGS_ICONS } from "../../_components/settings/sections";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("nav.notifications") };
}

/**
 * Setări → Notificări (Notificări v2): alertele de pe site (toast-uri, sunet), web push pe acest dispozitiv (permisiunea
 * se cere doar de aici, la click) cu lista dispozitivelor, apoi tabelul canalelor pe categorii și tipuri (site, toast,
 * email cu modul lui, push; pornit / doar important / oprit), cu canalele blocate din ACP și „Resetează la implicit”.
 */
export default async function NotificationSettingsPage() {
  const actor = await currentActor();
  const [t, tAll] = await Promise.all([getTranslations("settings.notifications"), getTranslations()]);
  const { notifications, push } = services();
  const userId = actor.userId!;
  const [catalog, prefs, alerts, publicKey, devices, emailsOff] = await Promise.all([
    notifications.catalog(),
    notifications.preferences(userId),
    alertPrefs(actor.userId),
    push.publicKey(),
    push.devices(userId),
    notifications.emailsOff(userId),
  ]);
  const label = (key: string, fallback: string) => (tAll.has(key) ? tAll(key) : fallback);
  const categories: GcsNotificationPrefCategory[] = catalog.map((c) => ({
    key: c.key,
    label: label(c.labelKey, c.key),
    icon: <GcsIcon name={c.icon} />,
    types: c.types
      .filter((x) => prefs[x.key])
      .map((x) => {
        const p = prefs[x.key]!;
        return { type: x.key, label: label(x.labelKey, x.key), important: x.important, defaults: p.defaults, effective: p.effective, override: p.override };
      }),
  }));

  return (
    <div className="gcs-notifSettings">
      <h2 className="gcs-settingsTitle">
        <GcsIcon name={SETTINGS_ICONS.notifications} className="gcs-hIcon" />
        {t("title")}
      </h2>
      <p className="gcs-field__hint" style={{ margin: 0 }}>
        {t("hint")}
      </p>
      {emailsOff && (
        <p className="gcs-notice gcs-notice--error" data-testid="gcs-pref-emails-off">
          {t("emailsOffNotice")}
        </p>
      )}
      <GcsAlertPrefsForm
        toasts={alerts.toasts}
        sound={alerts.sound}
        labels={{ title: t("alertsTitle"), toasts: t("toasts"), sound: t("sound"), save: t("alertsSave"), saved: t("saved") }}
      />
      <GcsPushSettings
        publicKey={publicKey}
        devices={devices}
      />
      <GcsNotificationPrefsForm categories={categories} />
    </div>
  );
}
