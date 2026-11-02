import { GCS_BRAND } from "@gcs/core/themes";
import { GcsClanTag, type GcsClanTagData } from "./GcsClanTag";
import type { CSSProperties, ReactNode } from "react";
import { GcsAvatar } from "./GcsAvatar";
import { GcsBadgeArt } from "./GcsBadgeArt";
import { GcsMemberName } from "./GcsMemberName";
import { GcsGroupPill } from "./GcsGroupPill";

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
    /** Grupul afișat; cu `id`, pastila e un link spre membrii lui (`href`), cu tooltip-ul numărătorii. */
    group: { id?: number; name: string; color: string | null; href?: string | null; tooltip?: string[]; ariaLabel?: string };
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
  /** Tagul clanului membrului (aplicația Clanuri, dacă opțiunile îl arată pe hover card). */
  clan?: GcsClanTagData | null;
  /** Grupurile secundare vizibile (pastilele mici de după grupul afișat). */
  secondaryGroups?: { id: number; name: string; color: string | null; href: string | null; tooltip: string[]; ariaLabel: string }[];
  /**
   * Hover card v2 (profil gaming v2): linia de status, cipurile aplicațiilor, nivelul cu bara de XP și linkul profilului.
   * Lipsă = cardul clasic (același markup ca șablonul implicit `members.hover_card`).
   */
  v2?: GcsHoverCardV2 | null;
};

export type GcsHoverCardChip =
  | { kind: "clan"; tag: string; name: string; color: string | null; href: string }
  | { kind: "elo"; elo: number; tier: string; href: string | null }
  | { kind: "vip"; name: string; color: string | null };

export type GcsHoverCardV2 = {
  level: { level: number; rank: string | null; percent: number; next: { level: number; name: string } | null; xp: number };
  status: { kind: "online" } | { kind: "playing"; server: string; href: string } | { kind: "lastVisit"; at: string } | { kind: "hidden" };
  chips: GcsHoverCardChip[];
  profileHref: string;
};

export type GcsHoverCardLabels = { posts: string; reputation: string; followers: string; online: string; joined: string; weapon?: string };

/** Textele cardului v2 (funcțiile primesc valorile deja formatate). */
export type GcsHoverCardV2Labels = {
  onlineNow: string;
  playing: (server: string) => string;
  lastVisit: (time: string) => string;
  level: (level: number, rank: string | null) => string;
  maxLevel: string;
  nextLevel: (name: string) => string;
  elo: (elo: string, tier: string) => string;
  vip: string;
  badges: string;
  allBadges: string;
};

function tint(hex: string | null, alpha: number, fallback: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? "");
  return m ? `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})` : fallback;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Două etichete la fel (fără diferențe de majuscule sau spații). */
const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Iconița rangului ca text (emoji); numele Font Awesome (`fa-…`) nu se afișează ca text. */
function rankSymbol(icon: string | null | undefined): string | null {
  return icon && !icon.startsWith("fa-") ? icon : null;
}

/**
 * Hover card-ul unui membru (specul „hover card și coperta în postbit”, 2026-10-07; v2 în profil gaming v2): coperta
 * (imaginea cu poziția salvată sau degradeul accentului) cu cusătura de accent; sub ea avatarul cu inelul în culoarea
 * grupului (și punctul online în v2), numele stilizat, grupurile, rangul — niciodată peste imagine; apoi (v2) linia de
 * status, cipurile aplicațiilor (clan, ELO, VIP), nivelul cu bara de XP; bio-ul, câmpurile „pe card”, cele 4 contoare,
 * ultimele insigne și acțiunile (`actions`). Fără `v2`, markup-ul e cel al șablonului implicit `members.hover_card`.
 */
export function GcsHoverCard({
  data,
  labels,
  format,
  actions,
  id,
  v2Labels,
}: {
  data: GcsHoverCardData;
  labels: GcsHoverCardLabels;
  format: { number: (n: number) => string; year: (iso: string) => string; relative?: (iso: string) => string };
  actions?: ReactNode;
  id?: string;
  v2Labels?: GcsHoverCardV2Labels;
}) {
  const { user, stats } = data;
  const accent = user.accentColor ?? GCS_BRAND.color.dark.accent;
  const symbol = rankSymbol(user.rank?.icon);
  const look = data.look ?? null;
  const v2 = data.v2 && v2Labels ? data.v2 : null;
  const cover = user.cover
    ? `center ${user.coverPositionY ?? 50}% / cover no-repeat url(${user.cover})`
    : `linear-gradient(120deg, ${tint(accent, 0.55, "rgba(214,40,57,.55)")}, ${tint(accent, 0.12, "rgba(214,40,57,.12)")})`;
  const groupColor = user.group.color && HEX.test(user.group.color) ? user.group.color : null;
  const badgeList =
    data.badges.length > 0 ? (
      <ul className="gcs-hoverCard__badges" aria-label={v2 ? v2Labels!.badges : "Badges"}>
        {data.badges.map((b) => (
          <li key={b.key} title={b.description ? `${b.name}: ${b.description}` : b.name} className="gcs-badgeArt__item">
            <GcsBadgeArt badge={b} size={v2 ? 24 : 32} />
          </li>
        ))}
      </ul>
    ) : null;
  return (
    <div className={v2 ? "gcs-card gcs-hoverCard gcs-hoverCard--v2" : "gcs-card gcs-hoverCard"} role="dialog" aria-label={user.name} id={id} data-testid="gcs-hover-card">
      <div
        className={user.cover || look?.card ? "gcs-hoverCard__cover gcs-hoverCard__cover--image" : "gcs-hoverCard__cover"}
        style={{ "--gcs-hoverCard-accent": accent, ...(look?.card ?? { background: cover }) } as CSSProperties}
        data-testid="gcs-hover-cover"
        {...(look?.card ? { "data-vip": "card" } : {})}
      />
      <div className="gcs-hoverCard__body">
        <div className="gcs-hoverCard__head">
          <span className="gcs-hoverCard__avatar" {...(v2 && groupColor ? { style: { "--gcs-hoverCard-ring": groupColor } as CSSProperties } : {})}>
            <GcsAvatar name={user.name} size="l" userId={user.id} {...(user.image ? { src: user.image } : {})} {...(user.frameKey ? { frame: user.frameKey } : {})} />
            {v2 && (v2.status.kind === "online" || v2.status.kind === "playing") && <span className="gcs-hoverCard__dot" aria-hidden="true" data-testid="gcs-hover-dot" />}
          </span>
          <div className="gcs-hoverCard__identity">
            <GcsMemberName userId={user.id} name={user.name} nameKey={user.nameKey} href={`/members/${user.id}-${user.slug}`} size="full" hoverCard={false} className="gcs-hoverCard__name" title={user.name} />
            <div className="gcs-hoverCard__meta">
              {!v2 && data.clan && <GcsClanTag clan={data.clan} size="sm" testId="gcs-hover-clan" />}
              {/* Banner-ul VIP înlocuiește pastila grupului când e același plan (fără dublură). */}
              {!(look?.banner && sameLabel(look.banner.label, user.group.name)) &&
                (user.group.id ? (
                  <GcsGroupPill
                    bare
                    className="gcs-badge gcs-hoverCard__group"
                    style={{ "--gcs-hoverCard-group": user.group.color ?? "var(--gcs-muted)" } as CSSProperties}
                    group={{ id: user.group.id, name: user.group.name, color: user.group.color }}
                    href={user.group.href ?? null}
                    {...(user.group.tooltip ? { tooltip: user.group.tooltip } : {})}
                    {...(user.group.ariaLabel ? { ariaLabel: user.group.ariaLabel } : {})}
                    data-testid="gcs-hover-group"
                  >
                    {user.group.name}
                  </GcsGroupPill>
                ) : (
                  <span className="gcs-badge gcs-hoverCard__group" style={{ "--gcs-hoverCard-group": user.group.color ?? "var(--gcs-muted)" } as CSSProperties}>
                    {user.group.name}
                  </span>
                ))}
              {data.secondaryGroups?.map((g) => (
                <GcsGroupPill key={g.id} group={g} href={g.href} tooltip={g.tooltip} ariaLabel={g.ariaLabel} size="sm" data-testid="gcs-hover-secondary-group" />
              ))}
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
              {!v2 && data.online.online && (
                <span className="gcs-hoverCard__online">
                  <span className="gcs-dot" aria-hidden="true" />
                  {labels.online}
                </span>
              )}
            </div>
          </div>
        </div>
        {v2 && <HoverStatus status={v2.status} labels={v2Labels!} relative={format.relative} />}
        {v2 && v2.chips.length > 0 && (
          <div className="gcs-hoverCard__chips" data-testid="gcs-hover-chips">
            {v2.chips.map((c) =>
              c.kind === "clan" ? (
                <span key="clan" className="gcs-hoverCard__chip gcs-hoverCard__chip--clan" data-testid="gcs-hover-chip-clan">
                  {data.clan ? <GcsClanTag clan={data.clan} size="sm" testId="gcs-hover-clan" /> : <b>[{c.tag}]</b>}
                  <span>{c.name}</span>
                </span>
              ) : c.kind === "elo" ? (
                <span key="elo" className="gcs-hoverCard__chip gcs-hoverCard__chip--elo" data-tier={c.tier} data-testid="gcs-hover-chip-elo">
                  {v2Labels!.elo(format.number(c.elo), c.tier)}
                </span>
              ) : (
                <span
                  key="vip"
                  className="gcs-hoverCard__chip gcs-hoverCard__chip--vip"
                  style={c.color && HEX.test(c.color) ? ({ "--gcs-hoverCard-chip": c.color } as CSSProperties) : undefined}
                  title={c.name}
                  data-testid="gcs-hover-chip-vip"
                >
                  {v2Labels!.vip}
                </span>
              ),
            )}
          </div>
        )}
        {v2 && (
          <div className="gcs-hoverCard__level" data-testid="gcs-hover-level">
            <div className="gcs-hoverCard__levelHead">
              <strong>{v2Labels!.level(v2.level.level, v2.level.rank)}</strong>
              <span>{v2.level.next ? `${v2.level.percent}%` : v2Labels!.maxLevel}</span>
            </div>
            <div
              className="gcs-hoverCard__bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={v2.level.percent}
              aria-label={v2.level.next ? v2Labels!.nextLevel(v2.level.next.name) : v2Labels!.maxLevel}
            >
              <span style={{ width: `${v2.level.percent}%` }} />
            </div>
          </div>
        )}
        {user.bio && <p className="gcs-hoverCard__bio">{user.bio}</p>}
        {!v2 && badgeList}
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
        {v2 && badgeList && (
          <div className="gcs-hoverCard__badgeRow" data-testid="gcs-hover-badges">
            <span className="gcs-hoverCard__badgeLabel">{v2Labels!.badges}</span>
            {badgeList}
            <a href={`${v2.profileHref}?tab=badges`} className="gcs-hoverCard__more">
              {v2Labels!.allBadges}
              <span aria-hidden="true"> →</span>
            </a>
          </div>
        )}
        {actions && <div className="gcs-hoverCard__actions">{actions}</div>}
      </div>
    </div>
  );
}

/** Linia de status a cardului v2: online acum, „Joacă pe <server>” (link spre server), ultima vizită. */
function HoverStatus({ status, labels, relative }: { status: GcsHoverCardV2["status"]; labels: GcsHoverCardV2Labels; relative: ((iso: string) => string) | undefined }) {
  if (status.kind === "hidden") return null;
  return (
    <p className="gcs-hoverCard__status" data-kind={status.kind} data-testid="gcs-hover-status">
      <span className="gcs-hoverCard__statusDot" aria-hidden="true" />
      {status.kind === "online" && labels.onlineNow}
      {status.kind === "playing" && (
        <a href={status.href} className="gcs-hoverCard__server">
          {labels.playing(status.server)}
        </a>
      )}
      {status.kind === "lastVisit" && labels.lastVisit(relative ? relative(status.at) : new Date(status.at).toLocaleDateString())}
    </p>
  );
}
