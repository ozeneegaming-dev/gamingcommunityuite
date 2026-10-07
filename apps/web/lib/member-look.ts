import "server-only";
import { appearanceBannerStyle, appearanceCardStyle, appearanceThemeVars, type GcsMemberAppearance } from "@gcs/core";
import type { CSSProperties } from "react";
import { cache } from "react";
import { pluginHost, safeModeActive } from "./plugins";
import { services } from "./services";

/**
 * Aspectul unui membru publicat de pluginuri (Studio VIP), gata de randat în structura existentă a postbit-ului, a
 * hover card-ului și a profilului: stilurile sunt calculate de GCS din valori validate (culori, poziții), niciodată CSS
 * venit de la plugin. Numele și rama vin din `/gcs-names.css`; aici sunt doar elementele din pagină.
 */
export type GcsMemberLook = {
  banner: { label: string; style: CSSProperties } | null;
  card: CSSProperties | null;
  flair: { icon: string; label: string } | null;
  profile: {
    background: { image: string; video: string | null; position: string; dim: number } | null;
    quote: string | null;
    theme: CSSProperties | null;
    song: { title: string; artist: string | null; audio: string | null; youtube: string | null; autoplayMuted: boolean } | null;
  };
};

export function lookOf(a: GcsMemberAppearance): GcsMemberLook {
  const p = a.profile ?? {};
  return {
    banner: a.banner ? { label: a.banner.label ?? "VIP", style: appearanceBannerStyle(a.banner) as CSSProperties } : null,
    card: a.card ? (appearanceCardStyle(a.card) as CSSProperties) : null,
    flair: a.flair ? { icon: a.flair.icon, label: a.flair.label } : null,
    profile: {
      background: p.background?.image ? { image: p.background.image, video: p.background.video ?? null, position: `${p.background.x ?? 50}% ${p.background.y ?? 50}%`, dim: p.background.dim ?? 45 } : null,
      quote: p.quote?.text ?? null,
      theme: p.theme ? (appearanceThemeVars(p.theme) as CSSProperties) : null,
      song: p.song ? { title: p.song.title, artist: p.song.artist ?? null, audio: p.song.audio ?? null, youtube: p.song.youtube ?? null, autoplayMuted: p.song.autoplayMuted === true } : null,
    },
  };
}

/** Aspectul unui membru, o dată pe request (gol în modul sigur al pluginurilor sau fără pluginuri cu aspect). */
export const memberLook = cache(async (userId: string | null | undefined): Promise<GcsMemberLook | null> => {
  if (!userId) return null;
  await pluginHost();
  if (await safeModeActive()) return null;
  const a = await services()
    .appearance.forUser(userId)
    .catch(() => null);
  return a ? lookOf(a) : null;
});
