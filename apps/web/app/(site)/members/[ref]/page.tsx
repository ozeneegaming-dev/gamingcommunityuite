import type { GcsProfileView } from "@gcs/modules";
import { parseUserRef, slugify } from "@gcs/modules/slug";
import { GcsAvatar, GcsCard, GcsProfileBadge, GcsUserLink } from "@gcs/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { cache } from "react";
import { currentActor } from "@/lib/actor";
import { memberHref, tint, topicHref } from "@/lib/forum-urls";
import { pageParam } from "@/lib/forum-page";
import { services } from "@/lib/services";
import { GcsProfileActions } from "../../_components/profile/GcsProfileActions";
import { GcsWallComposer, GcsWallItemActions } from "../../_components/profile/GcsWall";
import { GcsTranslateButton } from "../../_components/GcsTranslateButton";
import { translateLabels } from "@/lib/translate";

const TABS = ["activity", "about", "games", "followers", "badges", "warnings"] as const;
type Tab = (typeof TABS)[number];

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

const sectionTitle = { margin: 0, fontSize: 15, letterSpacing: ".08em", textTransform: "uppercase" } as const;

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
        <GcsAvatar name={user.name} size="xl" {...(user.image ? { src: user.image } : {})} {...(user.frameKey ? { frame: user.frameKey } : {})} />
        <div className="gcs-profileHeader__identity">
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1 className={`gcs-display gcs-name--${user.nameKey}`} style={{ margin: 0, fontSize: 40, letterSpacing: ".02em" }} data-testid="gcs-profile-name">
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
            <span className="gcs-badge" style={{ background: tint(user.group.color, 0.16), color: user.group.color ?? "var(--gcs-muted)" }}>
              {user.group.name}
            </span>
            {user.rank && (
              <span className="gcs-badge" style={{ background: "rgba(61,220,151,.14)", color: "#3DDC97" }} data-testid="gcs-profile-rank">
                {user.rank.icon ? `${user.rank.icon} ` : ""}
                {user.rank.name}
              </span>
            )}
            {profile.badges.slice(0, 3).map((b) => (
              <span key={b.key} className="gcs-badge" style={{ background: tint(b.color, 0.14), color: b.color }}>
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
      </dl>
      <nav aria-label={t("tabsLabel")} className="gcs-tabs">
        {TABS.filter((k) => k !== "warnings" || viewer.canSeeWarnings).map((k) => (
          <Link key={k} href={tabHref(k)} className={`gcs-tab${k === tab ? " gcs-tab--active" : ""}`} aria-current={k === tab ? "page" : undefined}>
            {t(`tabs.${k}`)}
          </Link>
        ))}
      </nav>
    </section>
  );

  const aboutCard = (
    <GcsCard as="section" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 className="gcs-display" style={sectionTitle}>
        {t("tabs.about")}
      </h2>
      {about.length === 0 && <span className="gcs-muted">{t("noFields")}</span>}
      {about.map((f) => (
        <div key={f.key} className="gcs-profileField">
          <span>{f.label}</span>
          <span>{f.type === "URL" ? <a href={f.value} rel="nofollow ugc noopener" target="_blank">{f.value}</a> : f.value}</span>
        </div>
      ))}
      <div className="gcs-profileField">
        <span>{t("stats.joined")}</span>
        <span>{format.dateTime(new Date(stats.joinedAt), { dateStyle: "long" })}</span>
      </div>
    </GcsCard>
  );

  const accountsCard = (
    <GcsCard as="section" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
      <h2 className="gcs-display" style={sectionTitle}>
        {t("linkedAccounts")}
      </h2>
      {profile.accounts.length === 0 && games.length === 0 && <span className="gcs-muted">{t("noAccounts")}</span>}
      {profile.accounts.map((a) => (
        <div key={a.provider} className="gcs-linkedAccount">
          <span className="gcs-display gcs-linkedAccount__tag" style={{ background: a.provider === "discord" ? "#4752C4" : "#1B2838" }}>
            {a.provider === "discord" ? "DC" : "ST"}
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
      {games.map((f) => (
        <div key={f.key} className="gcs-profileField">
          <span>{f.label}</span>
          <span>{f.type === "URL" ? <a href={f.value} rel="nofollow ugc noopener" target="_blank">{f.value.replace(/^https?:\/\//, "")}</a> : f.value}</span>
        </div>
      ))}
    </GcsCard>
  );

  const badgesGrid = (all: boolean) => (
    <GcsCard as="section" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 className="gcs-display" style={sectionTitle}>
        {t("badgesCount", { count: profile.badges.length })}
      </h2>
      {profile.badges.length === 0 && <span className="gcs-muted">{t("noBadges")}</span>}
      <div className="gcs-badgeGrid" data-testid="gcs-profile-badges">
        {(all ? profile.badges : profile.badges.slice(0, 6)).map((b) => (
          <div key={b.key} className="gcs-badgeGrid__item" title={all ? format.dateTime(new Date(b.awardedAt), { dateStyle: "medium" }) : undefined}>
            <GcsProfileBadge badge={b} />
            <span>{b.name}</span>
          </div>
        ))}
      </div>
    </GcsCard>
  );

  let main: React.ReactNode;
  if (tab === "activity") {
    const activity = await services().profileQueries.activity(actor, user.id, query.before ? { before: query.before } : {});
    main = (
      <GcsCard as="section" style={{ overflow: "hidden" }}>
        <h2 className="gcs-display" style={{ ...sectionTitle, padding: "16px 20px", borderBottom: "1px solid var(--gcs-border)" }}>
          {t("recentActivity")}
        </h2>
        {activity.items.length === 0 && <p className="gcs-muted" style={{ padding: "16px 20px", margin: 0 }}>{t("noActivity")}</p>}
        <ul className="gcs-activity" data-testid="gcs-profile-activity">
          {activity.items.map((item) => (
            <li key={item.kind === "badge" ? `b-${item.badge.key}` : `p-${item.postId}`} className="gcs-activity__item">
              {item.kind === "badge" ? (
                <>
                  <GcsProfileBadge badge={item.badge} size="s" />
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
                    {item.kind === "topic" ? "+" : "✎"}
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
            <Link href={`${tabHref("activity")}?before=${encodeURIComponent(activity.next)}`}>{t("older")}</Link>
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
          <h2 className="gcs-display" style={{ ...sectionTitle, padding: "16px 20px", borderBottom: "1px solid var(--gcs-border)" }}>
            {t("wall.title")}
          </h2>
          {wall?.items.length === 0 && <p className="gcs-muted" style={{ padding: "16px 20px", margin: 0 }}>{t("wall.empty")}</p>}
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
      <GcsCard as="section" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 className="gcs-display" style={sectionTitle}>
          {t("followersCount", { count: followers?.total ?? 0 })}
        </h2>
        {followers?.users.length === 0 && <span className="gcs-muted">{t("noFollowers")}</span>}
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
    main = badgesGrid(true);
  } else {
    const warnings = (await services().profileQueries.warnings(actor, user.id)) ?? [];
    main = (
      <GcsCard as="section" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }} data-testid="gcs-profile-warnings">
        <h2 className="gcs-display" style={sectionTitle}>
          {t("tabs.warnings")}
        </h2>
        {warnings.length === 0 && <span className="gcs-muted">{t("noWarnings")}</span>}
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

  return (
    <>
      {header}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
        <aside style={{ flex: "1 1 340px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
          {aboutCard}
          {tab !== "games" && accountsCard}
          {tab !== "badges" && badgesGrid(false)}
        </aside>
        <div style={{ flex: "999 1 640px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>{main}</div>
      </div>
    </>
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
