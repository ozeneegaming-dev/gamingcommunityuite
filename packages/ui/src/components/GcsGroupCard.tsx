import type { CSSProperties } from "react";
import { GcsAvatar } from "./GcsAvatar";

/** Datele SVG ale iconiței grupului (rezolvată pe server din numele Font Awesome). */
export type GcsGroupCardIcon = { width: number; height: number; path: string };

/** Cardul unui grup menționat (Mențiuni v2), cum îl trimite `GET /api/groups/{id}/card`. */
export type GcsGroupCardData = {
  group: {
    id: number;
    key: string;
    name: string;
    /** Descrierea scurtă (titlul grupului din ACP). */
    title: string | null;
    color: string | null;
    /** Banner-ul grupului din postbit (culoare sau gradient validat), folosit ca bandă a cardului. */
    banner: string | null;
    icon: GcsGroupCardIcon | null;
  };
  memberCount: number;
  onlineCount: number;
  /** Primii membri (cei online primii, statusul ascuns respectat); goală dacă viewer-ul nu vede lista de membri. */
  members: { id: string; name: string; image: string | null; nameKey: string; href: string; online: boolean }[];
  canListMembers: boolean;
  /** Lista de membri filtrată pe grup („Vezi toți”). */
  href: string;
};

export type GcsGroupCardLabels = { members: string; online: string; seeAll: string; empty: string };

const HEX = /^#[0-9A-Fa-f]{6}$/;

/**
 * Hover card-ul unui grup: banda în culoarea (sau banner-ul) grupului cu iconița, numele stilizat și descrierea,
 * contoarele (membri, online acum), primii membri și linkul spre lista completă. Același strat ca hover card-ul unui
 * membru (`GcsHoverCardHost`); numele membrilor nu au `data-user-id`, ca să nu deschidă alt card peste acesta.
 */
export function GcsGroupCard({ data, labels, format }: { data: GcsGroupCardData; labels: GcsGroupCardLabels; format: { number: (n: number) => string } }) {
  const { group } = data;
  const color = group.color && HEX.test(group.color) ? group.color : null;
  const style = {
    ...(color ? { "--gcs-groupCard-color": color } : {}),
    ...(group.banner ? { "--gcs-groupCard-band": group.banner } : {}),
  } as CSSProperties;
  return (
    <div className="gcs-card gcs-hoverCard gcs-groupCard" role="dialog" aria-label={group.name} style={style} data-testid="gcs-group-card">
      <div className="gcs-groupCard__band" aria-hidden="true">
        <span className="gcs-groupCard__icon">
          {group.icon ? (
            <svg viewBox={`0 0 ${group.icon.width} ${group.icon.height}`} focusable="false">
              <path fill="currentColor" d={group.icon.path} />
            </svg>
          ) : (
            <span className="gcs-groupCard__initial">{[...group.name.trim()][0]?.toUpperCase() ?? "@"}</span>
          )}
        </span>
      </div>
      <div className="gcs-groupCard__body">
        <div className="gcs-groupCard__identity">
          <a href={data.href} className={`gcs-groupCard__name gcs-name--${group.key}`} data-testid="gcs-group-card-name">
            {group.name}
          </a>
          {group.title && group.title !== group.name && <p className="gcs-groupCard__title">{group.title}</p>}
        </div>
        <div className="gcs-groupCard__stats">
          <div>
            <strong data-testid="gcs-group-card-members">{format.number(data.memberCount)}</strong>
            {labels.members}
          </div>
          <div className="gcs-groupCard__onlineStat">
            <strong data-testid="gcs-group-card-online">{format.number(data.onlineCount)}</strong>
            <span>
              <span className="gcs-dot" aria-hidden="true" />
              {labels.online}
            </span>
          </div>
        </div>
        {data.canListMembers &&
          (data.members.length > 0 ? (
            <ul className="gcs-groupCard__members" aria-label={labels.members}>
              {data.members.map((m) => (
                <li key={m.id} className="gcs-groupCard__member" data-online={m.online ? "true" : undefined}>
                  <span className="gcs-groupCard__avatar">
                    <GcsAvatar name={m.name} size="xs" {...(m.image ? { src: m.image } : {})} />
                    {m.online && <span className="gcs-groupCard__dot" role="img" aria-label={labels.online} />}
                  </span>
                  <a href={m.href} className={`gcs-userLink gcs-name--${m.nameKey}`} data-name-user={m.id} data-text={m.name}>
                    {m.name}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="gcs-groupCard__empty">{labels.empty}</p>
          ))}
        {data.canListMembers && (
          <a href={data.href} className="gcs-groupCard__all" data-testid="gcs-group-card-all">
            {labels.seeAll}
          </a>
        )}
      </div>
    </div>
  );
}
