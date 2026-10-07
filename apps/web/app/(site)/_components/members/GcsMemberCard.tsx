import type { GcsMemberCard as Card } from "@gcs/modules";
import { GcsAvatar, GcsUserLink } from "@gcs/ui";
import { getFormatter, getTranslations } from "next-intl/server";
import { memberHref, tint } from "@/lib/forum-urls";
import { memberCardVars } from "@/lib/template-data";
import { siteTemplate } from "@/lib/templates";

/** Cardul unui membru (listele `/members` și `/staff`): avatar cu ramă și online, grup, rang, contoare, înscriere. */
export async function GcsMemberCard({ member }: { member: Card }) {
  // Șablonul `members.card`, dacă tema l-a modificat.
  const custom = await siteTemplate("members.card", memberCardVars(member));
  if (custom) return custom;
  const [t, format] = await Promise.all([getTranslations("members"), getFormatter()]);
  return (
    <article className="gcs-card gcs-memberCard" data-testid="gcs-member-card">
      <span className="gcs-memberCard__avatar">
        <GcsAvatar name={member.name} size="l" userId={member.id} {...(member.image ? { src: member.image } : {})} {...(member.frameKey ? { frame: member.frameKey } : {})} />
        {member.online && <span className="gcs-postbit__online" role="img" aria-label={t("online")} title={t("online")} />}
      </span>
      <strong className="gcs-memberCard__name">
        <GcsUserLink userId={member.id} name={member.name} nameKey={member.nameKey} href={memberHref(member)} />
      </strong>
      {member.customTitle && <span className="gcs-postbit__title">{member.customTitle}</span>}
      <span className="gcs-badge" style={member.group.color ? { background: tint(member.group.color, 0.16), color: member.group.color } : undefined}>
        {member.group.name}
      </span>
      {member.rank && <span className="gcs-post__rank">{member.rank.name}</span>}
      <dl className="gcs-memberCard__stats">
        <div>
          <dt>{t("posts")}</dt>
          <dd>{format.number(member.postsCount)}</dd>
        </div>
        <div>
          <dt>{t("reputation")}</dt>
          <dd>{format.number(member.reputation)}</dd>
        </div>
      </dl>
      <span className="gcs-postbit__joined">{t("joined", { date: format.dateTime(new Date(member.joinedAt), { dateStyle: "medium" }) })}</span>
    </article>
  );
}
