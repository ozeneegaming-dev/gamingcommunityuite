import type { GcsSeedContext } from "@gcs/core";

/** Reacțiile implicite (specul etapei 2, §2). Greutatea se adună la reputația autorului. */
export const DEFAULT_REACTIONS = [
  { key: "like", label: "Like", symbol: "▲", color: "#FF6B74", weight: 1 },
  { key: "gg", label: "GG", symbol: "GG", color: "#F4B740", weight: 1 },
  { key: "thanks", label: "Mulțumesc", symbol: "♥", color: "#FF7AC6", weight: 1 },
  { key: "haha", label: "Haha", symbol: "😂", color: "#F4B740", weight: 0 },
  { key: "disagree", label: "Dezacord", symbol: "👎", color: "#A1A7B4", weight: -1 },
] as const;

/** Datele implicite ale forumului. Idempotent: nu suprascrie modificările din ACP. */
export async function seedForums({ tx }: GcsSeedContext): Promise<void> {
  await tx.reaction.createMany({
    data: DEFAULT_REACTIONS.map((r, position) => ({ ...r, position })),
    skipDuplicates: true,
  });
}
