import { isSafeBanner, type GcsReactionView } from "@gcs/core";
import type { GcsClanTag, GcsPostbitData, GcsPostView } from "@gcs/modules";
import { GcsAvatar, GcsBadgeArt, GcsClanTag as GcsClanPlate, GcsTooltip, GcsUserLink } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import { getFormatter, getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { memberHref, postHref } from "@/lib/forum-urls";
import { postbitVars } from "@/lib/template-data";
import { siteTemplate } from "@/lib/templates";
import { memberLook } from "@/lib/member-look";
import { pluginHookHtml } from "@/lib/plugins";
import { GcsDeletedPostbit } from "../GcsDeletedMember";
import { GcsTranslateButton, type GcsTranslateLabels } from "../GcsTranslateButton";
import { GcsPostContent, type GcsPostContentProps } from "./GcsPostContent";

/** Grupurile staff-ului (postările lor au chenarul colorat). */
const STAFF_GROUPS = new Set(["root_admin", "admin", "super_moderator", "moderator"]);

type Props = {
  topicId: number;
  forumId: number;
  post: GcsPostView;
  isSolved: boolean;
  reactionList: GcsReactionView[];
  can: Omit<GcsPostContentProps["can"], "edit" | "hide">;
  actorId: string | null;
  /** Autorul e ignorat de viewer: postarea apare pliată, cu „arată” (specul etapei 3, §8). */
  ignored?: boolean;
  /** Etichetele butonului „Traduce” (etapa 5), dacă viewer-ul îl are. */
  translate?: GcsTranslateLabels | null;
  /** Cardul autorului (etapa 5): grupul, XP-ul, insignele, câmpurile, online. */
  postbit?: GcsPostbitData | null;
  /** Tagul clanului autorului (aplicația Clanuri, dacă opțiunile îl arată în postbit). */
  clan?: GcsClanTag | null;
};

/** O postare (macheta Topic): coloana autorului (server) și conținutul cu acțiunile (client). */
export async function GcsPost({ topicId, forumId, post, isSolved, reactionList, can, actorId, ignored = false, translate = null, postbit = null, clan = null }: Props) {
  const t = await getTranslations("topic");
  const format = await getFormatter();
  const author = post.author;
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const edited = post.editedAt
    ? post.editedBy && post.editedBy.id !== author?.id
      ? t("editedBy", { name: post.editedBy.name, when: date(post.editedAt) })
      : t("edited", { when: date(post.editedAt) })
    : null;
  const own = actorId !== null && actorId === author?.id;
  // Postările staff-ului au chenarul în culoarea grupului autorului (designul Nova).
  const staffColor = postbit && STAFF_GROUPS.has(postbit.group.key) ? (postbit.group.color ?? "var(--gcs-accent)") : null;

  const article = (
    <article
      id={`post-${post.id}`}
      className={`gcs-card gcs-post${isSolved ? " gcs-post--solved" : ""}${post.visibility !== "VISIBLE" ? " gcs-post--muted" : ""}`}
      data-testid="gcs-post"
      data-post-id={post.id}
      data-post-number={post.number}
      {...(staffColor ? { "data-staff": "", style: { "--gcs-post-group": staffColor } as CSSProperties } : {})}
    >
      <div className="gcs-post__author gcs-postbit" data-testid="gcs-postbit">
        {author ? <GcsPostbit author={author} data={postbit} clan={clan} post={{ id: post.id, number: post.number }} topicId={topicId} /> : <GcsDeletedPostbit />}
      </div>
      <GcsPostContent
        topicId={topicId}
        forumId={forumId}
        post={{
          id: post.id,
          number: post.number,
          html: post.html,
          visibility: post.visibility,
          date: date(post.createdAt),
          dateIso: post.createdAt,
          edited,
          hiddenReason: post.hiddenReason,
          authorId: author?.id ?? null,
          authorName: author?.name ?? "",
          attachments: post.attachments,
        }}
        isSolved={isSolved}
        reactions={post.reactions}
        myReaction={post.myReaction}
        reactionList={reactionList}
        permalink={postHref(topicId, post.id)}
        can={{ ...can, react: can.react && !own, report: can.report && !own, edit: post.canEdit, hide: post.canHide }}
        extras={translate && post.visibility === "VISIBLE" && !own ? <GcsTranslateButton contentType="forums.post" contentId={post.id} labels={translate} /> : null}
        signature={
          author?.signatureHtml && post.visibility === "VISIBLE" ? (
            // Semnătura: HTML-ul produs și sanitizat de renderer la salvare (Setări → Semnătură).
            <div className="gcs-post__signature gcs-postBody" data-testid="gcs-post-signature" dangerouslySetInnerHTML={{ __html: author.signatureHtml }} />
          ) : null
        }
      />
    </article>
  );
  if (!ignored || !author) return article;
  return (
    <details className="gcs-post--ignored" data-testid="gcs-post-ignored">
      <summary className="gcs-card gcs-post--ignoredSummary">{t("ignored", { name: author.name })}</summary>
      {article}
    </details>
  );
}

/** Câte coroane arată postbit-ul pentru nivelul rangului (rangurile de peste plafon rămân la plafon). */
const MAX_PIPS = 8;

/** Iconița rangului: un nume Font Awesome (`fa-…`) devine SVG, altfel e un emoji/text; fără iconiță, un scut. */
function GcsRankIcon({ icon }: { icon: string | null }) {
  if (!icon) return <GcsIcon name="fa-solid fa-shield-halved" />;
  if (!icon.startsWith("fa-")) return <span aria-hidden="true">{icon}</span>;
  // `fa-crown` fără stil → `fa-solid fa-crown`.
  return <GcsIcon name={/^fa-(solid|regular|brands) /.test(icon) ? icon : `fa-solid ${icon}`} />;
}

/**
 * Cardul autorului (specul etapei 5, „Postbit”, refăcut după referința proprietarului): statusul online și @handle-ul,
 * avatarul pătrat cu rama, numele stilizat, planul VIP / grupul, titlul custom și coroanele rangului; bara grupului
 * (culoarea sau banner-ul validat); rangul cu XP-ul, insignele (numărul și ultimele 5); contoarele (postări, topicuri,
 * aprecieri) și câmpurile alese din ACP (cu iconițe; „Select cu imagini” arată imaginea); data înscrierii și motto-ul
 * (ultimul status de pe peretele membrului). Statusul online apare o singură dată, sus; coperta membrului e fundalul
 * blocului cu avatarul (specul „hover card și coperta în postbit”, 2026-10-07).
 */
async function GcsPostbit({
  author,
  data,
  clan,
  post,
  topicId,
}: {
  author: NonNullable<GcsPostView["author"]>;
  data: GcsPostbitData | null;
  clan: GcsClanTag | null;
  post: { id: number; number: number };
  topicId: number;
}) {
  // Punctul de extensie `postbit.after_fields` (pluginurile, etapa 6): HTML sanitizat, o dată pentru ambele randări.
  const plugins = await pluginHookHtml("postbit.after_fields", { postId: post.id, topicId, authorId: author.id });
  // Șablonul `postbit.author` (cu `postbit.fields` inclus), dacă tema l-a modificat; `{% hook %}` primește pluginurile.
  const custom = await siteTemplate("postbit.author", postbitVars(author, data, post, clan), {}, { "postbit.after_fields": plugins.join("") });
  if (custom) return custom;
  const t = await getTranslations("topic.author");
  const format = await getFormatter();
  // Aspectul publicat de pluginuri (Studio VIP): banner-ul în bara grupului, fundalul în caseta avatarului, arma în rânduri.
  const look = await memberLook(author.id);
  const cover = look?.card ?? (data?.cover ? { background: `center ${data.cover.positionY}% / cover no-repeat url(${data.cover.url})` } : null);
  const groupColor = data?.group.color ?? author.groupColor;
  const groupLabel = data?.group.name ?? author.groupTitle ?? author.groupName;
  const banner = data?.group.banner && isSafeBanner(data.group.banner) ? data.group.banner : (groupColor ?? null);
  // Linia a doua: planul VIP (dacă diferă de grupul din bară), altfel un grup secundar, altfel grupul.
  const secondary = data?.vipName && data.vipName !== groupLabel ? data.vipName : (data?.secondaryGroup ?? data?.vipName ?? groupLabel);
  const pips = data?.rankLevel ? Math.min(data.rankLevel, MAX_PIPS) : 0;
  const profile = memberHref(author);
  const stats: { key: string; icon: string; label: string; value: string }[] = [
    { key: "posts", icon: "fa-solid fa-pen", label: t("posts"), value: format.number(author.postsCount) },
    ...(data ? [{ key: "topics", icon: "fa-solid fa-folder-open", label: t("topics"), value: format.number(data.topicsCount) }] : []),
    { key: "likes", icon: "fa-solid fa-heart", label: t("likes"), value: format.number(author.reputation) },
  ];
  const status = data ? (data.online ? t("statusOnline") : t("statusOffline")) : null;

  return (
    <>
      <div className="gcs-postbit__top">
        {data &&
          (data.online ? (
            <span className="gcs-postbit__status gcs-postbit__status--on" data-testid="gcs-postbit-online" title={t("online")}>
              <span className="gcs-postbit__dot" aria-hidden="true" />
              {status}
            </span>
          ) : (
            <span className="gcs-postbit__status">
              <span className="gcs-postbit__dot" aria-hidden="true" />
              {status}
            </span>
          ))}
        <span className="gcs-postbit__handle">@{author.name.toLowerCase()}</span>
      </div>

      <div className={`gcs-postbit__profile${cover ? " gcs-postbit__profile--cover" : ""}`}>
        {cover && (
          // Coperta membrului (sau fundalul cardului ales în Studio VIP): strat decorativ sub avatar și nume (voalul e în CSS).
          <span className="gcs-postbit__cover" aria-hidden="true" style={cover} data-testid="gcs-postbit-cover" {...(look?.card ? { "data-vip": "card" } : {})} />
        )}
        <span className="gcs-postbit__avatar">
          <GcsAvatar name={author.name} size="l" userId={author.id} {...(author.image ? { src: author.image } : {})} {...(author.frameKey ? { frame: author.frameKey } : {})} />
        </span>
        <div className="gcs-postbit__identity">
          <span className="gcs-post__authorName">
            <GcsUserLink userId={author.id} name={author.name} nameKey={author.nameKey} href={profile} />
          </span>
          {clan && (
            <span className="gcs-postbit__clan" data-testid="gcs-postbit-clan">
              <GcsClanPlate clan={clan} size="sm" />
              <span className="gcs-postbit__clanName">{clan.name}</span>
            </span>
          )}
          <span className="gcs-postbit__secondary" {...(data?.vip ? { "data-testid": "gcs-postbit-vip" } : {})}>
            {secondary}
          </span>
          {data?.customTitle && (
            <span className="gcs-postbit__title" title={data.customTitle}>
              <GcsIcon name="fa-solid fa-id-badge" />
              <span>{data.customTitle}</span>
            </span>
          )}
          {pips > 0 && (
            <span className="gcs-postbit__pips" role="img" aria-label={t("rankLevel", { level: data?.rankLevel ?? pips })}>
              {Array.from({ length: pips }, (_, i) => (
                <GcsIcon key={i} name="fa-solid fa-crown" />
              ))}
            </span>
          )}
        </div>
      </div>

      <span
        className={`gcs-postbit__group${banner || look?.banner ? " gcs-postbit__group--colored" : ""}${look?.banner ? " gcs-fx" : ""}${look?.banner?.className ? ` ${look.banner.className}` : ""}`}
        style={look?.banner ? look.banner.style : banner ? { background: banner } : undefined}
        data-testid="gcs-postbit-group"
        {...(look?.banner ? { "data-vip": "banner" } : {})}
      >
        {data?.group.icon && <GcsIcon name={data.group.icon} />}
        <span>{look?.banner?.label ?? groupLabel}</span>
      </span>

      {(data || author.rank) && (
        <div className="gcs-postbit__rankBox" data-testid="gcs-postbit-xp">
          <div className="gcs-postbit__rankRow">
            <span className="gcs-postbit__rankIcon">
              <GcsRankIcon icon={author.rank?.icon ?? null} />
            </span>
            <span className="gcs-postbit__rankText">
              {author.rank && (
                <span className="gcs-post__rank" data-testid="gcs-post-rank">
                  {author.rank.name}
                </span>
              )}
              {data && <span className="gcs-postbit__xpText">{format.number(data.xp.points)} XP</span>}
            </span>
            {data && (
              <a className="gcs-postbit__badgeLink" href={`${profile}?tab=badges`}>
                <GcsIcon name="fa-solid fa-trophy" />
                <span>{t("badges", { count: data.badges.count })}</span>
              </a>
            )}
          </div>
          {data && (
            <div
              className="gcs-postbit__xpBar"
              role="progressbar"
              aria-label={t("xp")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={data.xp.percent}
              aria-valuetext={
                data.xp.next !== null ? t("xpTo", { points: data.xp.points, next: data.xp.next, rank: data.xp.nextRank ?? "" }) : t("xpMax", { points: data.xp.points })
              }
              title={data.xp.next !== null ? `${format.number(data.xp.points)} / ${format.number(data.xp.next)} XP` : undefined}
            >
              <span style={{ width: `${data.xp.percent}%` }} />
            </div>
          )}
          {data && data.badges.recent.length > 0 && (
            <ul className="gcs-postbit__badges" data-testid="gcs-postbit-badges">
              {data.badges.recent.map((b) => (
                <li key={b.key} className="gcs-badgeArt__item">
                  <GcsTooltip
                    content={
                      <span className="gcs-badgeTip">
                        <strong>{b.name}</strong>
                        {b.description && <span>{b.description}</span>}
                      </span>
                    }
                  >
                    <span className="gcs-badgeArt__focus" tabIndex={0}>
                      <GcsBadgeArt badge={b} size={32} />
                    </span>
                  </GcsTooltip>
                </li>
              ))}
              {data.badges.count > data.badges.recent.length && (
                <li className="gcs-badgeArt__item">
                  <a className="gcs-badgeArt__more" href={`${profile}?tab=badges`} aria-label={t("badgesMore", { count: data.badges.count - data.badges.recent.length })} data-testid="gcs-postbit-badges-more">
                    +{data.badges.count - data.badges.recent.length}
                  </a>
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      <dl className="gcs-postbit__rows">
        {stats.map((s) => (
          <div key={s.key} className="gcs-postbit__row" data-stat={s.key}>
            <dt>
              <span className="gcs-postbit__rowIcon">
                <GcsIcon name={s.icon} />
              </span>
              {s.label}
            </dt>
            <dd>{s.value}</dd>
          </div>
        ))}
        {look?.flair && (
          <div className="gcs-postbit__row" data-stat="weapon" data-testid="gcs-postbit-weapon">
            <dt>
              <span className="gcs-postbit__rowIcon">
                <GcsIcon name="fa-solid fa-crosshairs" />
              </span>
              {t("weapon")}
            </dt>
            {/* Iconița armei la proporțiile ei (și cele late, 110×30), lângă nume, nu strânsă în cercul rândului. */}
            <dd title={look.flair.label}>
              <img src={look.flair.icon} alt="" className="gcs-postbit__flair" />
              <span className="gcs-postbit__flairName">{look.flair.label}</span>
            </dd>
          </div>
        )}
      </dl>
      {data && data.fields.length > 0 && (
        <dl className="gcs-postbit__rows gcs-postbit__fields" data-testid="gcs-postbit-fields">
          {data.fields.map((f) => (
            <div key={f.key} className="gcs-postbit__row" data-field={f.key}>
              <dt>
                <span className="gcs-postbit__rowIcon">
                  <GcsIcon name={f.icon ?? (f.type === "URL" ? "fa-solid fa-link" : "fa-solid fa-circle-info")} />
                </span>
                {f.label}
              </dt>
              <dd>
                {f.image && <img src={f.image} alt="" className="gcs-postbit__fieldImage" />}
                {f.type === "URL" ? (
                  <a href={f.value} rel="noopener nofollow ugc" target="_blank" className="gcs-postbit__fieldLink">
                    <span>{f.value.replace(/^https?:\/\//, "")}</span>
                    <GcsIcon name="fa-solid fa-arrow-up-right-from-square" />
                  </a>
                ) : f.image ? (
                  <span className="gcs-srOnly">{f.value}</span>
                ) : (
                  f.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {plugins.length > 0 && (
        <div className="gcs-pluginHook" data-hook="postbit.after_fields">
          {plugins.map((html, i) => (
            // HTML-ul pluginului, trecut prin sanitizer (listă albă) de gazda pluginurilor.
            <div key={i} dangerouslySetInnerHTML={{ __html: html }} />
          ))}
        </div>
      )}

      <div className="gcs-postbit__foot">
        <span className="gcs-postbit__joined">
          <GcsIcon name="fa-regular fa-clock" />
          {t("memberSince")} <strong>{format.dateTime(new Date(author.joinedAt), { dateStyle: "medium" })}</strong>
        </span>
      </div>

      {data?.motto && (
        <blockquote className="gcs-postbit__motto" title={data.motto} aria-label={t("motto")}>
          <p>“{data.motto}”</p>
        </blockquote>
      )}
    </>
  );
}
