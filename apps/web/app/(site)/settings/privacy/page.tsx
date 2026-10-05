import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsPrivacyForm } from "../../_components/settings/GcsSettingsForms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("nav.privacy") };
}

const KEYS = [
  "saved",
  "save",
  "profile",
  "messages",
  "wall",
  "showOnline",
  "followedHint",
  "profile_PUBLIC",
  "profile_MEMBERS",
  "profile_FOLLOWED",
  "messages_MEMBERS",
  "messages_FOLLOWED",
  "messages_NOBODY",
  "wall_MEMBERS",
  "wall_FOLLOWED",
  "wall_NOBODY",
];

export default async function PrivacySettingsPage() {
  const actor = await currentActor();
  const t = await getTranslations("settings.privacy");
  const privacy = await services().profiles.privacyOf(actor.userId!);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 className="gcs-settingsTitle">{t("title")}</h2>
      <GcsPrivacyForm privacy={privacy} labels={Object.fromEntries(KEYS.map((k) => [k, t(k)]))} />
    </div>
  );
}
