import { GCS_BRAND } from "@gcs/core/themes";
import { BIRTHDAY_NO_YEAR, groupFields, type GcsLockedBadge, type GcsProfileView } from "@gcs/modules";
import { parseUserRef, slugify } from "@gcs/modules/slug";
import { profileTabs } from "@/lib/profile-tabs";
import { GcsFaceitTab, GcsSteamTab } from "../../_components/profile/GcsProfileExternal";
import { GcsServerStatsStrip } from "../../_components/profile/GcsServerStatsStrip";
import { GcsAvatar, GcsBadgeArt, GcsCard, GcsClanTag, GcsMemberName } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { cache } from "react";
import { currentActor } from "@/lib/actor";
import { memberHref, tint, topicHref } from "@/lib/forum-urls";
import { pageParam } from "@/lib/forum-page";
import { memberLook } from "@/lib/member-look";
import { services } from "@/lib/services";
import { clanColors, GcsClanLogo } from "../../_components/clans/GcsClanLogo";
import { playerHref } from "../../_components/servers/types";
import { GcsProfileActions } from "../../_components/profile/GcsProfileActions";
import { GcsProfileBackdrop, GcsProfileSong } from "../../_components/profile/GcsProfileVip";
import { GcsWallComposer, GcsWallItemActions } from "../../_components/profile/GcsWall";
import { GcsTranslateButton } from "../../_components/GcsTranslateButton";
import { GcsDeletedMember } from "../../_components/GcsDeletedMember";
import { translateLabels } from "@/lib/translate";
import { GcsMemberLink, GcsNamedHtml } from "@/lib/member-names";
import { pageMetadata, seoMeta } from "@/lib/seo";
import { GcsGroupLink } from "@/lib/group-pills";
import { GcsMemberPanelBody, GcsProfilePanelCard, memberPanels } from "@/lib/member-panels";

/** Tabul unei pagini de profil: cheia unui tab de bază sau a unuia adus de o aplicație (`GcsModule.profileTabs`). */
type Tab = string;

/** Iconițele taburilor de bază (și ale titlurilor secțiunilor lor); taburile aplicațiilor își aduc iconița. */
const TAB_ICONS = {
  activity: "fa-solid fa-chart-line",
  about: "fa-solid fa-circle-info",
  games: "fa-solid fa-gamepad",
  followers: "fa-solid fa-user-group",
  badges: "fa-solid fa-award",
  warnings: "fa-solid fa-triangle-exclamation",
  articles: "fa-solid fa-newspaper",
  skins: "fa-solid fa-gun",
} as const;

type Props = { params: Promise<{ ref: string }>; searchParams: Promise<{ tab?: string; page?: string; before?: string }> };

/** Un singur apel pe request (metadata + pagina). */
const loadProfile = cache(async (ref: string) => {
  const parsed = parseUserRef(ref);
  if (!parsed) return null;
  const actor = await currentActor();
  const profile = await services().profileQueries.profile(actor, parsed.id);
  return profile ? { parsed, actor, profile } : null;
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await loadProfile((await params).ref);
  if (!data) return {};
  const { user, stats } = data.profile;
  const url = `/members/${user.id}-${user.slug}`;
  // Profilurile fără conținut public nu ajung în motoarele de căutare; nici unul, dacă ACP → SEO oprește indexarea lor.
  const indexed = (await seoMeta()).indexProfiles && stats.posts > 0;
  return pageMetadata({ title: user.name, description: user.bio, path: url, image: user.image, type: "profile", noindex: !indexed });
}

/** Profilul „player card” (macheta Profil, specul etapei 3 §8). */
export default async function MemberProfilePage({ params, searchParams }: Props) {
  const { ref } = await params;
  const query = await searchParams;
  const data = await loadProfile(ref);
  if (!data) notFound();
  const { parsed, actor, profile } = data;
  const translate = await translateLabels(actor);
  const { user, stats, viewer } = profile;
  // Taburile vizibile (cele de bază și ale aplicațiilor pornite); un tab necunoscut sau ascuns → Activitate (primul).
  const tabs = await profileTabs(actor, { userId: user.id, isSelf: viewer.isSelf, canSeeWarnings: viewer.canSeeWarnings });
  const firstTab = tabs[0]?.key ?? "about";
  const tab: Tab = tabs.some((x) => x.key === query.tab) ? query.tab! : firstTab;
  if (parsed.slug !== user.slug) permanentRedirect(`/members/${user.id}-${user.slug}${tab !== firstTab ? `?tab=${tab}` : ""}`);
  // Vizitatorii recenți: vizita se notează (o dată la 10 minute, după preferințele vizitatorului).
  await services()
    .profileExtras.recordVisit(actor, user.id)
    .catch(() => false);

  const t = await getTranslations("profile");
  const tAll = await getTranslations();
  const format = await getFormatter();
  const tabHref = (k: Tab) => `/members/${user.id}-${user.slug}${k === firstTab ? "" : `?tab=${k}`}`;
  const relative = (iso: string) => format.relativeTime(new Date(iso));
  const accent = user.accentColor ?? GCS_BRAND.color.dark.accent;
  const about = profile.fields.filter((f) => f.section === "ABOUT");
  const games = profile.fields.filter((f) => f.section === "GAMES");
  /** Câmpurile tabului Jocuri fără grup: rămân în caseta conturilor legate. */
  const gamesLoose = games.filter((f) => f.groupId == null);
  // Aspectul publicat de pluginuri (Studio VIP): doar adăugiri în locurile existente ale profilului (fundal, rama,
  // pastila banner-ului, arma în statistici, citatul și melodia), iar tema prin variabile CSS.
  const look = await memberLook(user.id);
  // Grupul afișat (pastila mare) și grupurile secundare vizibile (pastilele mici), linkuri spre membrii lor.
  const memberGroups = (await services().groupDirectory.memberGroups([user.id])).get(user.id);
  const shownGroup = memberGroups?.shown ?? null;
  const secondaryGroups = memberGroups?.secondary ?? [];
  const tv = look ? await getTranslations("profile.vip") : null;
  // Clanurile membrului (aplicația Clanuri): tagul lângă nume și insigna clanului, după opțiuni.
  const clans = await services().clanQueries.memberClans(user.id);
  // Statisticile de pe serverele comunității (aplicația Servere): identitatea principală, cu link spre profilul de jucător.
  const game = await services().bridge.queries.userCard(actor, user.id);
  const tr = await getTranslations("clans.roles");
  const tViewer = await getTranslations("imageViewer");
  const birthdayRow = await services().db.user.findUnique({ where: { id: user.id }, select: { birthday: true, birthdayVisible: true, birthdayShowYear: true } });
  const birthday = birthdayRow?.birthdayVisible && birthdayRow.birthday ? birthdayRow.birthday : null;
  // Anul doar dacă membrul l-a dat și a ales să-l arate (grupul „De bază”).
  const birthdayYear = birthday && birthdayRow?.birthdayShowYear && birthday.getUTCFullYear() !== BIRTHDAY_NO_YEAR;
  // Coloana v2: realizările, grupurile câmpurilor, urmăritorii, vizitatorii; banda statisticilor pe servere.
  const { profileExtras, profileFields, apps, bridge: bridgeSvc } = services();
  const usable = await apps.accessFilter(actor);
  const [achievements, fieldGroups, visitors, followerPreview, serverStats] = await Promise.all([
    profileExtras.achievements(actor, user.id),
    profileFields.groups(),
    profileExtras.visitors(actor, user.id),
    services().profileQueries.followers(actor, user.id, 1),
    usable("servers") ? bridgeSvc.queries.userServerStats(actor, user.id).catch(() => []) : Promise.resolve([]),
  ]);
  const visitorUsers = visitors && visitors.length > 0 ? await services().profileQueries.userDisplays(visitors.map((v) => v.id)) : new Map();

  const header = (
    <section
      className="gcs-card gcs-profileHeader"
      style={{ borderColor: tint(accent, 0.45) }}
      data-testid="gcs-profile"
      // Coperta și avatarul se deschid în vizualizatorul de imagini (galeria profilului).
      data-gcs-gallery="profile"
      data-gcs-caption-author={user.name}
    >
      <div
        className="gcs-profileHeader__cover"
        data-testid="gcs-profile-cover"
        style={{
          background: user.cover
            ? `center ${user.cover.positionY}% / cover no-repeat url(${user.cover.url})`
            : `radial-gradient(circle at 20% 30%, ${tint(accent, 0.55)}, transparent 45%), linear-gradient(120deg, #1B1033, ${tint(accent, 0.25)} 40%, #0F2236)`,
        }}
      >
        {user.cover && <button type="button" className="gcs-profileHeader__coverZoom" data-gcs-viewer={user.cover.url} aria-label={tViewer("cover")} data-testid="gcs-profile-cover-zoom" />}
      </div>
      <div className="gcs-profileHeader__main">
        {user.image ? (
          <button type="button" className="gcs-profileHeader__avatarZoom" data-gcs-viewer={user.image} aria-label={tViewer("avatar")} data-testid="gcs-profile-avatar-zoom">
            <GcsAvatar name={user.name} size="xl" userId={user.id} src={user.image} {...(user.frameKey ? { frame: user.frameKey } : {})} />
          </button>
        ) : (
          <GcsAvatar name={user.name} size="xl" userId={user.id} {...(user.frameKey ? { frame: user.frameKey } : {})} />
        )}
        <div className="gcs-profileHeader__identity">
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <GcsMemberName as="h1" userId={user.id} name={user.name} nameKey={user.nameKey} size="full" className="gcs-display" style={{ margin: 0, fontSize: 40, letterSpacing: ".02em" }} data-testid="gcs-profile-name" />
            {clans.tagOnName && clans.clans[0] && <GcsClanTag clan={clans.clans[0]} testId="gcs-profile-clan-tag" />}
            {profile.online.online && (
              <span style={{ fontSize: 13, color: "var(--gcs-ok)", display: "flex", alignItems: "center", gap: 6 }}>
                <span className="gcs-dot" style={{ background: "var(--gcs-ok)" }} />
                {t("online")}
                {profile.online.hidden && ` (${t("hiddenOnline")})`}
              </span>
            )}
          </div>
          {user.bio && <span style={{ color: "var(--gcs-muted)", fontSize: 14 }}>„{user.bio}”</span>}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {/* Banner-ul VIP înlocuiește pastila grupului când e același plan (fără dublură). */}
            {!(look?.banner && look.banner.label.trim().toLowerCase() === (shownGroup?.name ?? user.group.name).trim().toLowerCase()) && shownGroup && (
              <GcsGroupLink groupId={shownGroup.id} size="lg" variant="filled" data-testid="gcs-profile-group" />
            )}
            {secondaryGroups.map((g) => (
              <GcsGroupLink key={g.id} groupId={g.id} size="sm" data-testid="gcs-profile-secondary-group" />
            ))}
            {look?.banner && (
              <span className={`gcs-vipPill gcs-fx${look.banner.className ? ` ${look.banner.className}` : ""}`} style={look.banner.style} data-testid="gcs-profile-vip-banner">
                {look.banner.label}
              </span>
            )}
            {user.rank && (
              <span className="gcs-badge" style={{ background: "rgba(61,220,151,.14)", color: "#3DDC97" }} data-testid="gcs-profile-rank">
                {user.rank.icon?.startsWith("fa-") ? <GcsIcon name={user.rank.icon} /> : user.rank.icon ? `${user.rank.icon} ` : ""}
                {user.rank.name}
              </span>
            )}
            {profile.badges.slice(0, 3).map((b) => (
              <span key={b.key} className="gcs-badgePill" title={b.description || undefined}>
                <GcsBadgeArt badge={b} size={24} decorative />
                {b.name}
              </span>
            ))}
          </div>
          {clans.clans.length > 0 && (
            <ul className="gcs-profileClans" aria-label={t("clans")} data-testid="gcs-profile-clans">
              {clans.clans.map((c) => (
                <li key={c.id}>
                  {clans.badge ? (
                    <a className="gcs-profileClan" href={c.href} style={clanColors(c)} data-testid="gcs-profile-clan">
                      <GcsClanLogo clan={c} size="s" />
                      <GcsClanTag clan={c} size="sm" plain />
                      <strong>{c.name}</strong>
                      <span className="gcs-profileClan__role">{tr(c.role)}</span>
                    </a>
                  ) : (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }} data-testid="gcs-profile-clan">
                      <GcsClanTag clan={c} size="sm" />
                      <Link href={c.href}>{c.name}</Link>
                      <span className="gcs-profileClan__role">{tr(c.role)}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <GcsProfileActions
          userId={user.id}
          isFollowing={viewer.isFollowing}
          isIgnored={viewer.isIgnored}
          canFollow={viewer.canFollow}
          canMessage={viewer.canMessage}
          canIgnore={viewer.canIgnore}
          acpHref={viewer.canModerate ? `/admin/members/${user.id}` : null}
          labels={{
            follow: t("follow"),
            unfollow: t("unfollow"),
            message: t("message"),
            more: t("more"),
            ignore: t("ignore"),
            unignore: t("unignore"),
            editAcp: t("editAcp"),
          }}
        />
      </div>
      <dl className="gcs-profileStats">
        {[
          { value: format.number(stats.posts), label: t("stats.posts"), color: "var(--gcs-text)" },
          { value: `${stats.reputation > 0 ? "+" : ""}${format.number(stats.reputation)}`, label: t("stats.reputation"), color: stats.reputation >= 0 ? "var(--gcs-ok)" : "var(--gcs-accentInk)" },
          { value: format.number(stats.followers), label: t("stats.followers"), color: "var(--gcs-text)", testId: "gcs-profile-followers" },
          { value: String(new Date(stats.joinedAt).getFullYear()), label: t("stats.joined"), color: "var(--gcs-text)" },
          {
            value: profile.online.online ? t("now") : profile.online.lastActiveAt ? relative(profile.online.lastActiveAt) : "—",
            label: t("stats.lastActive"),
            color: profile.online.online ? "var(--gcs-ok)" : "var(--gcs-text)",
          },
        ].map((s) => (
          <div key={s.label}>
            <dd className="gcs-display" style={{ color: s.color }} data-testid={s.testId}>
              {s.value}
            </dd>
            <dt>{s.label}</dt>
          </div>
        ))}
        {look?.flair && (
          <div className="gcs-profileStats__flair" data-testid="gcs-profile-weapon">
            <dd className="gcs-display" title={look.flair.label}>
              <img src={look.flair.icon} alt="" />
              <span>{look.flair.label}</span>
            </dd>
            <dt>{t("stats.weapon")}</dt>
          </div>
        )}
      </dl>
      <nav aria-label={t("tabsLabel")} className="gcs-tabs" data-testid="gcs-profile-tabs">
        {tabs.map((k) => (
          <Link key={k.key} href={tabHref(k.key)} className={`gcs-tab${k.key === tab ? " gcs-tab--active" : ""}`} aria-current={k.key === tab ? "page" : undefined} data-tab={k.key}>
            <GcsIcon name={k.icon} className="gcs-tab__icon" />
            {k.label ?? tAll(k.labelKey)}
          </Link>
        ))}
      </nav>
    </section>
  );

  /** Un câmp de profil: eticheta și valoarea (un link, textul sau, la „Text lung”, HTML-ul sanitizat de server). */
  const fieldRow = (f: (typeof profile.fields)[number], linkText: string) =>
    f.html ? (
      <div key={f.key} className="gcs-profileField gcs-profileField--rich" data-testid="gcs-profile-rich-field">
        <span>{f.label}</span>
        <GcsNamedHtml className="gcs-postBody gcs-richText" html={f.html} />
      </div>
    ) : (
      <div key={f.key} className="gcs-profileField">
        <span>{f.label}</span>
        <span>
          {f.link ? (
            // Contact: linkul construit din handle-ul scris de membru.
            <a href={f.link} rel="nofollow ugc noopener" target="_blank" data-testid="gcs-profile-contact-link">
              {f.icon && <GcsIcon name={f.icon} className="gcs-hIcon" />}@{f.value}
            </a>
          ) : f.type === "URL" ? (
            <a href={f.value} rel="nofollow ugc noopener" target="_blank">
              {linkText}
            </a>
          ) : (
            f.value
          )}
        </span>
      </div>
    );

  // Câmpurile pe grupurile din ACP (De bază, Despre mine, Echipamentul meu, Descriere, Contact); cele din tabul Jocuri
  // fără grup rămân în caseta conturilor.
  const grouped = groupFields(
    fieldGroups,
    about.concat(games.filter((f) => f.groupId != null)),
    (s) => (s === "ABOUT" ? t("tabs.about") : t("tabs.games")),
  );
  const aboutCard = (
    <GcsCard as="section" className="gcs-titledBox gcs-profileGroups" style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="gcs-profile-about">
      <h2 className="gcs-display gcs-titleBand gcs-cardTitle">
        <GcsIcon name={TAB_ICONS.about} className="gcs-hIcon" />
        {t("tabs.about")}
      </h2>
      <div className="gcs-profileField">
        <span>{t("stats.joined")}</span>
        <span>{format.dateTime(new Date(stats.joinedAt), { dateStyle: "long" })}</span>
      </div>
      {birthday && (
        // Ziua de naștere publică: ziua și luna; anul doar dacă membrul a ales să-l arate.
        <div className="gcs-profileField" data-testid="gcs-profile-birthday">
          <span>{t("birthday")}</span>
          <span>{format.dateTime(birthday, { day: "numeric", month: "long", ...(birthdayYear ? { year: "numeric" } : {}), timeZone: "UTC" })}</span>
        </div>
      )}
      {grouped.length === 0 && (
        <span className="gcs-muted">
          <GcsIcon name="fa-regular fa-rectangle-list" className="gcs-emptyIcon" />
          {t("noFields")}
        </span>
      )}
      {grouped.map((g) => (
        <section key={g.group.key} className="gcs-profileGroup" aria-label={g.group.label} data-testid="gcs-profile-field-group" data-group={g.group.key}>
          <h3 className="gcs-profileGroup__title">
            {g.group.icon && <GcsIcon name={g.group.icon} className="gcs-hIcon" />}
            {g.group.label}
          </h3>
          {g.fields.map((f) => fieldRow(f, f.value.replace(/^https?:\/\//, "")))}
        </section>
      ))}
    </GcsCard>
  );

  const accountsCard = (
    <GcsCard as="section" className="gcs-titledBox" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 className="gcs-display gcs-titleBand gcs-cardTitle">
        <GcsIcon name={TAB_ICONS.games} className="gcs-hIcon" />
        {t("linkedAccounts")}
      </h2>
      {profile.accounts.length === 0 && gamesLoose.length === 0 && !game && (
        <span className="gcs-muted">
          <GcsIcon name="fa-solid fa-link-slash" className="gcs-emptyIcon" />
          {t("noAccounts")}
        </span>
      )}
      {profile.accounts.map((a) => (
        <div key={a.provider} className="gcs-linkedAccount">
          <span className="gcs-display gcs-linkedAccount__tag" style={{ background: a.provider === "discord" ? "#4752C4" : "#1B2838" }}>
            <GcsIcon name={a.provider === "discord" ? "fa-brands fa-discord" : "fa-brands fa-steam"} />
          </span>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 13 }}>
            <span style={{ fontWeight: 700 }}>{a.provider === "discord" ? "Discord" : "Steam"}</span>
            {a.url ? (
              <a href={a.url} rel="nofollow noopener" target="_blank" style={{ fontSize: 12 }}>
                {t("viewSteamProfile")}
              </a>
            ) : (
              <span className="gcs-muted" style={{ fontSize: 12 }}>
                {t("connected")}
              </span>
            )}
          </div>
        </div>
      ))}
      {gamesLoose.map((f) => fieldRow(f, f.value.replace(/^https?:\/\//, "")))}
      {game && (
        <Link href={playerHref({ id: game.player.id, name: game.player.name || game.player.value })} className="gcs-linkedAccount gcs-linkedAccount--player" data-testid="gcs-profile-player-link">
          <span className="gcs-display gcs-linkedAccount__tag gcs-linkedAccount__tag--game">
            <GcsIcon name="fa-solid fa-crosshairs" />
          </span>
          <span style={{ display: "flex", flexDirection: "column", fontSize: 13 }}>
            <span style={{ fontWeight: 700 }}>{t("game.playerProfile")}</span>
            <span className="gcs-muted" style={{ fontSize: 12 }}>
              {game.player.name || game.player.value}
            </span>
          </span>
        </Link>
      )}
    </GcsCard>
  );

  /** Caseta „Statistici pe servere” (tab-ul Jocuri): totalurile identității principale și legătura spre profilul ei. */
  const gameCard = game ? (
    <GcsCard as="section" className="gcs-titledBox" style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="gcs-profile-game-stats">
      <h2 className="gcs-display gcs-titleBand gcs-cardTitle">
        <GcsIcon name="fa-solid fa-crosshairs" className="gcs-hIcon" />
        {t("game.title")}
      </h2>
      <dl className="gcs-gameCard">
        {[
          [t("game.kd"), format.number(game.kd, { minimumFractionDigits: 2, maximumFractionDigits: 2 })],
          [t("game.kills"), format.number(game.kills)],
          [t("game.headshots"), game.headshotRate === null ? "—" : format.number(game.headshotRate, { style: "percent", maximumFractionDigits: 0 })],
          [t("game.playtime"), t("game.hours", { hours: format.number(Math.round(game.playtime / 3600)) })],
          [t("game.elo"), game.elo === null ? "—" : format.number(game.elo, { useGrouping: false })],
          [t("game.bestRank"), game.bestRank === null ? "—" : `#${game.bestRank}`],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="gcs-display">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="gcs-muted" style={{ margin: 0, fontSize: 13 }}>
        {game.lastSeenAt ? t("game.lastSeen", { time: relative(game.lastSeenAt) }) : t("game.neverSeen")}
        {game.identities > 1 && ` · ${t("game.identities", { count: game.identities })}`}
      </p>
      <Link href={playerHref({ id: game.player.id, name: game.player.name || game.player.value })} className="gcs-btn gcs-btn--ghost" style={{ alignSelf: "flex-start" }} data-testid="gcs-profile-game-link">
        <GcsIcon name="fa-solid fa-id-card" />
        {t("game.open")}
      </Link>
    </GcsCard>
  ) : null;

  /** Cerința unui badge blocat, ca text (zilele de vechime în ani, când se împart exact). */
  const requirement = (b: GcsLockedBadge) => {
    if (!b.requirement) return t("badgeReq.manual");
    const { trigger, threshold } = b.requirement;
    if (trigger === "MEMBER_DAYS" && threshold >= 365 && threshold % 365 === 0) return t("badgeReq.MEMBER_YEARS", { count: threshold / 365 });
    return trigger === "IS_VIP" ? t("badgeReq.IS_VIP") : t(`badgeReq.${trigger}`, { count: threshold });
  };

  /**
   * Coloana laterală: caseta realizărilor (reputația și nivelul, locul n/N, ultimele insigne, insigna automată „Sponsor”
   * din donații peste prag).
   */
  const ta = await getTranslations("profile.achievements");
  const badgesCompact = (
    <GcsCard as="section" className="gcs-titledBox gcs-achievements" style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="gcs-profile-achievements">
      <h2 className="gcs-display gcs-titleBand gcs-cardTitle">
        <GcsIcon name="fa-solid fa-medal" className="gcs-hIcon" />
        {ta("title")}
      </h2>
      {achievements && (
        <>
          <div className="gcs-achievements__head">
            <strong className={`gcs-display ${achievements.reputation >= 0 ? "gcs-rep--pos" : "gcs-rep--neg"}`} data-testid="gcs-achievements-reputation">
              {achievements.reputation > 0 ? "+" : ""}
              {format.number(achievements.reputation)}
            </strong>
            <span className="gcs-muted">{t("stats.reputation")}</span>
            <span className="gcs-achievements__level" data-testid="gcs-achievements-level">
              {achievements.level.rank ? ta("levelRank", { level: achievements.level.level, rank: achievements.level.rank }) : ta("level", { level: achievements.level.level })}
            </span>
          </div>
          <div className="gcs-xpBar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={achievements.level.percent} aria-label={achievements.level.next ? ta("next", { name: achievements.level.next.name }) : ta("max")}>
            <span style={{ width: `${achievements.level.percent}%` }} />
          </div>
          <p className="gcs-muted" style={{ margin: 0, fontSize: 13 }} data-testid="gcs-achievements-rank">
            {ta("rank", { position: format.number(achievements.rank.position), total: format.number(achievements.rank.total) })}
          </p>
          {achievements.sponsor && (
            <span className="gcs-sponsorBadge" data-testid="gcs-profile-sponsor">
              <GcsIcon name="fa-solid fa-hand-holding-heart" />
              {ta("sponsor")}
            </span>
          )}
        </>
      )}
      {profile.badges.length === 0 && (
        <span className="gcs-muted">
          <GcsIcon name="fa-regular fa-star" className="gcs-emptyIcon" />
          {t("noBadges")}
        </span>
      )}
      <ul className="gcs-badgeGrid gcs-badgeGrid--compact" data-testid="gcs-profile-badges">
        {(achievements?.badges ?? profile.badges.slice(0, 5)).map((b) => (
          <li key={b.key} className="gcs-badgeGrid__item" title={b.description || undefined}>
            <GcsBadgeArt badge={b} size={48} decorative />
            <span>{b.name}</span>
          </li>
        ))}
      </ul>
      {profile.badges.length > 0 && (
        <Link href={tabHref("badges")} className="gcs-achievements__all">
          {t("badgesCount", { count: profile.badges.length })}
          <span aria-hidden="true"> →</span>
        </Link>
      )}
    </GcsCard>
  );

  /** Celelalte grupuri ale membrului (pastilele secundare), urmăritorii (primii 8) și vizitatorii recenți. */
  const groupsCard =
    secondaryGroups.length > 0 ? (
      <GcsCard as="section" className="gcs-titledBox" style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid="gcs-profile-groups">
        <h2 className="gcs-display gcs-titleBand gcs-cardTitle">
          <GcsIcon name="fa-solid fa-users" className="gcs-hIcon" />
          {ta("groups")}
        </h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {secondaryGroups.map((g) => (
            <GcsGroupLink key={g.id} groupId={g.id} size="sm" />
          ))}
        </div>
      </GcsCard>
    ) : null;
  const followersCard =
    followerPreview && followerPreview.total > 0 ? (
      <GcsCard as="section" className="gcs-titledBox" style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid="gcs-profile-followers-box">
        <h2 className="gcs-display gcs-titleBand gcs-cardTitle">
          <GcsIcon name={TAB_ICONS.followers} className="gcs-hIcon" />
          {t("followersCount", { count: followerPreview.total })}
        </h2>
        <ul className="gcs-avatarRow">
          {followerPreview.users.slice(0, 8).map((u) => (
            <li key={u.id}>
              <GcsAvatar name={u.name} size="m" userId={u.id} {...(u.image ? { src: u.image } : {})} />
              <GcsMemberName userId={u.id} name={u.name} nameKey={u.nameKey} href={memberHref(u)} className="gcs-avatarRow__name" />
            </li>
          ))}
        </ul>
        <Link href={tabHref("followers")} className="gcs-achievements__all">
          {ta("allFollowers")}
          <span aria-hidden="true"> →</span>
        </Link>
      </GcsCard>
    ) : null;
  const visitorsCard =
    visitors !== null ? (
      <GcsCard as="section" className="gcs-titledBox" style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid="gcs-profile-visitors">
        <h2 className="gcs-display gcs-titleBand gcs-cardTitle">
          <GcsIcon name="fa-solid fa-shoe-prints" className="gcs-hIcon" />
          {ta("visitors")}
        </h2>
        {visitors.length === 0 && <span className="gcs-muted">{ta("noVisitors")}</span>}
        <ul className="gcs-visitorList">
          {visitors.map((v) => {
            const u = visitorUsers.get(v.id);
            if (!u) return null;
            return (
              <li key={v.id} data-testid="gcs-profile-visitor">
                <GcsAvatar name={u.name} size="s" userId={u.id} {...(u.image ? { src: u.image } : {})} />
                <GcsMemberName userId={u.id} name={u.name} nameKey={u.nameKey} href={memberHref(u)} />
                <span className="gcs-muted">{relative(v.at)}</span>
              </li>
            );
          })}
        </ul>
        {viewer.isSelf && (
          <Link href="/settings/privacy" className="gcs-achievements__all">
            <GcsIcon name="fa-solid fa-user-shield" className="gcs-hIcon" />
            {ta("visitorsPrivacy")}
          </Link>
        )}
      </GcsCard>
    ) : null;

  let main: React.ReactNode = null;
  if (tab === "activity") {
    const activity = await services().profileQueries.activity(actor, user.id, query.before ? { before: query.before } : {});
    main = (
      <GcsCard as="section" style={{ overflow: "hidden" }}>
        <h2 className="gcs-display gcs-titleBand gcs-cardTitle">
          <GcsIcon name={TAB_ICONS.activity} className="gcs-hIcon" />
          {t("recentActivity")}
        </h2>
        {activity.items.length === 0 && (
          <p className="gcs-muted" style={{ padding: "16px 20px", margin: 0 }}>
            <GcsIcon name="fa-regular fa-clock" className="gcs-emptyIcon" />
            {t("noActivity")}
          </p>
        )}
        <ul className="gcs-activity" data-testid="gcs-profile-activity">
          {activity.items.map((item) => (
            <li key={item.kind === "badge" ? `b-${item.badge.key}` : `p-${item.postId}`} className="gcs-activity__item">
              {item.kind === "badge" ? (
                <>
                  <GcsBadgeArt badge={item.badge} size={24} decorative />
                  <div className="gcs-activity__text">
                    <span>
                      <span className="gcs-muted">{t("activity.badge")}</span> <strong>{item.badge.name}</strong>
                    </span>
                    <span className="gcs-activity__time">{relative(item.at)}</span>
                  </div>
                </>
              ) : (
                <>
                  <span className={`gcs-activity__icon gcs-activity__icon--${item.kind}`} aria-hidden="true">
                    <GcsIcon name={item.kind === "topic" ? "fa-solid fa-plus" : "fa-solid fa-pen"} />
                  </span>
                  <div className="gcs-activity__text">
                    <span>
                      <span className="gcs-muted">{t(`activity.${item.kind}`)}</span>{" "}
                      <Link href={item.kind === "topic" ? topicHref({ id: item.topicId, slug: item.topicSlug }) : `/topic/${item.topicId}/post/${item.postId}`} style={{ fontWeight: 700 }}>
                        {item.topicTitle}
                      </Link>
                    </span>
                    {item.snippet && <span className="gcs-activity__snippet">{item.snippet}</span>}
                    <span className="gcs-activity__time">{relative(item.at)}</span>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
        {activity.next && (
          <div style={{ padding: "12px 20px" }}>
            <Link href={`${tabHref("activity")}?before=${encodeURIComponent(activity.next)}`}>
              <GcsIcon name="fa-solid fa-clock-rotate-left" className="gcs-hIcon" />
              {t("older")}
            </Link>
          </div>
        )}
      </GcsCard>
    );
  } else if (tab === "about") {
    const wall = await services().profileQueries.wall(actor, user.id, pageParam(query.page));
    const wallLabels = { placeholder: t("wall.placeholder", { name: user.name }), post: t("wall.post"), reply: t("wall.reply") };
    const itemLabels = {
      hide: t("wall.hide"),
      restore: t("wall.restore"),
      delete: t("wall.delete"),
      report: t("wall.report"),
      reportReason: t("wall.reportReason"),
      confirmDelete: t("wall.confirmDelete"),
    };
    main = (
      <>
        {viewer.canPostWall && (
          <GcsCard as="section" style={{ padding: "16px 18px" }}>
            <GcsWallComposer profileUserId={user.id} labels={wallLabels} />
          </GcsCard>
        )}
        <GcsCard as="section" style={{ overflow: "hidden" }}>
          <h2 className="gcs-display gcs-titleBand gcs-cardTitle">
            <GcsIcon name="fa-solid fa-comments" className="gcs-hIcon" />
            {t("wall.title")}
          </h2>
          {wall?.items.length === 0 && (
            <p className="gcs-muted" style={{ padding: "16px 20px", margin: 0 }}>
              <GcsIcon name="fa-regular fa-comment-dots" className="gcs-emptyIcon" />
              {t("wall.empty")}
            </p>
          )}
          <ul className="gcs-wall" data-testid="gcs-wall">
            {wall?.items.map((s) => (
              <li key={s.id} className={`gcs-wallItem${s.visibility !== "VISIBLE" ? " gcs-wallItem--hidden" : ""}`} data-testid="gcs-wall-item">
                <WallEntry entry={s} />
                {translate && s.visibility === "VISIBLE" && s.author?.id !== actor.userId && <GcsTranslateButton contentType="profile.status" contentId={s.id} labels={translate} />}
                <GcsWallItemActions statusId={s.id} hidden={s.visibility !== "VISIBLE"} canManage={s.canManage} canModerate={viewer.canModerate} canReport={actor.userId !== null && s.author?.id !== actor.userId} labels={itemLabels} />
                {s.replies.length > 0 && (
                  <ul className="gcs-wall gcs-wall--replies">
                    {s.replies.map((r) => (
                      <li key={r.id} className={`gcs-wallItem${r.visibility !== "VISIBLE" ? " gcs-wallItem--hidden" : ""}`}>
                        <WallEntry entry={r} />
                        <GcsWallItemActions statusId={r.id} hidden={r.visibility !== "VISIBLE"} canManage={r.canManage} canModerate={viewer.canModerate} canReport={actor.userId !== null && r.author?.id !== actor.userId} labels={itemLabels} />
                      </li>
                    ))}
                  </ul>
                )}
                {viewer.canPostWall && s.visibility === "VISIBLE" && <GcsWallComposer profileUserId={user.id} parentId={s.id} labels={wallLabels} compact />}
              </li>
            ))}
          </ul>
        </GcsCard>
      </>
    );
  } else if (tab === "games") {
    main = (
      <>
        {gameCard}
        {accountsCard}
      </>
    );
  } else if (tab === "steam") {
    // Tabul Steam: datele aduse de worker (o cerere nouă dacă sunt vechi); până atunci, un mesaj de așteptare.
    const entry = await services().externalProfiles.steam(user.id);
    main = <GcsSteamTab entry={entry} pending />;
  } else if (tab === "faceit") {
    const entry = await services().externalProfiles.faceit(user.id);
    main = entry ? <GcsFaceitTab entry={entry} /> : null;
  } else if (tab === "articles") {
    const tt = await getTranslations("profile.articles");
    const topics = await services().profileQueries.topics(actor, user.id, pageParam(query.page));
    main = (
      <GcsCard as="section" style={{ overflow: "hidden" }} data-testid="gcs-profile-articles">
        <h2 className="gcs-display gcs-titleBand gcs-cardTitle">
          <GcsIcon name={TAB_ICONS.articles} className="gcs-hIcon" />
          {tt("title", { count: topics?.total ?? 0 })}
        </h2>
        {topics?.items.length === 0 && (
          <p className="gcs-muted" style={{ padding: "16px 20px", margin: 0 }}>
            <GcsIcon name="fa-regular fa-newspaper" className="gcs-emptyIcon" />
            {tt("empty")}
          </p>
        )}
        <ul className="gcs-articleList">
          {topics?.items.map((a) => (
            <li key={a.id} className="gcs-articleList__item" data-testid="gcs-profile-article">
              <Link href={topicHref({ id: a.id, slug: a.slug })} className="gcs-articleList__title">
                {a.title}
              </Link>
              {a.snippet && <p className="gcs-articleList__snippet">{a.snippet}</p>}
              <span className="gcs-muted gcs-articleList__meta">
                {a.forum} · {relative(a.createdAt)} · {tt("replies", { count: a.replies })} · {tt("views", { count: a.views })}
              </span>
            </li>
          ))}
        </ul>
        {topics && topics.pages > 1 && (
          <nav className="gcs-articleList__pages" aria-label={tt("pages")}>
            {Array.from({ length: topics.pages }, (_, i) => i + 1).map((p) => (
              <Link key={p} href={`${tabHref("articles")}${tabHref("articles").includes("?") ? "&" : "?"}page=${p}`} className={`gcs-pagination__link${p === pageParam(query.page) ? " gcs-pagination__link--active" : ""}`} aria-current={p === pageParam(query.page) ? "page" : undefined}>
                {p}
              </Link>
            ))}
          </nav>
        )}
      </GcsCard>
    );
  } else if (tabs.find((x) => x.key === tab)?.panel) {
    // Membri v2: un tab adus de o aplicație sau de un plugin prin punctul de extensie al panourilor de membru.
    const p = (await memberPanels("profile", actor)).find((x) => x.key === tab)!;
    main = (
      <GcsCard as="section" className="gcs-titledBox" style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid={`gcs-profile-panel-${p.key}`}>
        <h2 className="gcs-display gcs-titleBand gcs-cardTitle">
          <GcsIcon name={p.icon} className="gcs-hIcon" />
          {p.label}
        </h2>
        <GcsMemberPanelBody panel={p} userId={user.id} surface="profile" viewer={actor} />
      </GcsCard>
    );
  } else if (tab === "skins") {
    // Skin-urile (aplicația Servere): deocamdată un tab-ciornă, până vine inventarul din pluginul serverelor.
    const ts = await getTranslations("profile.skins");
    main = (
      <GcsCard as="section" className="gcs-titledBox" style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="gcs-profile-skins">
        <h2 className="gcs-display gcs-titleBand gcs-cardTitle">
          <GcsIcon name={TAB_ICONS.skins} className="gcs-hIcon" />
          {ts("title")}
        </h2>
        <p className="gcs-muted" style={{ margin: 0 }}>
          <GcsIcon name="fa-solid fa-person-digging" className="gcs-emptyIcon" />
          {ts("soon")}
        </p>
      </GcsCard>
    );
  } else if (tab === "followers") {
    const followers = await services().profileQueries.followers(actor, user.id, pageParam(query.page));
    main = (
      <GcsCard as="section" className="gcs-titledBox" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 className="gcs-display gcs-titleBand gcs-cardTitle">
          <GcsIcon name={TAB_ICONS.followers} className="gcs-hIcon" />
          {t("followersCount", { count: followers?.total ?? 0 })}
        </h2>
        {followers?.users.length === 0 && (
          <span className="gcs-muted">
            <GcsIcon name="fa-solid fa-user-group" className="gcs-emptyIcon" />
            {t("noFollowers")}
          </span>
        )}
        <ul className="gcs-userGrid" data-testid="gcs-profile-followers-list">
          {followers?.users.map((u) => (
            <li key={u.id}>
              <GcsAvatar name={u.name} size="m" {...(u.image ? { src: u.image } : {})} {...(u.frameKey ? { frame: u.frameKey } : {})} />
              <GcsMemberName userId={u.id} name={u.name} nameKey={u.nameKey} href={memberHref(u)} />
            </li>
          ))}
        </ul>
      </GcsCard>
    );
  } else if (tab === "badges") {
    const showcase = (await services().profileQueries.badgeShowcase(actor, user.id)) ?? { earned: profile.badges, locked: [] };
    main = (
      <GcsCard as="section" className="gcs-titledBox" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 className="gcs-display gcs-titleBand gcs-cardTitle">
          <GcsIcon name={TAB_ICONS.badges} className="gcs-hIcon" />
          {t("badgesCount", { count: showcase.earned.length })}
        </h2>
        {showcase.earned.length === 0 && (
          <span className="gcs-muted">
            <GcsIcon name="fa-regular fa-star" className="gcs-emptyIcon" />
            {t("noBadges")}
          </span>
        )}
        <ul className="gcs-badgeGrid" data-testid="gcs-profile-badges">
          {showcase.earned.map((b) => (
            <li key={b.key} className="gcs-badgeGrid__item">
              <GcsBadgeArt badge={b} size={64} decorative />
              <strong className="gcs-badgeGrid__name">{b.name}</strong>
              {b.description && <span className="gcs-badgeGrid__desc">{b.description}</span>}
              <span className="gcs-badgeGrid__date">{t("badgeEarned", { date: format.dateTime(new Date(b.awardedAt), { dateStyle: "medium" }) })}</span>
            </li>
          ))}
        </ul>
        {showcase.locked.length > 0 && (
          <>
            <h3 className="gcs-badgeGrid__section">{t("badgesLocked", { count: showcase.locked.length })}</h3>
            <ul className="gcs-badgeGrid" data-testid="gcs-profile-badges-locked">
              {showcase.locked.map((b) => (
                <li key={b.key} className="gcs-badgeGrid__item gcs-badgeGrid__item--locked">
                  <GcsBadgeArt badge={b} size={64} locked decorative />
                  <span className="gcs-badgeGrid__lock" aria-hidden="true">
                    <GcsIcon name="fa-solid fa-lock" />
                  </span>
                  <strong className="gcs-badgeGrid__name">
                    {b.name}
                    <span className="gcs-srOnly"> ({t("badgeLocked")})</span>
                  </strong>
                  {b.description && <span className="gcs-badgeGrid__desc">{b.description}</span>}
                  <span className="gcs-badgeGrid__req">{requirement(b)}</span>
                  {b.progress && (
                    <>
                      <div
                        className="gcs-badgeGrid__progress"
                        role="progressbar"
                        aria-label={requirement(b)}
                        aria-valuemin={0}
                        aria-valuemax={b.progress.target}
                        aria-valuenow={b.progress.current}
                      >
                        <span style={{ width: `${Math.round((b.progress.current / b.progress.target) * 100)}%` }} />
                      </div>
                      <span className="gcs-badgeGrid__req">{t("badgeProgress", { current: format.number(b.progress.current), target: format.number(b.progress.target) })}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </GcsCard>
    );
  } else if (tab === "warnings" && viewer.canSeeWarnings) {
    const [warnings, tw] = await Promise.all([services().profileQueries.warnings(actor, user.id).then((r) => r ?? []), getTranslations("warningsPage")]);
    main = (
      <GcsCard as="section" className="gcs-titledBox" style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="gcs-profile-warnings">
        <h2 className="gcs-display gcs-titleBand gcs-cardTitle">
          <GcsIcon name={TAB_ICONS.warnings} className="gcs-hIcon" />
          {t("tabs.warnings")}
        </h2>
        {viewer.isSelf && warnings.length > 0 && (
          <Link href="/warnings" className="gcs-muted">
            {tw("title")} →
          </Link>
        )}
        {warnings.length === 0 && (
          <span className="gcs-muted">
            <GcsIcon name="fa-regular fa-circle-check" className="gcs-emptyIcon" />
            {t("noWarnings")}
          </span>
        )}
        {warnings.map((w) => (
          <div key={w.id} className="gcs-profileField">
            <span>
              {w.reason}
              {w.issuedBy ? (
                <>
                  {" · "}
                  <GcsMemberLink user={w.issuedBy} />
                </>
              ) : (
                ""
              )}
            </span>
            <span>
              {t("warningPoints", { count: w.points })} · {format.dateTime(w.createdAt, { dateStyle: "medium" })}
              {w.revokedAt ? ` · ${tw("state.revoked")}` : w.expiresAt && w.expiresAt <= new Date() ? ` · ${tw("state.expired")}` : ""}
            </span>
          </div>
        ))}
      </GcsCard>
    );
  }

  // Banda „pe servere” (aplicația Servere): un tab pe server cu locul, uciderile, decesele, K/D, punctele și clasamentul.
  const tsv = await getTranslations("profile.servers");
  const serverStrip =
    serverStats.length > 0 ? (
      <GcsServerStatsStrip
        items={serverStats.map((s) => ({
          serverId: s.serverId,
          server: s.server,
          place: s.place === null ? "—" : `#${format.number(s.place)}`,
          kills: format.number(s.kills),
          deaths: format.number(s.deaths),
          kd: format.number(s.kd, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          points: format.number(s.points),
          rankingHref: `/servers/leaderboard?server=${s.serverId}`,
        }))}
        labels={{ title: tsv("title"), place: tsv("place"), kills: tsv("kills"), deaths: tsv("deaths"), kd: tsv("kd"), points: tsv("points"), ranking: tsv("ranking") }}
      />
    ) : null;

  const vipQuote = look?.profile.quote ? (
    <figure className="gcs-card gcs-vipQuote" data-testid="gcs-profile-quote">
      <GcsIcon name="fa-solid fa-quote-left" className="gcs-vipQuote__icon" />
      <blockquote>{look.profile.quote}</blockquote>
      <figcaption>
        — <GcsMemberName userId={user.id} name={user.name} nameKey={user.nameKey} />
      </figcaption>
    </figure>
  ) : null;
  const vipSong =
    look?.profile.song && tv ? (
      <GcsProfileSong song={look.profile.song} labels={{ title: tv("song"), play: tv("play"), pause: tv("pause"), unmute: tv("unmute"), youtube: tv("youtube") }} />
    ) : null;

  return (
    // Tema profilului: doar variabile CSS (accent, panouri) peste pagina existentă; `display: contents` nu schimbă layout-ul.
    <div className="gcs-vipTheme" style={{ display: "contents", ...(look?.profile.theme ?? {}) }} {...(look?.profile.theme ? { "data-vip": "theme" } : {})}>
      {look?.profile.background && tv && (
        <GcsProfileBackdrop {...look.profile.background} labels={{ pause: tv("bgPause"), play: tv("bgPlay") }} />
      )}
      {header}
      {serverStrip}
      <div className="gcs-profileColumns" style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
        <aside style={{ flex: "1 1 340px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
          {vipSong}
          {tab !== "badges" && badgesCompact}
          {aboutCard}
          {tab !== "games" && accountsCard}
          {groupsCard}
          {/* Membri v2: cardurile aduse de aplicații / pluginuri (ex. ELO-ul mix, clanul), doar cu aplicația pornită. */}
          {(await memberPanels("profile", actor))
            .filter((p) => p.kind === "card")
            .map((p) => (
              <GcsProfilePanelCard key={p.key} panel={p} userId={user.id} viewer={actor} />
            ))}
          {tab !== "followers" && followersCard}
          {visitorsCard}
        </aside>
        <div style={{ flex: "999 1 640px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
          {vipQuote}
          {main}
        </div>
      </div>
    </div>
  );

  /** Un status sau un răspuns: autorul, data și conținutul. */
  function WallEntry({ entry }: { entry: { author: GcsProfileView["user"] | null | { id: string; name: string; image: string | null; nameKey: string; frameKey: string | null }; html: string; createdAt: string; visibility: string } }) {
    const a = entry.author;
    return (
      <div className="gcs-wallItem__body">
        {a ? <GcsAvatar name={a.name} size="m" {...(a.image ? { src: a.image } : {})} {...(a.frameKey ? { frame: a.frameKey } : {})} /> : <span className="gcs-avatar gcs-avatar--m" />}
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13 }}>
            {a ? <GcsMemberName userId={a.id} name={a.name} nameKey={a.nameKey} href={`/members/${a.id}-${slugify(a.name)}`} /> : <GcsDeletedMember />}{" "}
            <span className="gcs-muted">· {relative(entry.createdAt)}</span>
            {entry.visibility !== "VISIBLE" && <span className="gcs-muted"> · {t("wall.hidden")}</span>}
          </span>
          <GcsNamedHtml className="gcs-postBody" html={entry.html} />
        </div>
      </div>
    );
  }
}
