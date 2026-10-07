import type { CSSProperties, ReactNode } from "react";
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
    /** Poziția verticală a copertei (0–100 %), aleasă de membru; implicit 50. */
    coverPositionY?: number;
    group: { name: string; color: string | null };
    rank: { name: string; icon: string | null } | null;
  };
  stats: { posts: number; reputation: number; followers: number; joinedAt: string };
  online: { online: boolean };
  /** `art` = adresa insignei generate; `image` = imaginea proprie încărcată în ACP (are prioritate). */
  badges: { key: string; name: string; description?: string; art: string; image: string | null }[];
  fields: { label: string; value: string }[];
  /**
   * Aspectul publicat de pluginuri (Studio VIP), cu stilurile deja calculate de GCS din valori validate: banner-ul de
   * sub nume, fundalul copertei și arma (iconița și numele).
   */
  look?: { banner: { label: string; style: CSSProperties; className?: string } | null; card: CSSProperties | null; flair: { icon: string; label: string } | null } | null;
};

export type GcsHoverCardLabels = { posts: string; reputation: string; followers: string; online: string; joined: string; weapon?: string };

function tint(hex: string | null, alpha: number, fallback: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? "");
  return m ? `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})` : fallback;
}

/** Două etichete la fel (fără diferențe de majuscule sau spații). */
const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Iconița rangului ca text (emoji); numele Font Awesome (`fa-…`) nu se afișează ca text. */
function rankSymbol(icon: string | null | undefined): string | null {
  return icon && !icon.startsWith("fa-") ? icon : null;
}

/**
 * Hover card-ul unui membru (specul „hover card și coperta în postbit”, 2026-10-07): coperta (imaginea cu poziția
 * salvată sau degradeul accentului) cu cusătura de accent; sub ea avatarul cu ramă (urcat pe jumătate peste copertă) și,
 * în dreapta lui, numele stilizat, grupul, rangul și statusul online — niciodată peste imagine; apoi bio-ul, insignele,
 * câmpurile „pe card” (2 coloane), contoarele și acțiunile (Urmărește / Mesaj, din `actions`).
 * Șablonul implicit `members.hover_card` produce exact același markup.
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
  const symbol = rankSymbol(user.rank?.icon);
  const look = data.look ?? null;
  const cover = user.cover
    ? `center ${user.coverPositionY ?? 50}% / cover no-repeat url(${user.cover})`
    : `linear-gradient(120deg, ${tint(accent, 0.55, "rgba(214,40,57,.55)")}, ${tint(accent, 0.12, "rgba(214,40,57,.12)")})`;
  return (
    <div className="gcs-card gcs-hoverCard" role="dialog" aria-label={user.name} id={id} data-testid="gcs-hover-card">
      <div
        className={user.cover || look?.card ? "gcs-hoverCard__cover gcs-hoverCard__cover--image" : "gcs-hoverCard__cover"}
        style={{ "--gcs-hoverCard-accent": accent, ...(look?.card ?? { background: cover }) } as CSSProperties}
        data-testid="gcs-hover-cover"
        {...(look?.card ? { "data-vip": "card" } : {})}
      />
      <div className="gcs-hoverCard__body">
        <div className="gcs-hoverCard__head">
          <span className="gcs-hoverCard__avatar">
            <GcsAvatar name={user.name} size="l" userId={user.id} {...(user.image ? { src: user.image } : {})} {...(user.frameKey ? { frame: user.frameKey } : {})} />
          </span>
          <div className="gcs-hoverCard__identity">
            <a href={`/members/${user.id}-${user.slug}`} className={`gcs-userLink gcs-name--${user.nameKey} gcs-hoverCard__name`} title={user.name} data-name-user={user.id} data-text={user.name}>
              {user.name}
            </a>
            <div className="gcs-hoverCard__meta">
              {/* Banner-ul VIP înlocuiește pastila grupului când e același plan (fără dublură). */}
              {!(look?.banner && sameLabel(look.banner.label, user.group.name)) && (
                <span className="gcs-badge gcs-hoverCard__group" style={{ "--gcs-hoverCard-group": user.group.color ?? "var(--gcs-muted)" } as CSSProperties}>
                  {user.group.name}
                </span>
              )}
              {look?.banner && (
                <span className={`gcs-vipPill gcs-fx${look.banner.className ? ` ${look.banner.className}` : ""}`} style={look.banner.style} data-testid="gcs-hover-vip-banner">
                  {look.banner.label}
                </span>
              )}
              {user.rank && (
                <span className="gcs-hoverCard__rank" data-testid="gcs-hover-rank">
                  {symbol ? `${symbol} ` : ""}
                  {user.rank.name}
                </span>
              )}
              {data.online.online && (
                <span className="gcs-hoverCard__online">
                  <span className="gcs-dot" aria-hidden="true" />
                  {labels.online}
                </span>
              )}
            </div>
          </div>
        </div>
        {user.bio && <p className="gcs-hoverCard__bio">{user.bio}</p>}
        {data.badges.length > 0 && (
          <ul className="gcs-hoverCard__badges" aria-label="Badges">
            {data.badges.map((b) => (
              <li key={b.key} title={b.description ? `${b.name}: ${b.description}` : b.name} className="gcs-badgeArt__item">
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
                <dd title={f.value}>{f.value}</dd>
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
          {look?.flair && (
            <div className="gcs-hoverCard__flair" title={look.flair.label} data-testid="gcs-hover-weapon">
              <img src={look.flair.icon} alt="" />
              {labels.weapon ?? look.flair.label}
            </div>
          )}
        </div>
        {actions && <div className="gcs-hoverCard__actions">{actions}</div>}
      </div>
    </div>
  );
}
