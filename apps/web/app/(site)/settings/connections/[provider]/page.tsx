import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsConnectionActions, GcsPrefToggle } from "../../../_components/settings/GcsSettingsV2";
import { SETTINGS_ICONS } from "../../../_components/settings/sections";

const PROVIDERS = { steam: "Steam", discord: "Discord", google: "Google" } as const;
type Provider = keyof typeof PROVIDERS;

type Props = { params: Promise<{ provider: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = (await params).provider;
  return p in PROVIDERS ? { title: (await getTranslations("settings"))(`nav.${p as Provider}`) } : {};
}

/**
 * Setări → Steam / Discord / Google (setările contului v2): starea legăturii, legarea sau dezlegarea contului și, la Steam,
 * tabul Steam și tabul FACEIT de pe profilul public (membrul le poate ascunde).
 */
export default async function ConnectionSettingsPage({ params }: Props) {
  const raw = (await params).provider;
  if (!(raw in PROVIDERS)) notFound();
  const provider = raw as Provider;
  const actor = await currentActor();
  const { db, settings, memberPrefs, externalProfiles } = services();
  const [t, format, account, prefs, discordId, googleId, keys] = await Promise.all([
    getTranslations("settings.connections"),
    getFormatter(),
    db.account.findFirst({ where: { userId: actor.userId!, providerId: provider }, select: { accountId: true, createdAt: true } }),
    memberPrefs.get(actor.userId!),
    settings.get<string>("auth.discord_client_id"),
    settings.get<string>("auth.google_client_id"),
    externalProfiles.configured(),
  ]);
  const available = provider === "steam" || (provider === "discord" ? Boolean(discordId) : Boolean(googleId));
  const name = PROVIDERS[provider];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }} data-testid={`gcs-settings-connection-${provider}`}>
      <h2 className="gcs-settingsTitle">
        <GcsIcon name={SETTINGS_ICONS[provider]} className="gcs-hIcon" />
        {name}
      </h2>
      <section className="gcs-settingsFieldset">
        <p style={{ margin: 0 }} data-testid="gcs-connection-status">
          {account ? t("linkedSince", { name, date: format.dateTime(account.createdAt, { dateStyle: "long" }) }) : t("notLinked", { name })}
        </p>
        {provider === "steam" && account && /^\d{17}$/.test(account.accountId) && (
          <p className="gcs-muted" style={{ margin: 0 }}>
            SteamID64: <span className="gcs-mono">{account.accountId}</span>
          </p>
        )}
        <p className="gcs-field__hint">{t(`about.${provider}`)}</p>
        <GcsConnectionActions provider={provider} linked={account !== null} available={available} labels={{ link: t("link", { name }), unlink: t("unlink"), saved: t("saved"), unavailable: t("unavailable") }} />
      </section>
      {provider === "steam" && (
        <section className="gcs-settingsFieldset" aria-labelledby="gcs-steam-tabs">
          <h3 id="gcs-steam-tabs" className="gcs-settingsSubtitle">
            <GcsIcon name="fa-solid fa-table-columns" className="gcs-hIcon" />
            {t("profileTabs")}
          </h3>
          <GcsPrefToggle name="steamTab" value={prefs.steamTab} label={t("steamTab")} hint={keys.steam ? t("steamTabHint") : t("steamOff")} saved={t("saved")} />
          {keys.faceit && <GcsPrefToggle name="faceitTab" value={prefs.faceitTab} label={t("faceitTab")} hint={t("faceitTabHint")} saved={t("saved")} />}
        </section>
      )}
    </div>
  );
}
