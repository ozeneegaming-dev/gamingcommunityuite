import type { CSSProperties } from "react";
import { cx } from "../cx";

/** Ce trebuie pentru plăcuța tagului unui clan (culorile vin validate `#RRGGBB`, textul calculat din contrast). */
export type GcsClanTagData = { tag: string; name: string; href?: string | null; color: string; color2: string; ink: string };

export type GcsClanTagProps = {
  clan: GcsClanTagData;
  size?: "sm" | "md" | "lg";
  /** Fără link (ex. în antetul paginii clanului). */
  plain?: boolean;
  className?: string;
  testId?: string;
};

const HEX = /^#[0-9A-Fa-f]{6}$/;
const safe = (v: string, fallback: string) => (HEX.test(v) ? v : fallback);

/**
 * Plăcuța tagului (specul 2026-10-08-clanuri §1): tagul pe culoarea principală a clanului, cu două colțuri teșite și o
 * dungă în culoarea secundară. Același element peste tot: directorul, pagina clanului, postbit-ul, hover card-ul,
 * profilul, widget-ul. Numele clanului e în `title` și pentru cititoarele de ecran.
 */
export function GcsClanTag({ clan, size = "md", plain = false, className, testId }: GcsClanTagProps) {
  const style = {
    "--gcs-clan-color": safe(clan.color, "#D62839"),
    "--gcs-clan-color2": safe(clan.color2, "#1B1E26"),
    "--gcs-clan-ink": safe(clan.ink, "#FFFFFF"),
  } as CSSProperties;
  const classes = cx("gcs-clanTag", size !== "md" && `gcs-clanTag--${size}`, className);
  const label = `[${clan.tag}] ${clan.name}`;
  if (plain || !clan.href) {
    return (
      <span className={classes} style={style} title={clan.name} data-testid={testId}>
        <span aria-hidden="true">{clan.tag}</span>
        <span className="gcs-srOnly">{label}</span>
      </span>
    );
  }
  return (
    <a className={classes} style={style} href={clan.href} title={clan.name} aria-label={label} data-testid={testId}>
      {clan.tag}
    </a>
  );
}
