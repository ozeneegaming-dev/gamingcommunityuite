import { DELETION_COOLING_SETTING, type GcsActor } from "@gcs/core";
import { BRIDGE_PERMISSION, LINK_COMMAND, STEAM_PLACEHOLDER_DOMAIN } from "@gcs/modules";
import { GcsGameAccounts } from "../../_components/servers/GcsGameAccounts";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { freshSignIn } from "@/lib/account-deletion";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsDeleteAccount } from "../../_components/settings/GcsDeleteAccount";
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
  "link",
];

export default async function AccountSettingsPage({ searchParams }: { searchParams: Promise<{ email?: string; error?: string }> }) {
  const actor = await currentActor();
  const t = await getTranslations("settings.account");
  const user = await services().db.user.findUniqueOrThrow({
    where: { id: actor.userId! },
    select: { email: true, twoFactorEnabled: true, accounts: { select: { providerId: true, password: true } } },
  });
  const hasPassword = user.accounts.some((a) => a.providerId === "credential" && a.password);
  const [td, format, pending, cooling] = await Promise.all([
    getTranslations("settings.account.delete"),
    getFormatter(),
    services().memberRemoval.pendingFor(actor.userId!),
    services().settings.get<number>(DELETION_COOLING_SETTING),
  ]);
  const sp = await searchParams;
  const result = sp.email;
  const linkError = sp.error ? (["steam_linked", "email_doesn't_match", "account_already_linked_to_different_user"].includes(sp.error) ? sp.error.replace(/'/g, "") : "generic") : null;
  const { settings } = services();
  const [discordId, googleId] = await Promise.all([settings.get<string>("auth.discord_client_id"), settings.get<string>("auth.google_client_id")]);
  const available = [...(discordId ? (["discord"] as const) : []), ...(googleId ? (["google"] as const) : []), "steam" as const];
  const games = await gameAccounts(actor);
  const email = user.email.endsWith(STEAM_PLACEHOLDER_DOMAIN) ? null : user.email;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 className="gcs-settingsTitle">
        <GcsIcon name={SETTINGS_ICONS.account} className="gcs-hIcon" />
        {t("title")}
      </h2>
      {/* Membri v2: echipa a cerut schimbarea parolei (până atunci, site-ul trimite aici). */}
      {(await services().memberAdmin.passwordResetPending(actor.userId!)) && (
        <p role="alert" className="gcs-notice gcs-notice--warn" data-testid="gcs-password-reset-banner">
          {t("passwordResetRequired")}
        </p>
      )}
      {result === "changed" && (
        <p role="status" className="gcs-notice" data-testid="gcs-email-changed">
          {t("emailChanged")}
        </p>
      )}
      {linkError && (
        <p role="alert" className="gcs-notice gcs-notice--error" data-testid="gcs-link-error">
          {t(`linkErrors.${linkError}`)}
        </p>
      )}
      {result === "invalid" && (
        <p role="alert" className="gcs-notice gcs-notice--error">
          {t("emailInvalid")}
        </p>
      )}
      <GcsAccountForms
        email={email}
        hasPassword={hasPassword}
        accounts={user.accounts.filter((a) => a.providerId === "discord" || a.providerId === "google" || a.providerId === "steam").map((a) => ({ providerId: a.providerId as "discord" | "google" | "steam" }))}
        available={available}
        labels={{ ...Object.fromEntries(KEYS.map((k) => [k, t(k)])), currentEmail: email ? t("currentEmail", { email }) : "" }}
      />
      {games && <GcsGameAccounts identities={games.identities} canLink={games.canLink} command={LINK_COMMAND} />}
      <GcsDeleteAccount
        pending={pending?.runAfter ? td("pending", { date: format.dateTime(pending.runAfter, { dateStyle: "long", timeStyle: "short" }) }) : null}
        hasPassword={hasPassword}
        twoFactor={user.twoFactorEnabled}
        fresh={hasPassword ? true : await freshSignIn()}
        labels={{
          title: td("title"),
          intro: td("intro"),
          kept: td("kept"),
          cooling: td("cooling", { days: cooling }),
          password: td("password"),
          code: td("code"),
          understand: td("understand"),
          submit: td("submit"),
          fresh: td("fresh"),
          reauth: td("reauth"),
          cancel: td("cancel"),
          cancelled: td("cancelled"),
          requested: td("requested"),
        }}
      />
    </div>
  );
}

/** „Conturi de joc” (aplicația Servere activă): identitățile legate și dreptul de a genera un cod de legare. */
async function gameAccounts(actor: GcsActor) {
  const { serverQueries, bridge, permissions } = services();
  if (!actor.userId || !(await serverQueries.appEnabled())) return null;
  const [identities, canLink] = await Promise.all([bridge.players.byUser(actor.userId), permissions.can(actor, BRIDGE_PERMISSION.linkIdentity)]);
  return {
    canLink: canLink && !actor.isBanned,
    identities: identities.map((i) => ({ id: i.id, kind: i.kind, trust: i.trust, name: i.name, value: i.value, linkSource: i.linkSource, linkedAt: i.linkedAt })),
  };
}
