import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Nume stilizate peste tot (specul 2026-10-10-nume-mentiuni-grupuri-peste-tot): orice nume de membru din site și din
 * ACP trece prin componenta comună (`GcsMemberName`, sau `GcsMemberLink` pe server pentru datele care au doar id și
 * nume). Testul caută în surse linkurile spre profil și clasele numelor scrise de mână; un loc nou care le folosește
 * fără componentă pică, până când e migrat sau trecut (cu motivul) în listele de mai jos.
 */
const root = path.resolve(__dirname, "../../..");
const SCAN = ["apps/web/app", "apps/web/lib", "packages/ui/src"];
const SKIP = new Set(["node_modules", ".next", "dist", "coverage"]);

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

const rel = (f: string) => path.relative(root, f).replace(/\\/g, "/");
const sources = SCAN.flatMap((d) => files(path.join(root, d))).map((f) => ({ file: rel(f), lines: readFileSync(f, "utf8").split("\n") }));

/** Componenta comună: singurul loc care scrie markup-ul numelui. */
const COMPONENT = "packages/ui/src/components/GcsMemberName.tsx";

/**
 * Clasa `gcs-name--<cheie>` folosită direct pentru altceva decât numele unui membru: numele grupurilor (legenda,
 * staff-ul, ACP-ul), planurile VIP, previzualizarea stilurilor alese în Setări / ACP.
 */
const GROUP_STYLE_FILES = new Set([
  "apps/web/app/(site)/_components/widgets/GcsStatsPanel.tsx",
  "apps/web/app/(site)/staff/page.tsx",
  "apps/web/app/(site)/members/page.tsx",
  "apps/web/app/(site)/members/groups/page.tsx",
  "apps/web/app/(site)/vip/page.tsx",
  "apps/web/app/(site)/_components/settings/GcsSettingsForms.tsx",
  "apps/web/app/admin/(panel)/community/chat/settings/page.tsx",
  "apps/web/app/admin/(panel)/community/chat-pro/bar/GcsChatProBarEditor.tsx",
  "apps/web/app/admin/(panel)/groups/GroupOrder.tsx",
  "apps/web/app/admin/(panel)/groups/[id]/page.tsx",
  "apps/web/app/admin/(panel)/permissions/[containerType]/[containerId]/PermissionMatrix.tsx",
  "apps/web/app/admin/(panel)/vip/name-styles/page.tsx",
  "apps/web/app/admin/(panel)/vip/tiers/page.tsx",
  "packages/ui/src/components/GcsGroupCard.tsx",
  "packages/ui/src/components/GcsGroupPill.tsx",
]);

/** Linkuri spre profil care nu sunt numele: avatarul (ascuns cititoarelor de ecran) sau un buton „Profil”. */
const isNotAName = (line: string) => /aria-hidden="true"|tabIndex=\{-1\}|profileHref|\?tab=|gcs-btn|GcsButton|>\{t\(/.test(line);

describe("numele membrilor trec prin componenta comună", () => {
  test("nicio clasă `gcs-userLink` scrisă de mână în componente", () => {
    const found = sources.flatMap(({ file, lines }) =>
      file === COMPONENT ? [] : lines.flatMap((l, i) => (/["'`\s]gcs-userLink\b/.test(l) ? [`${file}:${i + 1}: ${l.trim().slice(0, 140)}`] : [])),
    );
    expect(found).toEqual([]);
  });

  test("clasa `gcs-name--` scrisă de mână doar pentru grupuri, planuri și previzualizări", () => {
    const found = sources.flatMap(({ file, lines }) =>
      file === COMPONENT || GROUP_STYLE_FILES.has(file) ? [] : lines.flatMap((l, i) => (/gcs-name--\$\{/.test(l) ? [`${file}:${i + 1}: ${l.trim().slice(0, 140)}`] : [])),
    );
    expect(found).toEqual([]);
  });

  test("linkurile spre profilul unui membru sunt numele lui prin `GcsMemberName` / `GcsMemberLink` (sau avatarul)", () => {
    const found: string[] = [];
    for (const { file, lines } of sources) {
      lines.forEach((l, i) => {
        if (!/href=\{(?:memberHref\(|`\/members\/\$\{)/.test(l)) return;
        // Elementul începe pe linia lui sau cu cel mult patru linii mai sus.
        const ctx = lines.slice(Math.max(0, i - 4), i + 1).join(" ");
        if (/<GcsMemberName\b|<GcsMemberLink\b|<GcsAvatar\b/.test(ctx) || isNotAName(ctx) || /^\s*(?:profile|href|profileHref):/.test(l)) return;
        found.push(`${file}:${i + 1}: ${l.trim().slice(0, 140)}`);
      });
    }
    expect(found).toEqual([]);
  });

  test("componenta comună e folosită în locurile cerute (forum, widget-uri, postbit, membri, chat, meniul userului)", () => {
    const uses = (file: string) => sources.find((s) => s.file === file)?.lines.some((l) => /<GcsMemberName\b|<GcsMemberLink\b|<GcsNamedText\b/.test(l)) ?? false;
    for (const file of [
      "apps/web/app/(site)/_components/forum/GcsForumRow.tsx",
      "apps/web/app/(site)/_components/widgets/registry.tsx",
      "apps/web/app/(site)/_components/topic/GcsPost.tsx",
      "apps/web/app/(site)/_components/members/GcsMemberCard.tsx",
      "apps/web/app/(site)/_components/chat/GcsChatRoom.tsx",
      "apps/web/app/(site)/_components/chat-pro/GcsChatProMessage.tsx",
      // Meniul userului din antet (constructorul de antet, în orice temă).
      "apps/web/app/(site)/_components/header/GcsAccountMenu.tsx",
      "apps/web/app/(site)/members/[ref]/page.tsx",
      "packages/ui/src/components/GcsHoverCard.tsx",
      "packages/ui/src/editor/mentionList.tsx",
    ]) {
      expect([file, uses(file)]).toEqual([file, true]);
    }
  });
});
