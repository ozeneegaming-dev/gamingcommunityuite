import { STEAM_PLACEHOLDER_DOMAIN } from "@gcs/modules";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsEmailForm } from "../../_components/settings/GcsSettingsV2";
import { SETTINGS_ICONS } from "../../_components/settings/sections";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("nav.email") };
}

/** Setări → Email (setările contului v2): adresa curentă și schimbarea ei, cu confirmarea pe adresa nouă. */
export default async function EmailSettingsPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const actor = await currentActor();
  const [t, ta] = await Promise.all([getTranslations("settings.email"), getTranslations("settings.account")]);
  const user = await services().db.user.findUniqueOrThrow({ where: { id: actor.userId! }, select: { email: true } });
  const email = user.email.endsWith(STEAM_PLACEHOLDER_DOMAIN) ? null : user.email;
  const result = (await searchParams).email;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 className="gcs-settingsTitle">
        <GcsIcon name={SETTINGS_ICONS.email} className="gcs-hIcon" />
        {t("title")}
      </h2>
      {result === "changed" && (
        <p role="status" className="gcs-notice">
          {ta("emailChanged")}
        </p>
      )}
      <GcsEmailForm
        email={email}
        labels={{ current: email ? ta("currentEmail", { email }) : "", none: ta("noEmail"), newEmail: ta("newEmail"), send: ta("sendLink"), sent: ta("emailSent"), hint: t("hint") }}
      />
    </div>
  );
}
