import { profileCompletion, STEAM_PLACEHOLDER_DOMAIN } from "@gcs/modules";
import { GcsAvatar, GcsMemberName } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { memberHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { SETTINGS_ICONS, settingsHref } from "../_components/settings/sections";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("nav.overview") };
}

const PROVIDERS = [
  ["steam", "fa-brands fa-steam", "Steam"],
  ["discord", "fa-brands fa-discord", "Discord"],
  ["google", "fa-brands fa-google", "Google"],
] as const;

/** Unde se rezolvă fiecare pas lipsă din bara „Profil completat”. */
const STEP_HREF: Record<string, string> = {
  avatar: "/settings/profile",
  bio: "/settings/profile",
  cover: "/settings/profile",
  birthday: "/settings/profile",
  signature: "/settings/signature",
  linkedAccount: "/settings/connections/steam",
  fields: "/settings/profile",
};

/**
 * Setări → Prezentare generală (setările contului v2): numele, emailul (cu „Schimbă”), bara de completare a profilului cu
 * pașii rămași, cardurile conturilor legate (Steam / Discord / Google: starea și „Configurează”) și scurtăturile.
 */
export default async function SettingsOverviewPage() {
  const actor = await currentActor();
  const { db, settings, profileQueries } = services();
  const t = await getTranslations("settings.overview");
  const tn = await getTranslations("settings.nav");
  const userId = actor.userId!;
  const [user, display, fields, values, discordId, googleId] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, email: true, image: true, bio: true, coverAttachmentId: true, birthday: true, signatureHtml: true, accounts: { select: { providerId: true, createdAt: true } } },
    }),
    profileQueries.userDisplays([userId]).then((m) => m.get(userId) ?? null),
    db.profileField.findMany({ where: { visibility: { not: "STAFF" } }, select: { id: true, key: true } }),
    db.profileFieldValue.findMany({ where: { userId }, select: { fieldId: true, value: true } }),
    settings.get<string>("auth.discord_client_id"),
    settings.get<string>("auth.google_client_id"),
  ]);
  const filled = new Set(values.filter((v) => v.value !== "").map((v) => v.fieldId));
  const linked = new Map(user.accounts.map((a) => [a.providerId, a.createdAt]));
  const completion = profileCompletion({
    avatar: user.image !== null,
    cover: user.coverAttachmentId !== null,
    bio: user.bio.trim() !== "",
    birthday: user.birthday !== null,
    signature: user.signatureHtml !== "",
    linkedAccount: PROVIDERS.some(([p]) => linked.has(p)),
    fields: fields.map((f) => ({ key: f.key, filled: filled.has(f.id) })),
  });
  const email = user.email.endsWith(STEAM_PLACEHOLDER_DOMAIN) ? null : user.email;
  const available = { steam: true, discord: Boolean(discordId), google: Boolean(googleId) };
  const quick = ["profile", "privacy", "notifications", "signature", "devices", "content"] as const;
  const myProfileHref = display ? memberHref(display) : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }} data-testid="gcs-settings-overview">
      <h2 className="gcs-settingsTitle">
        <GcsIcon name={SETTINGS_ICONS.overview} className="gcs-hIcon" />
        {t("title")}
      </h2>
      <section className="gcs-overviewHead">
        <GcsAvatar name={user.name} size="l" userId={userId} {...(user.image ? { src: user.image } : {})} />
        <div className="gcs-overviewHead__id">
          {display && <GcsMemberName userId={userId} name={display.name} nameKey={display.nameKey} href={memberHref(display)} size="full" className="gcs-overviewHead__name" data-testid="gcs-overview-name" />}
          <span className="gcs-muted" data-testid="gcs-overview-email">
            <GcsIcon name="fa-solid fa-envelope" className="gcs-hIcon" />
            {email ?? t("noEmail")}
          </span>
          <Link href={settingsHref("email")} className="gcs-btn gcs-btn--ghost gcs-btn--sm" style={{ alignSelf: "flex-start" }} data-testid="gcs-overview-change-email">
            {email ? t("changeEmail") : t("addEmail")}
          </Link>
        </div>
      </section>
      <section className="gcs-settingsFieldset" aria-labelledby="gcs-completion-title" data-testid="gcs-profile-completion">
        <h3 id="gcs-completion-title" className="gcs-settingsSubtitle">
          <GcsIcon name="fa-solid fa-list-check" className="gcs-hIcon" />
          {t("completion")}
          <strong className="gcs-completion__pct" data-testid="gcs-completion-percent">
            {completion.percent}%
          </strong>
        </h3>
        <div className="gcs-xpBar gcs-completion__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completion.percent} aria-labelledby="gcs-completion-title">
          <span style={{ width: `${completion.percent}%` }} />
        </div>
        {completion.missing.length > 0 ? (
          <ul className="gcs-completion__steps">
            {completion.missing.map((step) => (
              <li key={step}>
                <Link href={STEP_HREF[step] ?? "/settings/profile"}>
                  <GcsIcon name="fa-regular fa-circle" className="gcs-hIcon" />
                  {t(`steps.${step}`)}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="gcs-muted" style={{ margin: 0 }}>
            <GcsIcon name="fa-solid fa-circle-check" className="gcs-hIcon" />
            {t("complete")}
          </p>
        )}
      </section>
      <section aria-labelledby="gcs-linked-title">
        <h3 id="gcs-linked-title" className="gcs-settingsSubtitle">
          <GcsIcon name="fa-solid fa-link" className="gcs-hIcon" />
          {t("linked")}
        </h3>
        <ul className="gcs-connectionCards">
          {PROVIDERS.map(([p, icon, name]) => {
            const on = linked.has(p);
            return (
              <li key={p} className="gcs-connectionCard" data-provider={p} data-linked={on ? "true" : "false"} data-testid={`gcs-connection-${p}`}>
                <span className="gcs-connectionCard__icon" aria-hidden="true">
                  <GcsIcon name={icon} />
                </span>
                <span className="gcs-connectionCard__text">
                  <strong>{name}</strong>
                  <span className={on ? "gcs-connectionCard__on" : "gcs-muted"}>{on ? t("connected") : available[p] ? t("notConnected") : t("unavailable")}</span>
                </span>
                <Link href={settingsHref(p)} className="gcs-btn gcs-btn--ghost gcs-btn--sm">
                  {t("configure")}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
      <section aria-labelledby="gcs-quick-title">
        <h3 id="gcs-quick-title" className="gcs-settingsSubtitle">
          <GcsIcon name="fa-solid fa-bolt" className="gcs-hIcon" />
          {t("quick")}
        </h3>
        <ul className="gcs-quickLinks">
          {display && (
            <li>
              <Link href={myProfileHref ?? "/settings/profile"} className="gcs-quickLink">
                <GcsIcon name="fa-solid fa-id-badge" />
                {t("myProfile")}
              </Link>
            </li>
          )}
          {quick.map((s) => (
            <li key={s}>
              <Link href={settingsHref(s)} className="gcs-quickLink">
                <GcsIcon name={SETTINGS_ICONS[s]} />
                {tn(s)}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
