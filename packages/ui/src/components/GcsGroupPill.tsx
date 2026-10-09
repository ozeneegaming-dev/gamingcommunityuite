"use client";

import type { CSSProperties, ReactNode } from "react";
import { GcsTooltip } from "./GcsTooltip";

/** Un grup pe o pastilă: id-ul (linkul spre membrii lui), numele, culoarea și, opțional, iconița deja desenată. */
export type GcsGroupPillData = { id: number; name: string; color: string | null };

export type GcsGroupPillProps = {
  group: GcsGroupPillData;
  /** Iconița grupului (desenată de cine folosește pastila, ex. `<GcsIcon name="fa-solid fa-crown" />`). */
  icon?: ReactNode;
  /**
   * Linkul spre membrii grupului; implicit `/members?group=<id>`. `null` = grup ascuns (fără pagină): pastila nu e link.
   */
  href?: string | null;
  /**
   * Rândurile tooltip-ului, în ordine: descrierea scurtă (dacă există), numărătoarea („31 membri · 7 online acum”) și,
   * opțional, un rând de detaliu dat de o aplicație (ex. serverele pe care un admin e activ).
   */
  tooltip?: readonly string[];
  /** Eticheta accesibilă (ex. „Membrii grupului Moderator · 4 membri · 1 online acum”). */
  ariaLabel?: string;
  /** Mărimea: `sm` (rândul grupurilor secundare), `md` (implicit), `lg` (grupul afișat, plin). */
  size?: "sm" | "md" | "lg";
  /** `soft` = nuanța culorii (implicit), `filled` = culoarea plină (grupul afișat în postbit). */
  variant?: "soft" | "filled";
  /** Clasa locului (legenda, postbit, hover card); `bare` = doar clasa locului, fără aspectul pastilei. */
  className?: string;
  bare?: boolean;
  style?: CSSProperties;
  /** Conținutul vizibil (implicit iconița și numele). */
  children?: ReactNode;
  "data-testid"?: string;
  /** Marcajul aspectului VIP (banner-ul din postbit), păstrat pe element. */
  "data-vip"?: string;
};

/**
 * Pastila unui grup, la fel peste tot (legenda, postbit, hover card, profil, lista de membri, staff): un link spre
 * membrii grupului, cu culoarea și iconița lui, focus vizibil și un tooltip cu numărătoarea (hover și focus din
 * tastatură). Un grup ascuns (fără pagină de membri) rămâne doar o etichetă.
 */
export function GcsGroupPill({ group, icon, href, tooltip, ariaLabel, size = "md", variant = "soft", className, bare, style, children, ...rest }: GcsGroupPillProps) {
  const link = href === undefined ? `/members?group=${group.id}` : href;
  const cls = [bare ? null : `gcs-groupPill gcs-groupPill--${size} gcs-groupPill--${variant}`, className].filter(Boolean).join(" ");
  const css = { ...(group.color ? { "--gcs-gp-color": group.color } : {}), ...style } as CSSProperties;
  const content = children ?? (
    <>
      {icon && <span className="gcs-groupPill__icon">{icon}</span>}
      <span className="gcs-groupPill__name">{group.name}</span>
    </>
  );
  const el = link ? (
    <a href={link} className={cls} style={css} aria-label={ariaLabel} data-group-pill={group.id} data-testid={rest["data-testid"]} data-vip={rest["data-vip"]}>
      {content}
    </a>
  ) : (
    <span className={cls} style={css} aria-label={ariaLabel} data-group-pill={group.id} data-testid={rest["data-testid"]} data-vip={rest["data-vip"]} tabIndex={tooltip?.length ? 0 : undefined}>
      {content}
    </span>
  );
  if (!tooltip || tooltip.length === 0) return el;
  return (
    <GcsTooltip
      className="gcs-tooltip--group"
      content={
        <span className="gcs-groupTip">
          {tooltip.map((line, i) => (
            <span key={i} className={i === tooltip.length - 1 && tooltip.length > 1 ? "gcs-groupTip__line gcs-groupTip__line--last" : "gcs-groupTip__line"}>
              {line}
            </span>
          ))}
        </span>
      }
    >
      {el}
    </GcsTooltip>
  );
}
