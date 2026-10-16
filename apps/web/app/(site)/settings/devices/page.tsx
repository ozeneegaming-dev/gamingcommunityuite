import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsDevicesList, GcsPrefToggle } from "../../_components/settings/GcsSettingsV2";
import { SETTINGS_ICONS } from "../../_components/settings/sections";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("nav.devices") };
}

/**
 * Setări → Dispozitive (setările contului v2): emailul la un dispozitiv nou, dispozitivele din ultimele 90 de zile
 * (sistem, browser, metoda de autentificare, locația aproximativă) și autentificarea automată pe fiecare.
 */
export default async function DevicesSettingsPage() {
  const actor = await currentActor();
  const { devices, memberPrefs } = services();
  const [t, format, prefs, h] = await Promise.all([getTranslations("settings.devices"), getFormatter(), memberPrefs.get(actor.userId!), headers()]);
  const list = await devices.list(actor.userId!, { userAgent: h.get("user-agent") });
  const region = (code: string | null) => {
    if (!code) return null;
    try {
      return new Intl.DisplayNames([t("locale")], { type: "region" }).of(code) ?? code;
    } catch {
      return code;
    }
  };
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <h2 className="gcs-settingsTitle">
        <GcsIcon name={SETTINGS_ICONS.devices} className="gcs-hIcon" />
        {t("title")}
      </h2>
      <GcsPrefToggle name="newDeviceEmail" value={prefs.newDeviceEmail} label={t("newDeviceEmail")} hint={t("newDeviceEmailHint")} saved={t("saved")} />
      <section aria-labelledby="gcs-devices-title">
        <h3 id="gcs-devices-title" className="gcs-settingsSubtitle">
          <GcsIcon name="fa-solid fa-clock-rotate-left" className="gcs-hIcon" />
          {t("recent")}
        </h3>
        <GcsDevicesList
          devices={list.map((d) => ({
            id: d.id,
            name: `${d.browser} · ${d.os}`,
            method: t(`methods.${d.method}`),
            ip: d.ip,
            location: region(d.location),
            firstSeen: when(d.firstSeenAt),
            lastSeen: when(d.lastSeenAt),
            current: d.current,
            autoLogin: d.autoLogin,
          }))}
          labels={{
            current: t("current"),
            method: t("method"),
            location: t("location"),
            ip: t("ip"),
            firstSeen: t("firstSeen"),
            lastSeen: t("lastSeen"),
            autoLogin: t("autoLogin"),
            autoLoginHint: t("autoLoginHint"),
            saved: t("saved"),
            empty: t("empty"),
          }}
        />
      </section>
    </div>
  );
}
