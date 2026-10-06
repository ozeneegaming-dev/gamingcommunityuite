import { STEAM_PLACEHOLDER_DOMAIN } from "@gcs/modules";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsAccountForms } from "../../_components/settings/GcsSettingsForms";
import { GcsIcon } from "@gcs/ui/icons";
import { SETTINGS_ICONS } from "../../_components/settings/sections";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("nav.account") };
}

const KEYS = [
  "saved",
  "emailSent",
  "passwordChanged",
  "emailTitle",
  "noEmail",
  "newEmail",
  "sendLink",
  "passwordTitle",
  "currentPassword",
  "newPassword",
  "changePassword",
  "linkedTitle",
  "linked",
  "notLinked",
  "unlink",
];

export default async function AccountSettingsPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const actor = await currentActor();
  const t = await getTranslations("settings.account");
  const user = await services().db.user.findUniqueOrThrow({
    where: { id: actor.userId! },
    select: { email: true, accounts: { select: { providerId: true, password: true } } },
  });
  const result = (await searchParams).email;
  const email = user.email.endsWith(STEAM_PLACEHOLDER_DOMAIN) ? null : user.email;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 className="gcs-settingsTitle">
        <GcsIcon name={SETTINGS_ICONS.account} className="gcs-hIcon" />
        {t("title")}
      </h2>
      {result === "changed" && (
        <p role="status" className="gcs-notice" data-testid="gcs-email-changed">
          {t("emailChanged")}
        </p>
      )}
      {result === "invalid" && (
        <p role="alert" className="gcs-notice gcs-notice--error">
          {t("emailInvalid")}
        </p>
      )}
      <GcsAccountForms
        email={email}
        hasPassword={user.accounts.some((a) => a.providerId === "credential" && a.password)}
        accounts={user.accounts.filter((a) => a.providerId === "discord" || a.providerId === "steam").map((a) => ({ providerId: a.providerId as "discord" | "steam" }))}
        labels={{ ...Object.fromEntries(KEYS.map((k) => [k, t(k)])), currentEmail: email ? t("currentEmail", { email }) : "" }}
      />
    </div>
  );
}
