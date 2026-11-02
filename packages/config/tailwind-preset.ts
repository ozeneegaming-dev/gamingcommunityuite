/**
 * Tokenurile vizuale GamingCommunitySuite ca valori TypeScript (ex. pentru grafice sau OG images).
 *
 * Tailwind v4 se configurează din CSS: tema efectivă e în `@gcs/ui/theme.css` (`@theme inline`),
 * iar variabilele în `@gcs/ui/tokens.css`, generat din brandul GCS (`packages/core/src/themes/brand.ts`, sursa unică).
 * Valorile de aici trebuie să rămână identice cu cele ale brandului (modul întunecat).
 */
export const gcsTokens = {
  bg: "#0B0F17",
  surface: "#151922",
  surface2: "#1A1F29",
  border: "#1E2533",
  text: "#CED5DE",
  muted: "#7E8999",
  accent: "#DF390C",
  accentInk: "#FF6A3D",
  ok: "#2ECC71",
  warn: "#F2B33D",
} as const;

export const gcsFonts = {
  display: '"DM Sans", system-ui, sans-serif',
  text: '"DM Sans", system-ui, sans-serif',
} as const;
