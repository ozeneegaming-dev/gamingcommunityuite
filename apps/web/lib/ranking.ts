/**
 * Clasamentul compact (panoul „Top” al consolei și widget-ul „Clasament”; specul 2026-10-10-hero-cockpit §4): primele
 * trei locuri sunt mereu aur / argint / bronz (trofeul într-o insignă nuanțată, rândul nuanțat cu chenar și lumină,
 * inelul pe avatar, valoarea colorată), de la 4 în jos numărul stă într-o insignă neutră. Fără dependențe de server.
 */
import type { GcsLeaderboardPeriod } from "@gcs/modules";

export const RANKING_METRICS = ["posts", "topics", "reputation", "online", "players", "clans"] as const;
export type GcsRankingMetric = (typeof RANKING_METRICS)[number];
/** Tab-urile panoului „Top” din consolă și ale widget-ului din coloana laterală. */
export const COCKPIT_METRICS: readonly GcsRankingMetric[] = ["posts", "players", "clans", "online"];
export const WIDGET_METRICS: readonly GcsRankingMetric[] = ["posts", "topics", "reputation", "online"];
/** Tab-urile „Comunitate” ale widget-ului („Topul săptămânii” din coloana îngustă a primei pagini). */
export const COMMUNITY_METRICS: readonly GcsRankingMetric[] = ["posts", "players", "clans"];

export type GcsRankingRow = {
  rank: number;
  value: number;
  name: string;
  href: string;
  /** Membrul (numele stilizat, avatarul); `null` = un jucător nelegat sau un clan. */
  user: { id: string; name: string; nameKey: string; image: string | null; frameKey: string | null } | null;
  /** Linia mică (grupul membrului). */
  sub: string | null;
  color?: string | null;
};

export type GcsRankingResult = { metric: GcsRankingMetric; period: GcsLeaderboardPeriod; rows: GcsRankingRow[]; you: { rank: number; value: number } | null };

export type GcsMedal = "gold" | "silver" | "bronze";

/** Medalia locului (1–3, după poziția în listă: egalitățile la vârf păstrează ordinea aur, argint, bronz). */
export function medalFor(index: number): GcsMedal | null {
  return index === 0 ? "gold" : index === 1 ? "silver" : index === 2 ? "bronze" : null;
}

/** Măsurile fără perioadă (clasamentele aplicațiilor au sezonul lor). */
export const periodless = (m: GcsRankingMetric) => m === "players" || m === "clans";
