import { readFileSync } from "node:fs";
import { isBadgeShape, isBadgeTier, resolveBadgeArt } from "@gcs/ui/badge-art";
import { isGcsIcon } from "@gcs/ui/icon-registry";
import { describe, expect, test } from "vitest";
import { DEFAULT_BADGES } from "./seed";

const MIGRATION = new URL("../../../db/prisma/migrations/20261022000000_badge_art/migration.sql", import.meta.url);

/** Rândurile `('cheie', 'formă', 'nivel', 'iconiță')` din migrație. */
function migrationArt(): Record<string, { artShape: string; artTier: string; artIcon: string }> {
  const sql = readFileSync(MIGRATION, "utf8");
  const out: Record<string, { artShape: string; artTier: string; artIcon: string }> = {};
  for (const m of sql.matchAll(/\('([a-z0-9_]+)', '([a-z]+)', '([a-z]+)', '(fa-[a-z]+ fa-[a-z0-9-]+)'\)/g)) out[m[1]!] = { artShape: m[2]!, artTier: m[3]!, artIcon: m[4]! };
  return out;
}

describe("insignele badge-urilor implicite", () => {
  test("fiecare badge implicit are o formă, un nivel și o iconiță existentă (Font Awesome Free)", () => {
    for (const b of DEFAULT_BADGES) {
      expect(isBadgeShape(b.artShape), b.key).toBe(true);
      expect(isBadgeTier(b.artTier), b.key).toBe(true);
      expect(isGcsIcon(b.artIcon), b.key).toBe(true);
      expect(resolveBadgeArt(b).glyph, b.key).toMatchObject({ kind: "icon" });
    }
  });

  test("migrația dă instalărilor existente exact grafica din seed", () => {
    const fromSeed = Object.fromEntries(DEFAULT_BADGES.map((b) => [b.key, { artShape: b.artShape, artTier: b.artTier, artIcon: b.artIcon }]));
    expect(migrationArt()).toEqual(fromSeed);
  });

  test("culorile categoriilor din migrație sunt cele din seed", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    for (const m of sql.matchAll(/SET "color" = '(#[0-9A-F]{6})' WHERE "key" IN \(([^)]*)\)/g)) {
      for (const key of m[2]!.match(/[a-z0-9_]+/g)!) expect(DEFAULT_BADGES.find((b) => b.key === key)?.color, key).toBe(m[1]);
    }
  });

  test("formele spun categoria: postările sunt medalii, vechimea scuturi, comunitatea hexagoane", () => {
    const shape = (key: string) => DEFAULT_BADGES.find((b) => b.key === key)?.artShape;
    expect(["first_post", "posts_100", "posts_1000"].map(shape)).toEqual(["medal", "medal", "medal"]);
    expect(["member_1y", "member_3y"].map(shape)).toEqual(["shield", "shield"]);
    expect(["reputation_100", "top_helper"].map(shape)).toEqual(["hexagon", "hexagon"]);
    // Treptele aceleiași categorii urcă în metal.
    expect(["first_post", "posts_100", "posts_1000"].map((k) => DEFAULT_BADGES.find((b) => b.key === k)?.artTier)).toEqual(["bronze", "silver", "gold"]);
  });
});
