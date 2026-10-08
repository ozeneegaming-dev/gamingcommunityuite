import type { CSSProperties } from "react";

type LogoClan = { tag: string; logoUrl: string | null; color: string; color2: string; ink: string };

/** Variabilele CSS cu culorile clanului (validate `#RRGGBB` în server): plăcuța, rama logo-ului, degradeul bannerului. */
export function clanColors(clan: { color: string; color2: string; ink: string }): CSSProperties {
  return { "--gcs-clan-color": clan.color, "--gcs-clan-color2": clan.color2, "--gcs-clan-ink": clan.ink } as CSSProperties;
}

/**
 * Logo-ul clanului (pătrat, cu rama în culoarea lui); fără imagine, primele litere ale tagului pe degradeul culorilor.
 * Decorativ: numele clanului e mereu lângă el.
 */
export function GcsClanLogo({ clan, size = "m", eager = false }: { clan: LogoClan; size?: "s" | "m" | "l"; eager?: boolean }) {
  const classes = `gcs-clanLogo${size === "m" ? "" : ` gcs-clanLogo--${size}`}${clan.logoUrl ? "" : " gcs-clanLogo--empty"}`;
  return (
    <span className={classes} style={clanColors(clan)} aria-hidden="true">
      {clan.logoUrl ? <img src={clan.logoUrl} alt="" loading={eager ? "eager" : "lazy"} decoding="async" /> : [...clan.tag].slice(0, 3).join("")}
    </span>
  );
}
