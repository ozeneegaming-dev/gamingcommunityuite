import type { GcsLockedBadge, GcsProfileView } from "@gcs/modules";
import { parseUserRef, slugify } from "@gcs/modules/slug";
import { GcsAvatar, GcsBadgeArt, GcsCard, GcsUserLink } from "@gcs/ui";
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
import { GcsProfileActions } from "../../_components/profile/GcsProfileActions";
import { GcsProfileBackdrop, GcsProfileSong } from "../../_components/profile/GcsProfileVip";
import { GcsWallComposer, GcsWallItemActions } from "../../_components/profile/GcsWall";
import { GcsTranslateButton } from "../../_components/GcsTranslateButton";
import { translateLabels } from "@/lib/translate";

const TABS = ["activity", "about", "games", "followers", "badges", "warnings"] as const;
type Tab = (typeof TABS)[number];

/** Iconițele taburilor profilului (și ale titlurilor secțiunilor lor). */
const TAB_ICONS: Record<Tab, string> = {
  activity: "fa-solid fa-chart-line",
  about: "fa-solid fa-circle-info",
  games: "fa-solid fa-gamepad",
  followers: "fa-solid fa-user-group",
  badges: "fa-solid fa-award",
  warnings: "fa-solid fa-triangle-exclamation",
};

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
  return {
    title: user.name,
    alternates: { canonical: url },
    openGraph: { title: user.name, url, ...(user.image ? { images: [user.image] } : {}), ...(user.bio ? { description: user.bio } : {}) },
    // Profilurile fără conținut public nu ajung în motoarele de căutare.
    ...(stats.posts === 0 ? { robots: { index: false } } : {}),
  };
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
  const tab: Tab = TABS.includes(query.tab as Tab) && (query.tab !== "warnings" || viewer.canSeeWarnings) ? (query.tab as Tab) : "activity";
  if (parsed.slug !== user.slug) permanentRedirect(`/members/${user.id}-${user.slug}${tab !== "activity" ? `?tab=${tab}` : ""}`);

  const t = await getTranslations("profile");
  const format = await getFormatter();
  const tabHref = (k: Tab) => `/members/${user.id}-${user.slug}${k === "activity" ? "" : `?tab=${k}`}`;
  const relative = (iso: string) => format.relativeTime(new Date(iso));
  const accent = user.accentColor ?? "#D62839";
  const about = profile.fields.filter((f) => f.section === "ABOUT");
  const games = profile.fields.filter((f) => f.section === "GAMES");
  // Aspectul publicat de pluginuri (Studio VIP): doar adăugiri în locurile existente ale profilului (fundal, rama,
  // pastila banner-ului, arma în statistici, citatul și melodia), iar tema prin variabile CSS.
  const look = await memberLook(user.id);
  const tv = look ? await getTranslations("profile.vip") : null;

  const header = (
    <section className="gcs-card gcs-profileHeader" style={{ borderColor: tint(accent, 0.45) }} data-testid="gcs-profile">
      <div
        className="gcs-profileHeader__cover"
        data-testid="gcs-profile-cover"
        style={{
          background: user.cover
            ? `center ${user.cover.positionY}% / cover no-repeat url(${user.cover.url})`
            : `radial-gradient(circle at 20% 30%, ${tint(accent, 0.55)}, transparent 45%), linear-gradient(120deg, #1B1033, ${tint(accent, 0.25)} 40%, #0F2236)`,
        }}
      />
      <div className="gcs-profileHeader__main">
        <GcsAvatar name={user.name} size="xl" userId={user.id} {...(user.image ? { src: user.image } : {})} {...(user.frameKey ? { frame: user.frameKey } : {})} />
        <div className="gcs-profileHeader__identity">
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1 className={`gcs-display gcs-name--${user.nameKey}`} style={{ margin: 0, fontSize: 40, letterSpacing: ".02em" }} data-testid="gcs-profile-name" data-name-user={user.id} data-text={user.name}>
              {user.name}
            </h1>
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
            {!(look?.banner && look.banner.label.trim().toLowerCase() === user.group.name.trim().toLowerCase()) && (
              <span className="gcs-badge" style={{ background: tint(user.group.color, 0.16), color: user.group.color ?? "var(--gcs-muted)" }}>
                {user.group.name}
              </span>
            )}
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
      <nav aria-label={t("tabsLabel")} className="gcs-tabs">
        {TABS.filter((k) => k !== "warnings" || viewer.canSeeWarnings).map((k) => (
          <Link key={k} href={tabHref(k)} className={`gcs-tab${k === tab ? " gcs-tab--active" : ""}`} aria-current={k === tab ? "page" : undefined}>
            <GcsIcon name={TAB_ICONS[k]} className="gcs-tab__icon" />
            {t(`tabs.${k}`)}
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
        <div className="gcs-postBody gcs-richText" dangerouslySetInnerHTML={{ __html: f.html }} />
      </div>
    ) : (
      <div key={f.key} className="gcs-profileField">
        <span>{f.label}</span>
        <span>
          {f.type === "URL" ? (
            <a href={f.value} rel="nofollow ugc noopener" target="_blank">
              {linkText}
            </a>
          ) : (
            f.value
          )}
        </span>
      </div>
    );

  const aboutCard = (
    <GcsCard as="section" className="gcs-titledBox" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 className="gcs-display gcs-titleBand gcs-cardTitle">
        <GcsIcon name={TAB_ICONS.about} className="gcs-hIcon" />
        {t("tabs.about")}
      </h2>
      {about.length === 0 && (
        <span className="gcs-muted">
          <GcsIcon name="fa-regular fa-rectangle-list" className="gcs-emptyIcon" />
          {t("noFields")}
        </span>
      )}
      {about.map((f) => fieldRow(f, f.value))}
      <div className="gcs-profileField">
        <span>{t("stats.joined")}</span>
        <span>{format.dateTime(new Date(stats.joinedAt), { dateStyle: "long" })}</span>
      </div>
    </GcsCard>
  );

  const accountsCard = (
    <GcsCard as="section" className="gcs-titledBox" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 className="gcs-display gcs-titleBand gcs-cardTitle">
        <GcsIcon name={TAB_ICONS.games} className="gcs-hIcon" />
        {t("linkedAccounts")}
      </h2>
      {profile.accounts.length === 0 && games.length === 0 && (
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
      {games.map((f) => fieldRow(f, f.value.replace(/^https?:\/\//, "")))}
    </GcsCard>
  );

  /** Cerința unui badge blocat, ca text (zilele de vechime în ani, când se împart exact). */
  const requirement = (b: GcsLockedBadge) => {
    if (!b.requirement) return t("badgeReq.manual");
    const { trigger, threshold } = b.requirement;
    if (trigger === "MEMBER_DAYS" && threshold >= 365 && threshold % 365 === 0) return t("badgeReq.MEMBER_YEARS", { count: threshold / 365 });
    return trigger === "IS_VIP" ? t("badgeReq.IS_VIP") : t(`badgeReq.${trigger}`, { count: threshold });
  };

  /** Coloana laterală: primele 6 insigne (48 px) cu numele. */
  const badgesCompact = (
    <GcsCard as="section" className="gcs-titledBox" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 className="gcs-display gcs-titleBand gcs-cardTitle">
        <GcsIcon name={TAB_ICONS.badges} className="gcs-hIcon" />
        {t("badgesCount", { count: profile.badges.length })}
      </h2>
      {profile.badges.length === 0 && (
        <span className="gcs-muted">
          <GcsIcon name="fa-regular fa-star" className="gcs-emptyIcon" />
          {t("noBadges")}
        </span>
      )}
      <ul className="gcs-badgeGrid gcs-badgeGrid--compact" data-testid="gcs-profile-badges">
        {profile.badges.slice(0, 6).map((b) => (
          <li key={b.key} className="gcs-badgeGrid__item" title={b.description || undefined}>
            <GcsBadgeArt badge={b} size={48} decorative />
            <span>{b.name}</span>
          </li>
        ))}
      </ul>
    </GcsCard>
  );

  let main: React.ReactNode;
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
    main = accountsCard;
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
              <GcsUserLink userId={u.id} name={u.name} nameKey={u.nameKey} href={memberHref(u)} />
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
  } else {
    const warnings = (await services().profileQueries.warnings(actor, user.id)) ?? [];
    main = (
      <GcsCard as="section" className="gcs-titledBox" style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="gcs-profile-warnings">
        <h2 className="gcs-display gcs-titleBand gcs-cardTitle">
          <GcsIcon name={TAB_ICONS.warnings} className="gcs-hIcon" />
          {t("tabs.warnings")}
        </h2>
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
              {w.issuedBy ? ` · ${w.issuedBy.name}` : ""}
            </span>
            <span>
              {t("warningPoints", { count: w.points })} · {format.dateTime(w.createdAt, { dateStyle: "medium" })}
            </span>
          </div>
        ))}
      </GcsCard>
    );
  }

  const vipQuote = look?.profile.quote ? (
    <figure className="gcs-card gcs-vipQuote" data-testid="gcs-profile-quote">
      <GcsIcon name="fa-solid fa-quote-left" className="gcs-vipQuote__icon" />
      <blockquote>{look.profile.quote}</blockquote>
      <figcaption>— {user.name}</figcaption>
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
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
        <aside style={{ flex: "1 1 340px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
          {vipSong}
          {aboutCard}
          {tab !== "games" && accountsCard}
          {tab !== "badges" && badgesCompact}
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
            {a ? <GcsUserLink userId={a.id} name={a.name} nameKey={a.nameKey} href={`/members/${a.id}-${slugify(a.name)}`} /> : "—"}{" "}
            <span className="gcs-muted">· {relative(entry.createdAt)}</span>
            {entry.visibility !== "VISIBLE" && <span className="gcs-muted"> · {t("wall.hidden")}</span>}
          </span>
          <div className="gcs-postBody" dangerouslySetInnerHTML={{ __html: entry.html }} />
        </div>
      </div>
    );
  }
}
