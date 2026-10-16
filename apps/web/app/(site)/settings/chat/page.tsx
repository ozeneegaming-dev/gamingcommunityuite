import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { SETTINGS_ICONS } from "../../_components/settings/sections";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("nav.chat") };
}

/**
 * Setări → Chat (setările contului v2): unde se schimbă preferințele chat-ului (din chat, butonul de setări: aranjamentul,
 * culorile, sunetele, botul — cu Chat Pro), membrii ignorați și notificările mențiunilor. Fără aplicația Chat: un mesaj.
 */
export default async function ChatSettingsPage() {
  const actor = await currentActor();
  const [t, usable] = await Promise.all([getTranslations("settings.chat"), services().apps.accessFilter(actor)]);
  const chat = usable("chat");
  const pro = chat && usable("chat_pro");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }} data-testid="gcs-settings-chat">
      <h2 className="gcs-settingsTitle">
        <GcsIcon name={SETTINGS_ICONS.chat} className="gcs-hIcon" />
        {t("title")}
      </h2>
      {!chat ? (
        <p className="gcs-notice">{t("off")}</p>
      ) : (
        <>
          <p style={{ margin: 0 }}>{pro ? t("introPro") : t("intro")}</p>
          <ul className="gcs-quickLinks">
            <li>
              <Link href="/chat" className="gcs-quickLink">
                <GcsIcon name="fa-solid fa-comments" />
                {t("open")}
              </Link>
            </li>
            <li>
              <Link href="/settings/ignored" className="gcs-quickLink">
                <GcsIcon name="fa-solid fa-user-slash" />
                {t("ignored")}
              </Link>
            </li>
            <li>
              <Link href="/settings/notifications" className="gcs-quickLink">
                <GcsIcon name="fa-solid fa-bell" />
                {t("notifications")}
              </Link>
            </li>
          </ul>
        </>
      )}
    </div>
  );
}
