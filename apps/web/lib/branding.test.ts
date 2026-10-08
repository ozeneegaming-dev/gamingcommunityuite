import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Regula de bază a proprietarului (2026-10-06): platforma e doar GamingCommunitySuite (GCS). Nicio denumire sau
 * legătură spre alte platforme de comunitate în texte, cod, comentarii sau stiluri.
 * „IPS” se caută doar cu majuscule: `ips` / „IPs” înseamnă adrese IP și e permis.
 */
const BRANDS = [/\bIPS\b/, /invision/i, /indungi/i, /ipsappzone/i, /xenforo/i, /vbulletin/i, /phpbb/i];

const root = path.resolve(__dirname, "../../..");
// `servers-plugins`: pluginurile serverelor de joc (Pawn, C#), serverul fals și documentația lor.
const SCAN = ["apps/web/app", "apps/web/lib", "apps/web/messages", "apps/web/e2e", "apps/realtime/src", "apps/worker/src", "packages", "servers-plugins"];
const SKIP = new Set(["node_modules", ".next", "dist", "coverage", ".turbo", "generated", "bin", "obj"]);
const EXT = /\.(ts|tsx|mts|mjs|css|json|prisma|sql|sma|inc|cs|csproj|md|cfg|ps1|sh)$/;

function files(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    // Folderele cu punct (`.pgtest` cu datele PostgreSQL ale testelor, `.turbo`) nu sunt surse și se schimbă în timpul rulării.
    if (SKIP.has(name) || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (EXT.test(name) && !full.endsWith("branding.test.ts")) out.push(full);
  }
  return out;
}

describe("brandul GCS", () => {
  test("nicio denumire de altă platformă în surse și texte", () => {
    const found: string[] = [];
    for (const dir of SCAN) {
      for (const file of files(path.join(root, dir))) {
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (BRANDS.some((re) => re.test(line))) found.push(`${path.relative(root, file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
          });
      }
    }
    expect(found).toEqual([]);
  });
});
