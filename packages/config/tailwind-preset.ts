/**
 * Tokenurile vizuale GamingCommunitySuite ca valori TypeScript (ex. pentru grafice sau OG images).
 *
 * Tailwind v4 se configurează din CSS: tema efectivă e în `@gcs/ui/theme.css` (`@theme inline`),
 * iar variabilele în `@gcs/ui/tokens.css`. Valorile de aici trebuie să rămână identice cu cele din `tokens.css`.
 */
export const gcsTokens = {
  bg: "#0B0C10",
  surface: "#14161C",
  surface2: "#1B1E26",
  border: "#262A34",
  text: "#ECEDF1",
  muted: "#A1A7B4",
  accent: "#D62839",
  accentInk: "#FF6B74",
  ok: "#3DDC97",
  warn: "#F4B740",
} as const;

export const gcsFonts = {
  display: '"Chakra Petch", sans-serif',
  text: "Manrope, system-ui, sans-serif",
} as const;
