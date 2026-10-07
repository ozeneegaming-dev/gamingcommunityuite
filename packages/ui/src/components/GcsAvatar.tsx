import { cx } from "../cx";

export type GcsAvatarSize = "xs" | "s" | "m" | "l" | "xl";

/** Mărimile din machete, în pixeli (spec §9: xs, s, m, l, xl). */
export const GCS_AVATAR_SIZES: Record<GcsAvatarSize, number> = { xs: 24, s: 34, m: 40, l: 104, xl: 168 };

/** Fundalurile avatarelor fără imagine, din machete; culoarea se alege stabil după nume. */
const AVATAR_BACKGROUNDS = ["#4B2A82", "#3F4652", "#7A5410", "#8A1E2B", "#1E4F7A", "#1F6B4F", "#5A2D6E", "#6B3A1E"];

function backgroundFor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return AVATAR_BACKGROUNDS[hash % AVATAR_BACKGROUNDS.length]!;
}

export type GcsAvatarProps = {
  name: string;
  src?: string;
  size: GcsAvatarSize;
  /** Cheia ramei (ex. `neon`, `gold`, `fire`) → clasa `gcs-avatarFrame--{frame}`. */
  frame?: string;
  /**
   * Id-ul membrului → `data-avatar-user`: rama publicată de un plugin (aspectul membrului, Studio VIP) se pune peste
   * avatar din CSS-ul generat. Nu e `data-user-id`, ca avatarul să nu deschidă hover card-ul.
   */
  userId?: string;
  className?: string;
};

export function GcsAvatar({ name, src, size, frame, userId, className }: GcsAvatarProps) {
  const px = GCS_AVATAR_SIZES[size];
  const initial = [...name.trim()][0]?.toUpperCase() ?? "?";
  const inner = (
    <span
      className={cx("gcs-avatar", `gcs-avatar--${size}`, !frame && className)}
      data-avatar-user={userId}
      style={{
        ...(frame ? {} : { width: px, height: px }),
        ...(src ? {} : { background: backgroundFor(name) }),
        fontSize: Math.max(10, Math.round(px * 0.4)),
      }}
    >
      {src ? <img src={src} alt={name} className="gcs-avatar__img" /> : <span aria-hidden="true">{initial}</span>}
      {!src && <span className="gcs-srOnly">{name}</span>}
    </span>
  );

  if (!frame) return inner;
  return (
    <span className={cx("gcs-avatarFrame", `gcs-avatarFrame--${frame}`, className)} style={{ width: px, height: px }}>
      {inner}
    </span>
  );
}
