import { CLAN_LINK_KINDS, type GcsClanDetails } from "@gcs/modules";
import { parseRef } from "@gcs/modules/slug";
import { GcsAvatar, GcsClanTag, GcsUserLink } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { forumHref, memberHref, topicHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { GcsClanJoinActions } from "../../_components/clans/GcsClanActions";
import { GcsClanRecruit, GcsClanStateLabel } from "../../_components/clans/GcsClanGrid";
import { clanColors, GcsClanLogo } from "../../_components/clans/GcsClanLogo";
import { GcsClanGameStats } from "../../_components/clans/GcsClanGameStats";
import { GcsRelTime } from "../../_components/forum/GcsRelTime";

type Props = { params: Promise<{ ref: string }> };

export const dynamic = "force-dynamic";

async function load(ref: string): Promise<GcsClanDetails | null> {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  return services().clanQueries.details(await currentActor(), parsed.id);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const clan = await load((await params).ref);
  return { title: clan ? `[${clan.tag}] ${clan.name}` : (await getTranslations("clans"))("title") };
}

const LINK_ICONS: Record<(typeof CLAN_LINK_KINDS)[number], string> = {
  discord: "fa-brands fa-discord",
  steam: "fa-brands fa-steam",
  website: "fa-solid fa-globe",
  youtube: "fa-brands fa-youtube",
  twitch: "fa-brands fa-twitch",
};

/**
 * `/clans/{id}-{slug}` (specul 2026-10-08-clanuri §7.2): antetul cu plăcuța și acțiunile viewer-ului, bannerul cu
 * logo-ul, descrierea, membrii pe roluri, activitatea; în dreapta statisticile, linkurile și forumul clanului (doar
 * pentru cine îl poate citi).
 */
export default async function ClanPage({ params }: Props) {
  const { ref } = await params;
  const clan = await load(ref);
  if (!clan) notFound();
  if (ref !== `${clan.id}-${clan.slug}`) permanentRedirect(clan.href);
  const [t, format] = await Promise.all([getTranslations("clans"), getFormatter()]);
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  const byRole = (role: "LEADER" | "OFFICER" | "MEMBER") => clan.members.filter((m) => m.role === role);
  const links = CLAN_LINK_KINDS.filter((k) => clan.links[k]);
  const open = clan.status === "ACTIVE" && !clan.locked;

  return (
    <>
      <header className="gcs-pageHeader">
        <nav aria-label={t("title")} className="gcs-breadcrumb">
          <ol>
            <li>
              <Link href="/clans">
                <GcsIcon name="fa-solid fa-people-group" className="gcs-breadcrumb__home" />
                {t("title")}
              </Link>
            </li>
            <li aria-current="page">{clan.name}</li>
          </ol>
        </nav>
        <div className="gcs-pageHeader__text">
          <div className="gcs-clanTitle">
            <GcsClanTag clan={clan} size="lg" plain testId="gcs-clan-tag" />
            <h1 className="gcs-display gcs-pageHeader__title">{clan.name}</h1>
          </div>
          <p className="gcs-clanHeadMeta">
            <GcsClanStateLabel clan={clan} />
            {clan.rank !== null && clan.status === "ACTIVE" && <span data-testid="gcs-clan-rank">{t("rankPlace", { rank: clan.rank })}</span>}
            {open && <GcsClanRecruit mode={clan.joinMode} />}
          </p>
        </div>
        <div className="gcs-pageHeader__actions">
          <GcsClanJoinActions
            v={{
              clanId: clan.id,
              clanName: clan.name,
              role: clan.viewer.role,
              joinMode: clan.joinMode,
              canJoin: clan.viewer.canJoin,
              canRequest: clan.viewer.canRequest,
              pendingRequest: clan.viewer.pendingRequest,
              invite: clan.viewer.invite ? { invitedBy: clan.viewer.invite.invitedBy?.name ?? null } : null,
              blocked: clan.viewer.blocked,
              open,
            }}
          />
          {clan.viewer.canManage && (
            <Link className="gcs-btn gcs-btn--ghost" href={`${clan.href}/manage`} data-testid="gcs-clan-manage">
              <GcsIcon name="fa-solid fa-sliders" />
              {t("manageLink")}
            </Link>
          )}
        </div>
      </header>

      {clan.status === "PENDING" && (
        <div className="gcs-clanNotice" role="status" data-testid="gcs-clan-pending">
          <GcsIcon name="fa-solid fa-hourglass-half" />
          <span>{t("notices.pending")}</span>
        </div>
      )}
      {clan.locked && (
        <div className="gcs-clanNotice" role="status">
          <GcsIcon name="fa-solid fa-lock" />
          <span>{clan.lockReason ? t("notices.lockedReason", { reason: clan.lockReason }) : t("notices.locked")}</span>
        </div>
      )}

      <div className="gcs-clanHero" style={clanColors(clan)}>
        {clan.bannerUrl && <img className="gcs-clanBanner__img" src={clan.bannerUrl} alt="" />}
        <GcsClanLogo clan={clan} size="l" eager />
      </div>

      <div className="gcs-clanLayout">
        <div className="gcs-clanLayout__main">
          <section className="gcs-card gcs-titledBox gcs-clanBox" aria-labelledby="gcs-clan-about">
            <h2 id="gcs-clan-about" className="gcs-titleBand gcs-clanBox__title">
              <GcsIcon name="fa-solid fa-scroll" className="gcs-hIcon" />
              {t("about")}
            </h2>
            {clan.descriptionHtml ? (
              // HTML-ul produs și sanitizat de renderer-ul editorului la salvare (profilul `clanDescription`).
              <div className="gcs-postBody gcs-clanAbout" data-testid="gcs-clan-description" dangerouslySetInnerHTML={{ __html: clan.descriptionHtml }} />
            ) : (
              <p className="gcs-muted" style={{ margin: 0 }}>
                {t("noDescription")}
              </p>
            )}
          </section>

          <section className="gcs-card gcs-titledBox gcs-clanBox" aria-labelledby="gcs-clan-members" data-testid="gcs-clan-roster">
            <h2 id="gcs-clan-members" className="gcs-titleBand gcs-clanBox__title">
              <GcsIcon name="fa-solid fa-users" className="gcs-hIcon" />
              {t("members")}
              <span className="gcs-clanBox__count">{format.number(clan.members.length)}</span>
            </h2>
            <div className="gcs-clanRoster">
              {(["LEADER", "OFFICER", "MEMBER"] as const).map((role) => {
                const list = byRole(role);
                if (list.length === 0) return null;
                return (
                  <div key={role} data-role={role}>
                    <h3 className="gcs-clanRoster__role">{t(`roles.plural.${role}`, { count: list.length })}</h3>
                    <ul className="gcs-clanRoster__list">
                      {list.map((m) => (
                        <li key={m.user.id} className="gcs-clanRoster__member" data-testid="gcs-clan-member">
                          <GcsAvatar name={m.user.name} size="s" userId={m.user.id} {...(m.user.image ? { src: m.user.image } : {})} {...(m.user.frameKey ? { frame: m.user.frameKey } : {})} />
                          <span className="gcs-clanRoster__who">
                            <GcsUserLink userId={m.user.id} name={m.user.name} nameKey={m.user.nameKey} href={memberHref(m.user)} />
                            <span className="gcs-clanRoster__since">{t("since", { date: date(m.joinedAt) })}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>

          {clan.game && <GcsClanGameStats clan={clan} />}

          <section className="gcs-card gcs-titledBox gcs-clanBox" aria-labelledby="gcs-clan-activity">
            <h2 id="gcs-clan-activity" className="gcs-titleBand gcs-clanBox__title">
              <GcsIcon name="fa-solid fa-clock-rotate-left" className="gcs-hIcon" />
              {t("activity.title")}
            </h2>
            {clan.activity.length === 0 ? (
              <p className="gcs-muted" style={{ margin: 0 }}>
                {t("activity.empty")}
              </p>
            ) : (
              <ul className="gcs-clanActivity" data-testid="gcs-clan-activity">
                {clan.activity.map((a, i) => (
                  <li key={`${a.at}-${i}`}>
                    <span>
                      {a.user ? (
                        t.rich(`activity.${a.kind}`, { name: () => <GcsUserLink userId={a.user!.id} name={a.user!.name} nameKey={a.user!.nameKey} href={memberHref(a.user!)} /> })
                      ) : (
                        t(`activity.${a.kind}Anon`)
                      )}
                    </span>
                    <GcsRelTime at={a.at} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="gcs-clanLayout__side">
          <section className="gcs-card gcs-titledBox gcs-clanBox" aria-labelledby="gcs-clan-stats">
            <h2 id="gcs-clan-stats" className="gcs-titleBand gcs-clanBox__title">
              <GcsIcon name="fa-solid fa-ranking-star" className="gcs-hIcon" />
              {t("stats.title")}
            </h2>
            <dl className="gcs-clanStats" data-testid="gcs-clan-stats">
              <div>
                <dt>{t("stats.rank")}</dt>
                <dd>{clan.rank !== null && clan.status === "ACTIVE" ? `#${clan.rank}` : "—"}</dd>
              </div>
              <div>
                <dt>{t("stats.score")}</dt>
                <dd>{format.number(clan.score)}</dd>
              </div>
              <div>
                <dt>{t("stats.members")}</dt>
                <dd>{clan.memberLimit === null ? format.number(clan.membersCount) : t("stats.membersOf", { count: clan.membersCount, limit: clan.memberLimit })}</dd>
              </div>
              <div>
                <dt>{t("stats.founded")}</dt>
                <dd>{format.dateTime(new Date(clan.createdAt), { month: "short", year: "numeric" })}</dd>
              </div>
            </dl>
            {clan.scoreParts && (
              <p className="gcs-clanStats__parts">
                {t("stats.parts", { posts: clan.scoreParts.posts, reputation: clan.scoreParts.reputation, active: clan.scoreParts.active, members: clan.scoreParts.members })}
                {clan.scoreParts.game &&
                  ` ${t("stats.partsGame", { hours: clan.scoreParts.game.playtimeHours, kd: format.number(clan.scoreParts.game.kd, { maximumFractionDigits: 2 }), mixWins: clan.scoreParts.game.mixWins })}`}
              </p>
            )}
          </section>

          {links.length > 0 && (
            <section className="gcs-card gcs-titledBox gcs-clanBox" aria-labelledby="gcs-clan-links">
              <h2 id="gcs-clan-links" className="gcs-titleBand gcs-clanBox__title">
                <GcsIcon name="fa-solid fa-link" className="gcs-hIcon" />
                {t("links.title")}
              </h2>
              <ul className="gcs-clanLinks" data-testid="gcs-clan-links">
                {links.map((k) => (
                  <li key={k}>
                    <a href={clan.links[k]} target="_blank" rel="noopener noreferrer nofollow ugc">
                      <GcsIcon name={LINK_ICONS[k]} />
                      {t(`links.${k}`)}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {clan.forum && (
            <section className="gcs-card gcs-titledBox gcs-clanBox" aria-labelledby="gcs-clan-forum" data-testid="gcs-clan-forum">
              <h2 id="gcs-clan-forum" className="gcs-titleBand gcs-clanBox__title">
                <GcsIcon name="fa-solid fa-comments" className="gcs-hIcon" />
                {t("forum.title")}
              </h2>
              {clan.forum.topics.length === 0 ? (
                <p className="gcs-muted" style={{ margin: 0 }}>
                  {t("forum.empty")}
                </p>
              ) : (
                <ul className="gcs-clanTopics">
                  {clan.forum.topics.map((tp) => (
                    <li key={tp.id}>
                      <Link href={topicHref(tp)}>{tp.title}</Link>
                      <GcsRelTime at={tp.lastPostAt} />
                    </li>
                  ))}
                </ul>
              )}
              <Link href={forumHref(clan.forum)} className="gcs-clanList__all" data-testid="gcs-clan-forum-link">
                {t("forum.open")}
              </Link>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
