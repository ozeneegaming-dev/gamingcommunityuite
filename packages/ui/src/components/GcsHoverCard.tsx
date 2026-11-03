import { GCS_BRAND } from "@gcs/core/themes";
import { GcsClanTag, type GcsClanTagData } from "./GcsClanTag";
import { Children, type CSSProperties, type ReactNode } from "react";
import { cx } from "../cx";
import { GcsAvatar } from "./GcsAvatar";
import { GcsBadgeArt } from "./GcsBadgeArt";
import { GcsButton, type GcsButtonProps } from "./GcsButton";
import { GcsMemberName } from "./GcsMemberName";
import { GcsGroupPill } from "./GcsGroupPill";

/** Datele SVG ale iconiței unui grup (rezolvată pe server din numele Font Awesome; registrul nu ajunge în browser). */
export type GcsHoverCardIcon = { width: number; height: number; path: string };

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
    /**
     * Grupul afișat; cu `id`, pastila e un link spre membrii lui (`href`), cu tooltip-ul numărătorii. `icon`: iconița
     * grupului (rândul grupului din cardul v3).
     */
    group: { id?: number; name: string; color: string | null; href?: string | null; tooltip?: string[]; ariaLabel?: string; icon?: GcsHoverCardIcon | null };
    rank: { name: string; icon: string | null } | null;
  };
  /** `badges`: numărul tuturor insignelor (cardul v3); lipsă = câte insigne recente au venit. */
  stats: { posts: number; reputation: number; followers: number; joinedAt: string; badges?: number };
  online: { online: boolean };
  /**
   * `art` = adresa insignei generate; `image` = imaginea proprie încărcată în ACP (are prioritate); `color` = culoarea
   * insignei (cercul din cardul v3); `awardedAt` = data obținerii (ultima realizare).
   */
  badges: { key: string; name: string; description?: string; art: string; image: string | null; color?: string; awardedAt?: string }[];
  fields: { label: string; value: string }[];
  /**
   * Aspectul publicat de pluginuri (Studio VIP), cu stilurile deja calculate de GCS din valori validate: banner-ul de
   * sub nume, fundalul copertei și arma (iconița și numele).
   */
  look?: { banner: { label: string; style: CSSProperties; className?: string } | null; card: CSSProperties | null; flair: { icon: string; label: string } | null } | null;
  /** Tagul clanului membrului (aplicația Clanuri, dacă opțiunile îl arată pe hover card). */
  clan?: GcsClanTagData | null;
  /** Grupurile secundare vizibile (pastilele mici de după grupul afișat; rândul „Alte grupuri” în cardul v3). */
  secondaryGroups?: { id: number; name: string; color: string | null; href: string | null; tooltip: string[]; ariaLabel: string; icon?: GcsHoverCardIcon | null }[];
  /**
   * Cardul bogat (v3, cardul de membru aprobat pe 2026-11-03): linia de status, cipurile aplicațiilor, rangul cu nivelul
   * și emblema, linkul profilului. Lipsă = cardul clasic (același markup ca șablonul implicit `members.hover_card`).
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
  /** Emblema rangului (insigna desenată sau imaginea încărcată în ACP), pe plăcuța rândului rangului. */
  rankEmblem?: { art: string; image: string | null } | null;
};

export type GcsHoverCardLabels = { posts: string; reputation: string; followers: string; online: string; joined: string; weapon?: string };

/** Textele cardului bogat (funcțiile primesc valorile deja formatate). */
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
  /** „Înregistrat pe 14 octombrie 2024”. */
  registered: (date: string) => string;
  otherGroups: string;
  /** Textul de sub rang când nu există scara nivelurilor. */
  rank: string;
  /** „Obținută pe <data>” (ultima insignă, când membrul nu are rang). */
  badgeEarned: (date: string) => string;
};

function tint(hex: string | null, alpha: number, fallback: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? "");
  return m ? `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})` : fallback;
}

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v: string | null | undefined) => (v && HEX.test(v) ? v : null);

/** Două etichete la fel (fără diferențe de majuscule sau spații). */
const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Iconița rangului ca text (emoji); numele Font Awesome (`fa-…`) nu se afișează ca text. */
function rankSymbol(icon: string | null | undefined): string | null {
  return icon && !icon.startsWith("fa-") ? icon : null;
}

type Format = { number: (n: number) => string; year: (iso: string) => string; relative?: (iso: string) => string; date?: (iso: string) => string };

/**
 * Hover card-ul unui membru. Cu datele bogate (`v2`), cardul v3 aprobat pe 2026-11-03 (`HoverCardV3`): coperta sus,
 * avatarul mare centrat peste ea, identitatea, contoarele, celelalte grupuri, rangul cu insignele și acțiunile. Fără
 * ele, cardul clasic (specul „hover card și coperta în postbit”, 2026-10-07): același markup ca șablonul implicit
 * `members.hover_card`, de la care pornesc temele care îl modifică.
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
  format: Format;
  actions?: ReactNode;
  id?: string;
  v2Labels?: GcsHoverCardV2Labels;
}) {
  if (data.v2 && v2Labels) return <HoverCardV3 data={data} v2={data.v2} labels={labels} v2Labels={v2Labels} format={format} actions={actions} id={id} />;
  const { user, stats } = data;
  const accent = user.accentColor ?? GCS_BRAND.color.dark.accent;
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
            <GcsMemberName userId={user.id} name={user.name} nameKey={user.nameKey} href={`/members/${user.id}-${user.slug}`} size="full" hoverCard={false} className="gcs-hoverCard__name" title={user.name} />
            <div className="gcs-hoverCard__meta">
              {data.clan && <GcsClanTag clan={data.clan} size="sm" testId="gcs-hover-clan" />}
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
        {data.fields.length > 0 && <Fields fields={data.fields} />}
        <div className="gcs-hoverCard__stats">
          <div>
            <strong>{format.number(stats.posts)}</strong>
            {labels.posts}
          </div>
          <div>
            <strong className={stats.reputation >= 0 ? "gcs-rep--pos" : "gcs-rep--neg"}>{reputation(stats.reputation, format)}</strong>
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

const reputation = (n: number, format: Format) => (n > 0 ? `+${format.number(n)}` : format.number(n));

/** Câmpurile de profil „pe card” (cardul clasic: grila de 2 coloane). */
function Fields({ fields }: { fields: GcsHoverCardData["fields"] }) {
  return (
    <dl className="gcs-hoverCard__fields">
      {fields.map((f) => (
        <div key={f.label}>
          <dt>{f.label}</dt>
          <dd title={f.value}>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Iconița unui grup (datele SVG trimise de server), în culoarea textului din jur. */
function GroupIcon({ icon }: { icon: GcsHoverCardIcon | null | undefined }) {
  if (!icon) return <span className="gcs-hoverCard__groupDot" aria-hidden="true" />;
  return (
    <svg className="gcs-hoverCard__groupIcon" viewBox={`0 0 ${icon.width} ${icon.height}`} width="1em" height="1em" focusable="false" aria-hidden="true">
      <path fill="currentColor" d={icon.path} />
    </svg>
  );
}

/**
 * Cardul de membru v3 (macheta aprobată pe 2026-11-03): coperta de 75 px (imaginea profilului, fundalul ales în Studio
 * VIP sau degradeul din culoarea grupului), avatarul de 90 px centrat peste ea, decupat în culoarea cardului, cu rama
 * VIP și punctul online; numele în culoarea grupului, rândul grupului cu iconița, data înregistrării și statusul; cutia
 * cu Postări / Reputație / Insigne; „Alte grupuri” (doar dacă există), câmpurile „pe card”, rangul (sau ultima insignă)
 * cu ultimele insigne suprapuse; apoi acțiunile (`actions`, așezate cu `GcsHoverCardActions`). Nimic nu iese din card.
 */
function HoverCardV3({
  data,
  v2,
  labels,
  v2Labels,
  format,
  actions,
  id,
}: {
  data: GcsHoverCardData;
  v2: GcsHoverCardV2;
  labels: GcsHoverCardLabels;
  v2Labels: GcsHoverCardV2Labels;
  format: Format;
  actions: ReactNode;
  id: string | undefined;
}) {
  const { user, stats } = data;
  const look = data.look ?? null;
  // Culoarea cardului (coperta fără imagine, săgeata): a grupului afișat, apoi accentul membrului, apoi accentul temei (CSS).
  const tone = hex(user.group.color) ?? hex(user.accentColor);
  const image = Boolean(user.cover || look?.card);
  const date = format.date ?? ((iso: string) => new Date(iso).toLocaleDateString());
  const online = v2.status.kind === "online" || v2.status.kind === "playing";
  const vipReplacesGroup = Boolean(look?.banner && sameLabel(look.banner.label, user.group.name));
  const others = data.secondaryGroups ?? [];
  const rankName = user.rank?.name ?? v2.level.rank;
  const latest = data.badges[0] ?? null;
  const groupStyle = (color: string | null) => ({ "--gcs-hoverCard-group": hex(color) ?? "var(--gcs-muted)" }) as CSSProperties;
  const groupContent = (g: { name: string; icon?: GcsHoverCardIcon | null }) => (
    <>
      <GroupIcon icon={g.icon} />
      <span className="gcs-hoverCard__groupName">{g.name}</span>
    </>
  );
  return (
    <div
      className="gcs-card gcs-hoverCard gcs-hoverCard--v3"
      role="dialog"
      aria-label={user.name}
      id={id}
      data-testid="gcs-hover-card"
      data-banner={image ? "image" : "tone"}
      {...(tone ? { style: { "--gcs-hoverCard-tone": tone } as CSSProperties } : {})}
    >
      <div
        className={image ? "gcs-hoverCard__cover gcs-hoverCard__cover--image" : "gcs-hoverCard__cover"}
        {...(look?.card
          ? { style: look.card, "data-vip": "card" }
          : user.cover
            ? { style: { background: `center ${user.coverPositionY ?? 50}% / cover no-repeat url(${user.cover})` } }
            : {})}
        data-testid="gcs-hover-cover"
      />
      <div className="gcs-hoverCard__body">
        <span className="gcs-hoverCard__avatar">
          <GcsAvatar name={user.name} size="l" userId={user.id} {...(user.image ? { src: user.image } : {})} {...(user.frameKey ? { frame: user.frameKey } : {})} />
          {online && <span className="gcs-hoverCard__dot" aria-hidden="true" data-testid="gcs-hover-dot" />}
        </span>
        <div className="gcs-hoverCard__identity">
          <GcsMemberName userId={user.id} name={user.name} nameKey={user.nameKey} href={v2.profileHref} size="full" hoverCard={false} className="gcs-hoverCard__name" title={user.name} />
          <div className="gcs-hoverCard__meta">
            {/* Banner-ul VIP înlocuiește rândul grupului când e același plan (fără dublură). */}
            {!vipReplacesGroup &&
              (user.group.id ? (
                <GcsGroupPill
                  bare
                  className="gcs-hoverCard__group"
                  style={groupStyle(user.group.color)}
                  group={{ id: user.group.id, name: user.group.name, color: user.group.color }}
                  href={user.group.href ?? null}
                  {...(user.group.tooltip ? { tooltip: user.group.tooltip } : {})}
                  {...(user.group.ariaLabel ? { ariaLabel: user.group.ariaLabel } : {})}
                  data-testid="gcs-hover-group"
                >
                  {groupContent(user.group)}
                </GcsGroupPill>
              ) : (
                <span className="gcs-hoverCard__group" style={groupStyle(user.group.color)} data-testid="gcs-hover-group">
                  {groupContent(user.group)}
                </span>
              ))}
            {look?.banner && (
              <span className={`gcs-vipPill gcs-fx${look.banner.className ? ` ${look.banner.className}` : ""}`} style={look.banner.style} data-testid="gcs-hover-vip-banner">
                {look.banner.label}
              </span>
            )}
          </div>
          <span className="gcs-hoverCard__joined" data-testid="gcs-hover-joined">
            {v2Labels.registered(date(stats.joinedAt))}
          </span>
          <HoverStatus status={v2.status} labels={v2Labels} relative={format.relative} />
          {v2.chips.length > 0 && <Chips chips={v2.chips} clan={data.clan ?? null} labels={v2Labels} format={format} />}
          {user.bio && <p className="gcs-hoverCard__bio">{user.bio}</p>}
        </div>
        <div className="gcs-hoverCard__stats" data-testid="gcs-hover-stats">
          <div>
            <strong>{format.number(stats.posts)}</strong>
            <span>{labels.posts}</span>
          </div>
          <div>
            <strong className={stats.reputation >= 0 ? "gcs-rep--pos" : "gcs-rep--neg"}>{reputation(stats.reputation, format)}</strong>
            <span>{labels.reputation}</span>
          </div>
          <div>
            <strong data-testid="gcs-hover-badge-count">{format.number(stats.badges ?? data.badges.length)}</strong>
            <span>{v2Labels.badges}</span>
          </div>
          {look?.flair && (
            <div className="gcs-hoverCard__flair" title={look.flair.label} data-testid="gcs-hover-weapon">
              <img src={look.flair.icon} alt="" />
              <span>{labels.weapon ?? look.flair.label}</span>
            </div>
          )}
        </div>
        {(others.length > 0 || data.fields.length > 0 || rankName || latest) && (
          <div className="gcs-hoverCard__rows">
            {others.length > 0 && (
              <div className="gcs-hoverCard__row" data-testid="gcs-hover-other-groups">
                <span className="gcs-hoverCard__rowTitle">{v2Labels.otherGroups}</span>
                <span className="gcs-hoverCard__rowEnd">
                  {others.map((g) => (
                    <GcsGroupPill
                      key={g.id}
                      bare
                      className="gcs-hoverCard__group gcs-hoverCard__group--other"
                      style={groupStyle(g.color)}
                      group={g}
                      href={g.href}
                      tooltip={g.tooltip}
                      ariaLabel={g.ariaLabel}
                      data-testid="gcs-hover-secondary-group"
                    >
                      {groupContent(g)}
                    </GcsGroupPill>
                  ))}
                </span>
              </div>
            )}
            {data.fields.map((f) => (
              <div key={f.label} className="gcs-hoverCard__row" data-testid="gcs-hover-field">
                <span className="gcs-hoverCard__rowTitle">{f.label}</span>
                <span className="gcs-hoverCard__rowEnd gcs-hoverCard__rowValue" title={f.value}>
                  {f.value}
                </span>
              </div>
            ))}
            {(rankName || latest) && (
              <div className="gcs-hoverCard__row gcs-hoverCard__achievement" data-testid="gcs-hover-achievement">
                {rankName ? (
                  <RankLead name={rankName} symbol={rankSymbol(user.rank?.icon)} v2={v2} labels={v2Labels} />
                ) : (
                  latest && (
                    <>
                      <span className="gcs-hoverCard__tile" aria-hidden="true">
                        <GcsBadgeArt badge={latest} size={24} decorative />
                      </span>
                      <span className="gcs-hoverCard__tileText">
                        <b data-testid="gcs-hover-latest-badge">{latest.name}</b>
                        {latest.awardedAt && <span>{v2Labels.badgeEarned(date(latest.awardedAt))}</span>}
                      </span>
                    </>
                  )
                )}
                {data.badges.length > 0 && (
                  <a href={`${v2.profileHref}?tab=badges`} className="gcs-hoverCard__badgeStack" aria-label={v2Labels.allBadges} data-testid="gcs-hover-badges">
                    {data.badges.slice(0, 5).map((b) => (
                      <span
                        key={b.key}
                        className="gcs-badgeArt__item gcs-hoverCard__badge"
                        title={b.description ? `${b.name}: ${b.description}` : b.name}
                        {...(hex(b.color) ? { style: { "--gcs-hoverCard-badge": b.color } as CSSProperties } : {})}
                      >
                        <GcsBadgeArt badge={b} size={24} />
                      </span>
                    ))}
                  </a>
                )}
              </div>
            )}
          </div>
        )}
        {actions && <div className="gcs-hoverCard__actions">{actions}</div>}
      </div>
    </div>
  );
}

/** Rangul (cardul v3): plăcuța cu emblema, numele rangului, nivelul și bara de progres spre rangul următor. */
function RankLead({ name, symbol, v2, labels }: { name: string; symbol: string | null; v2: GcsHoverCardV2; labels: GcsHoverCardV2Labels }) {
  const { level } = v2;
  const emblem = v2.rankEmblem ?? null;
  return (
    <>
      <span className="gcs-hoverCard__tile" aria-hidden="true">
        {emblem ? <GcsBadgeArt badge={{ name, art: emblem.art, image: emblem.image }} size={24} decorative /> : <span className="gcs-hoverCard__tileSymbol">{symbol ?? [...name][0]?.toUpperCase()}</span>}
      </span>
      <span className="gcs-hoverCard__tileText" {...(level.level > 0 ? { "data-testid": "gcs-hover-level" } : {})}>
        <b data-testid="gcs-hover-rank">{name}</b>
        <span>{level.level > 0 ? (level.next ? `${labels.level(level.level, null)} · ${level.percent}%` : labels.maxLevel) : labels.rank}</span>
        {level.level > 0 && (
          <span
            className="gcs-hoverCard__bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={level.percent}
            aria-label={level.next ? labels.nextLevel(level.next.name) : labels.maxLevel}
          >
            <span style={{ width: `${level.percent}%` }} />
          </span>
        )}
      </span>
    </>
  );
}

/** Cipurile aplicațiilor (clan, ELO, VIP), sub status. */
function Chips({ chips, clan, labels, format }: { chips: GcsHoverCardChip[]; clan: GcsClanTagData | null; labels: GcsHoverCardV2Labels; format: Format }) {
  return (
    <div className="gcs-hoverCard__chips" data-testid="gcs-hover-chips">
      {chips.map((c) =>
        c.kind === "clan" ? (
          <span key="clan" className="gcs-hoverCard__chip gcs-hoverCard__chip--clan" data-testid="gcs-hover-chip-clan">
            {clan ? <GcsClanTag clan={clan} size="sm" testId="gcs-hover-clan" /> : <b>[{c.tag}]</b>}
            <span>{c.name}</span>
          </span>
        ) : c.kind === "elo" ? (
          <span key="elo" className="gcs-hoverCard__chip gcs-hoverCard__chip--elo" data-tier={c.tier} data-testid="gcs-hover-chip-elo">
            {labels.elo(format.number(c.elo), c.tier)}
          </span>
        ) : (
          <span
            key="vip"
            className="gcs-hoverCard__chip gcs-hoverCard__chip--vip"
            style={hex(c.color) ? ({ "--gcs-hoverCard-chip": c.color } as CSSProperties) : undefined}
            title={c.name}
            data-testid="gcs-hover-chip-vip"
          >
            {labels.vip}
          </span>
        ),
      )}
    </div>
  );
}

/** Linia de status: online acum, „Joacă pe <server>” (link spre server), ultima vizită. */
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

/**
 * Acțiunile cardului (slotul `actions`), așezate să încapă în lățimea lui la orice lățime: pe primul rând acțiunea
 * principală (`primary`, ex. Mesaj, cu eticheta întreagă, care ia restul rândului și se strânge cu „…” doar dacă nu mai
 * are loc) și butoanele-iconiță ale membrului (`tools`: Urmărește, Ignoră); sub el butoanele late (`wide`, ex.
 * „Găsește conținutul lui”, pe toată lățimea), apoi rândurile extensiilor (`extra`, ex. moderarea din chat), fiecare pe
 * rândul lui. Niciun buton nu rămâne singur pe un rând îngust și nu iese din card.
 */
export function GcsHoverCardActions({ primary, tools, wide, extra }: { primary?: ReactNode; tools?: ReactNode; wide?: ReactNode; extra?: ReactNode }) {
  const list = Children.toArray(tools);
  return (
    <>
      {(primary || list.length > 0) && (
        <div className="gcs-hoverCard__actionRow" data-testid="gcs-hover-actions">
          {primary}
          {list}
        </div>
      )}
      {wide}
      {extra}
    </>
  );
}

/**
 * Un buton-iconiță din acțiunile cardului (Urmărește, Ignoră, moderarea din chat…): eticheta e numele accesibil
 * (`aria-label`) și tooltip-ul sistemului (`data-tip`, la hover și la focus din tastatură). Cu `asChild`, copilul (ex.
 * un link `next/link`) primește stilul și iconița.
 */
export function GcsHoverCardIconAction({ label, icon, className, ...props }: Omit<GcsButtonProps, "variant" | "size" | "icon"> & { label: string; icon: ReactNode }) {
  return <GcsButton variant="ghost" size="sm" icon={icon} className={cx("gcs-hoverCard__iconBtn", className)} aria-label={label} data-tip={label} {...props} />;
}
