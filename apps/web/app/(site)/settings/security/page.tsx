import type { Metadata } from "next";
import { headers } from "next/headers";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { getAuth } from "@/lib/auth";
import { services } from "@/lib/services";
import { GcsSessionsList, GcsTwoFactorSettings } from "../../_components/settings/GcsSettingsExtra";
import { GcsIcon } from "@gcs/ui/icons";
import { SETTINGS_ICONS } from "../../_components/settings/sections";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("nav.security") };
}

/** Un nume scurt pentru dispozitiv, din user-agent (browserul și sistemul). */
function deviceName(ua: string | null): string {
  if (!ua) return "—";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

/** Setări → Securitate (specul etapei 5): sesiunile active (cu deconectarea celorlalte) și autentificarea în doi pași. */
export default async function SecuritySettingsPage() {
  const actor = await currentActor();
  const [t, format, auth] = await Promise.all([getTranslations("settings.security"), getFormatter(), getAuth()]);
  const { db } = services();
  const [current, sessions, user] = await Promise.all([
    auth.api.getSession({ headers: await headers() }),
    db.session.findMany({ where: { userId: actor.userId!, expiresAt: { gt: new Date() } }, orderBy: { updatedAt: "desc" } }),
    db.user.findUniqueOrThrow({ where: { id: actor.userId! }, select: { twoFactorEnabled: true, accounts: { select: { providerId: true, password: true } } } }),
  ]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <h2 className="gcs-settingsTitle">
        <GcsIcon name={SETTINGS_ICONS.security} className="gcs-hIcon" />
        {t("title")}
      </h2>
      <section aria-labelledby="gcs-sec-sessions">
        <h3 id="gcs-sec-sessions" className="gcs-settingsSubtitle">
          <GcsIcon name="fa-solid fa-desktop" className="gcs-hIcon" />
          {t("sessions")}
        </h3>
        <GcsSessionsList
          sessions={sessions.map((s) => ({
            id: s.id,
            current: s.id === current?.session.id,
            device: deviceName(s.userAgent),
            ip: s.ipAddress,
            lastSeen: format.dateTime(s.updatedAt, { dateStyle: "medium", timeStyle: "short" }),
          }))}
          labels={{ current: t("current"), revoke: t("revoke"), revokeOthers: t("revokeOthers"), lastSeen: t.raw("lastSeen") as string, done: t("done") }}
        />
      </section>
      <section aria-labelledby="gcs-sec-2fa">
        <h3 id="gcs-sec-2fa" className="gcs-settingsSubtitle">
          <GcsIcon name="fa-solid fa-shield-halved" className="gcs-hIcon" />
          {t("twoFactor")}
        </h3>
        <GcsTwoFactorSettings
          enabled={user.twoFactorEnabled}
          hasPassword={user.accounts.some((a) => a.providerId === "credential" && a.password)}
          labels={{ enabled: t("twoFactorOn"), disabled: t("twoFactorOff"), enable: t("enable"), disable: t("disable"), password: t("password"), wrongPassword: t("wrongPassword") }}
        />
      </section>
    </div>
  );
}
