import type { ReactNode } from "react";
import { GcsAvatar } from "./GcsAvatar";
import { GcsBadgeArt } from "./GcsBadgeArt";

export type GcsHoverCardData = {
  user: {
    id: string;
    name: string;
    image: string | null;
    nameKey: string;
    frameKey: string | null;
    slug: string;
    bio: string;
    accentColor: string | null;
    cover: string | null;
    group: { name: string; color: string | null };
    rank: { name: string; icon: string | null } | null;
  };
  stats: { posts: number; reputation: number; followers: number; joinedAt: string };
  online: { online: boolean };
  /** `art` = adresa insignei generate; `image` = imaginea proprie încărcată în ACP (are prioritate). */
  badges: { key: string; name: string; description?: string; art: string; image: string | null }[];
  fields: { label: string; value: string }[];
};

export type GcsHoverCardLabels = { posts: string; reputation: string; followers: string; online: string; joined: string };

function tint(hex: string | null, alpha: number, fallback: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? "");
  return m ? `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})` : fallback;
}

/**
 * Hover card-ul unui membru (macheta Topic): cover cu culoarea de accent, avatar cu ramă, nume stilizat, grup, rang,
 * 3 badge-uri, câmpurile marcate „pe card” și statisticile. Acțiunile (Urmărește / Mesaj) vin din `actions`.
 */
export function GcsHoverCard({
  data,
  labels,
  format,
  actions,
  id,
}: {
  data: GcsHoverCardData;
  labels: GcsHoverCardLabels;
  format: { number: (n: number) => string; year: (iso: string) => string };
  actions?: ReactNode;
  id?: string;
}) {
  const { user, stats } = data;
  const accent = user.accentColor ?? "#D62839";
  return (
    <div className="gcs-card gcs-hoverCard" role="dialog" aria-label={user.name} id={id} data-testid="gcs-hover-card">
      <div
        className="gcs-hoverCard__cover"
        style={{
          background: user.cover
            ? `center / cover no-repeat url(${user.cover})`
            : `linear-gradient(120deg, ${tint(accent, 0.55, "rgba(214,40,57,.55)")}, ${tint(accent, 0.12, "rgba(214,40,57,.12)")})`,
        }}
      />
      <div className="gcs-hoverCard__body">
        <div className="gcs-hoverCard__head">
          <GcsAvatar name={user.name} size="m" {...(user.image ? { src: user.image } : {})} {...(user.frameKey ? { frame: user.frameKey } : {})} className="gcs-hoverCard__avatar" />
          <div style={{ minWidth: 0 }}>
            <a href={`/members/${user.id}-${user.slug}`} className={`gcs-userLink gcs-name--${user.nameKey} gcs-hoverCard__name`}>
              {user.name}
            </a>
            <div className="gcs-hoverCard__meta">
              <span className="gcs-badge" style={{ background: tint(user.group.color, 0.16, "rgba(161,167,180,.16)"), color: user.group.color ?? "var(--gcs-muted)" }}>
                {user.group.name}
              </span>
              {user.rank && (
                <span className="gcs-hoverCard__rank" data-testid="gcs-hover-rank">
                  {user.rank.icon ? `${user.rank.icon} ` : ""}
                  {user.rank.name}
                </span>
              )}
              {data.online.online && (
                <span className="gcs-hoverCard__online">
                  <span className="gcs-dot" style={{ background: "var(--gcs-ok)" }} /> {labels.online}
                </span>
              )}
            </div>
          </div>
        </div>
        {user.bio && <p className="gcs-hoverCard__bio">{user.bio}</p>}
        {data.badges.length > 0 && (
          <ul className="gcs-hoverCard__badges" aria-label="Badges">
            {data.badges.map((b) => (
              <li key={b.key} title={b.description ? `${b.name}\n${b.description}` : b.name} className="gcs-badgeArt__item">
                <GcsBadgeArt badge={b} size={32} />
              </li>
            ))}
          </ul>
        )}
        {data.fields.length > 0 && (
          <dl className="gcs-hoverCard__fields">
            {data.fields.map((f) => (
              <div key={f.label}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="gcs-hoverCard__stats">
          <div>
            <strong>{format.number(stats.posts)}</strong>
            {labels.posts}
          </div>
          <div>
            <strong className={stats.reputation >= 0 ? "gcs-rep--pos" : "gcs-rep--neg"}>{stats.reputation > 0 ? `+${format.number(stats.reputation)}` : format.number(stats.reputation)}</strong>
            {labels.reputation}
          </div>
          <div>
            <strong data-testid="gcs-hover-followers">{format.number(stats.followers)}</strong>
            {labels.followers}
          </div>
          <div>
            <strong>{format.year(stats.joinedAt)}</strong>
            {labels.joined}
          </div>
        </div>
        {actions && <div className="gcs-hoverCard__actions">{actions}</div>}
      </div>
    </div>
  );
}
