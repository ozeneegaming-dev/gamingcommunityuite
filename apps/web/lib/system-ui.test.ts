import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Paza „SYSTEM UI” (regula de bază a proprietarului, 2026-10-16): orice funcție merge în ORICE temă; o temă doar
 * schimbă aspectul. Testul pică dacă:
 * 1. CSS-ul de bază al unei componente funcționale (antetul construit și panourile lui, meniurile, consola, bara de
 *    jos, clasamentul, săgeata de restrângere, plăcile de moderare…) stă doar sub `.gcs-nova` (designul GCS);
 * 2. codul aplicației ascunde o funcție după design (`preset === "nova"`). Excepțiile: `designClass()` (clasa
 *    designului pe `<html>`), emițătorul regulilor decorative din CSS-ul compilat și alegerea valorilor implicite /
 *    a setărilor de decor ale designului.
 */
const root = path.resolve(__dirname, "../../..");
const ui = (f: string) => readFileSync(path.join(root, "packages/ui/src", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Lista unui selector, despărțită doar la virgulele din afara parantezelor. */
function splitTop(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
/** Selectorii tuturor regulilor (și din `@media`), fără cadrele animațiilor. */
const selectors = (css: string) =>
  [...css.matchAll(/(?:^|[{};])\s*([^{}@;]+)\{/g)].flatMap((m) => splitTop(m[1]!)).filter((s) => s && !/^(from|to|\d+%)$/.test(s));
const classes = (sel: string) => [...sel.matchAll(/\.(gcs-[\w-]+)/g)].map((m) => m[1]!).filter((c) => c !== "gcs-nova");

/** Componentele funcționale: CSS-ul lor de bază trebuie să existe în afara designului GCS. */
const FUNCTIONAL = [
  /^gcs-hb(__|--|$)/,
  /^gcs-mega__/,
  /^gcs-msgMenu/,
  /^gcs-createMenu/,
  /^gcs-am(__|--|$)/,
  /^gcs-sp(__|--|$)/,
  /^gcs-mbar/,
  /^gcs-xpRing/,
  /^gcs-liveSummary/,
  /^gcs-hbSeg/,
  /^gcs-ck(__|Wrap|$)/,
  /^gcs-rank(__|--|$)/,
  /^gcs-collapseToggle/,
  /^gcs-modTile/,
  /^gcs-attachList/,
  /^gcs-plainList/,
  /^gcs-arrowLink/,
  /^gcs-drawer/,
  /^gcs-dropdown/,
  /^gcs-tooltip/,
  /^gcs-mentionList/,
  /^gcs-modal/,
  /^gcs-carousel/,
  /^gcs-podium/,
  /^gcs-groupCard/,
  /^gcs-hoverCard/,
  /^gcs-statsPanel/,
  /^gcs-server(Row|List|Totals)/,
  /^gcs-chatPro/,
  // Pachetul de finisare: listele, statisticile forumurilor, loaderele, banda de derulare, bara de anunț, blocul vizitatorilor.
  /^gcs-category__well/,
  /^gcs-forumRow__(statsTool|statsBtn|bubble|when)/,
  /^gcs-spinner/,
  /^gcs-loading/,
  /^gcs-scrollRail/,
  /^gcs-annBar/,
  /^gcs-guestCta/,
  // Notificări v2: clopoțelul, pagina, tabelul canalelor, web push, rezumatul săptămânal și cardurile ACP.
  /^gcs-notif/,
  /^gcs-prefGrid/,
  /^gcs-pushCard/,
  /^gcs-weekly/,
  /^gcs-acpNotif/,
];
/**
 * Clase care apar sub `.gcs-nova` doar ca decor (modificatori fără CSS de bază propriu): grafica antetului „Standard”
 * (imaginea cu stratul închis) și chenarul la hover al mesajelor Chat Pro în stilul „carduri”.
 */
const DECORATIVE = new Set<string>(["gcs-hb--classic", "gcs-chatPro--cards"]);

const SYSTEM_FILES = readdirSync(path.join(root, "packages/ui/src")).filter((f) => f.endsWith(".css") && f !== "nova.css");

describe("system UI: CSS-ul componentelor funcționale e al sistemului", () => {
  const systemClasses = new Set(SYSTEM_FILES.flatMap((f) => selectors(ui(f)).filter((s) => !s.includes(".gcs-nova")).flatMap(classes)));
  const novaSelectors = selectors(ui("nova.css"));

  test("nicio componentă funcțională nu are CSS doar sub `.gcs-nova`", () => {
    const novaOnly = [...new Set(novaSelectors.flatMap(classes))].filter((c) => FUNCTIONAL.some((re) => re.test(c)) && !systemClasses.has(c) && !DECORATIVE.has(c));
    expect(novaOnly).toEqual([]);
  });

  test("fișierele sistemului nu depind de design: fără `.gcs-nova` în system-ui.css, header-menus.css, sweep.css și fișierele pachetului de finisare", () => {
    for (const f of ["system-ui.css", "header-menus.css", "sweep.css", "lists.css", "loaders.css", "scroll.css", "announce.css", "notifications.css"]) expect(selectors(ui(f)).filter((s) => s.includes("gcs-nova"))).toEqual([]);
  });

  test("notificările v2 sunt ale sistemului: dropdown-ul clopoțelului, pagina, tabelul canalelor, web push", () => {
    for (const c of ["gcs-notifMenu__panel", "gcs-notifTabs__tab", "gcs-notifRow", "gcs-notifFilter", "gcs-prefGrid__row", "gcs-pushCard", "gcs-weekly", "gcs-acpNotif__card"]) {
      expect(systemClasses.has(c), c).toBe(true);
    }
  });

  test("antetul construit, panourile, consola și bara de jos au CSS-ul de bază în sistem", () => {
    for (const c of ["gcs-hb", "gcs-hb__panel", "gcs-hb__menuItem", "gcs-mega__panel", "gcs-msgMenu__panel", "gcs-am__panel", "gcs-sp__panel", "gcs-mbar", "gcs-ck", "gcs-rank__row", "gcs-collapseToggle", "gcs-modTile"]) {
      expect(systemClasses.has(c), c).toBe(true);
    }
  });

  test("pachetul de finisare e al sistemului: listele, statisticile, tooltip-ul, loaderele, banda de derulare, bara de anunț, blocul vizitatorilor", () => {
    for (const c of ["gcs-category__well", "gcs-forumRow__statsBtn", "gcs-forumRow__bubble", "gcs-tooltip", "gcs-spinner", "gcs-scrollRail", "gcs-scrollRail__btn", "gcs-annBar", "gcs-guestCta"]) {
      expect(systemClasses.has(c), c).toBe(true);
    }
  });

  test("ordinea: sistemul se încarcă înaintea designului GCS (care doar îl restilizează), sweep-ul la final", () => {
    const globals = readFileSync(path.join(root, "apps/web/app/globals.css"), "utf8");
    const at = (f: string) => globals.indexOf(`@import "@gcs/ui/${f}";`);
    expect(at("system-ui.css")).toBeGreaterThan(at("titles.css"));
    expect(at("header-menus.css")).toBeGreaterThan(at("system-ui.css"));
    expect(at("nova.css")).toBeGreaterThan(at("header-menus.css"));
    for (const f of ["lists.css", "loaders.css", "scroll.css", "announce.css", "notifications.css"]) {
      expect(at(f), f).toBeGreaterThan(at("header-menus.css"));
      expect(at(f), f).toBeLessThan(at("nova.css"));
    }
    expect(at("sweep.css")).toBeGreaterThan(at("nova.css"));
  });
});

describe("system UI: nicio funcție nu depinde de design", () => {
  const SCAN = ["apps/web/app", "apps/web/lib", "packages/core/src", "packages/modules/src"];
  const SKIP = new Set(["node_modules", ".next", "dist", "coverage"]);
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      if (SKIP.has(name) || name.startsWith(".")) return [];
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
    });
  /** Singurele locuri unde contează designul: clasa lui, decorul din CSS-ul compilat, valorile implicite. */
  const ALLOWED = new Set(["apps/web/lib/theme-preview.ts", "packages/core/src/themes/css.ts", "packages/core/src/themes/settings.ts"]);
  const GATE = /preset\s*[!=]==?\s*["']nova["']|["']nova["']\s*[!=]==?\s*[\w.]*preset/;

  test("codul nu ascunde funcții după `preset === \"nova\"` (doar clasa designului și decorul)", () => {
    const bad = SCAN.flatMap((d) => walk(path.join(root, d)))
      .map((f) => path.relative(root, f).replace(/\\/g, "/"))
      .filter((f) => !ALLOWED.has(f))
      .flatMap((f) =>
        readFileSync(path.join(root, f), "utf8")
          .split("\n")
          .map((line, i) => ({ line, i }))
          .filter(({ line }) => GATE.test(line))
          .map(({ i }) => `${f}:${i + 1}`),
      );
    expect(bad).toEqual([]);
  });

  test("în fișierele permise, designul alege doar clasa, decorul și valorile implicite", () => {
    const count = (f: string) => readFileSync(path.join(root, f), "utf8").split("\n").filter((l) => GATE.test(l)).length;
    expect(count("apps/web/lib/theme-preview.ts")).toBe(1);
    expect(count("packages/core/src/themes/css.ts")).toBe(1);
    expect(count("packages/core/src/themes/settings.ts")).toBe(2);
  });
});
