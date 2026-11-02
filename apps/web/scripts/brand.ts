/**
 * Rescrie fișierele generate din brandul GCS (`packages/core/src/themes/brand.ts`), singura sursă a tokenilor:
 * `packages/ui/src/tokens.css`, `docs/brand/gcs-brand.css` (panourile PHP) și `docs/brand/gcs-mark.svg`.
 *
 * Folosire: `pnpm --filter @gcs/web brand`. Testul `brand.test.ts` din core pică până când fișierele sunt la zi.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brandMarkSvg, brandPanelCss, brandTokensCss } from "@gcs/core/themes";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const files: [string, string][] = [
  ["packages/ui/src/tokens.css", brandTokensCss()],
  ["docs/brand/gcs-brand.css", brandPanelCss()],
  ["docs/brand/gcs-mark.svg", `${brandMarkSvg()}\n`],
];
for (const [rel, content] of files) {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  console.log(`[GCS] ${rel}`);
}
