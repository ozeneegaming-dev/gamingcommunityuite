import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { SETTINGS_ICONS, settingsHref } from "../../_components/settings/sections";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("nav.apps") };
}

const NAMES: Record<string, string> = { steam: "Steam", discord: "Discord", google: "Google" };

/**
 * Setări → Aplicații autorizate (setările contului v2): serviciile externe cu acces la cont (autentificarea prin Steam,
 * Discord, Google), ce pot face (doar autentificarea și numele public) și de când; „Configurează” duce la pagina lor.
 */
export default async function AuthorisedAppsPage() {
  const actor = await currentActor();
  const [t, format] = await Promise.all([getTranslations("settings.apps"), getFormatter()]);
  const accounts = await services().db.account.findMany({ where: { userId: actor.userId!, providerId: { in: Object.keys(NAMES) } }, select: { providerId: true, createdAt: true, scope: true } });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 className="gcs-settingsTitle">
        <GcsIcon name={SETTINGS_ICONS.apps} className="gcs-hIcon" />
        {t("title")}
      </h2>
      <p className="gcs-muted" style={{ margin: 0 }}>
        {t("intro")}
      </p>
      {accounts.length === 0 ? (
        <p className="gcs-muted" data-testid="gcs-apps-empty">
          <GcsIcon name="fa-solid fa-plug-circle-xmark" className="gcs-emptyIcon" />
          {t("empty")}
        </p>
      ) : (
        <ul className="gcs-connectionCards" data-testid="gcs-apps">
          {accounts.map((a) => (
            <li key={a.providerId} className="gcs-connectionCard" data-provider={a.providerId} data-linked="true">
              <span className="gcs-connectionCard__icon" aria-hidden="true">
                <GcsIcon name={SETTINGS_ICONS[a.providerId as "steam" | "discord" | "google"]} />
              </span>
              <span className="gcs-connectionCard__text">
                <strong>{NAMES[a.providerId]}</strong>
                <span className="gcs-muted">{t("since", { date: format.dateTime(a.createdAt, { dateStyle: "long" }) })}</span>
                <span className="gcs-muted">{t(`access.${a.providerId}`)}</span>
              </span>
              <Link href={settingsHref(a.providerId as "steam" | "discord" | "google")} className="gcs-btn gcs-btn--ghost gcs-btn--sm">
                {t("configure")}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
