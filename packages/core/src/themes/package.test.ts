import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsForbidden, GcsValidationError } from "../errors";
import type { GcsActor } from "../permissions/types";
import { sanitizeThemeCssReport } from "./css";
import { GcsThemeCssService } from "./files";
import { THEME_PACKAGE_FORMAT, buildThemePackage, parseThemePackage } from "./package";
import { GcsThemeService } from "./service";
import { NOVA_THEME_SETTINGS } from "./settings";

let w: GcsTestWorld;
let themes: GcsThemeService;
let css: GcsThemeCssService;
let root: GcsActor;
let member: GcsActor;

beforeEach(async () => {
  w = await createWorld([]);
  themes = new GcsThemeService({ db: w.db, cache: w.cache, bus: w.bus, acp: w.acp });
  css = new GcsThemeCssService({ db: w.db, bus: w.bus, acp: w.acp });
  await w.db.$transaction((tx) => GcsThemeService.seedDefault(tx));
  root = await w.actorFor(await w.createUser("Root", "root_admin"));
  member = await w.actorFor(await w.createUser("Ana", "member"));
});

afterAll(async () => {
  await w.db.$disconnect();
});

const pkg = (extra: Record<string, unknown> = {}) => ({
  format: THEME_PACKAGE_FORMAT,
  version: 1,
  key: "neon",
  name: "Neon",
  settings: { preset: "nova", dark: { accent: "#8B5CF6" } },
  cssFiles: [{ name: "neon.css", content: ".gcs-nova .gcs-card { outline: 1px solid red; }" }],
  ...extra,
});

describe("parseThemePackage", () => {
  test("refuză fișierele care nu sunt pachete de temă sau au altă versiune", () => {
    expect(parseThemePackage({ hello: 1 })).toEqual({ ok: false, errors: { package: "invalid_theme_package" } });
    expect(parseThemePackage([])).toEqual({ ok: false, errors: { package: "invalid_theme_package" } });
    expect(parseThemePackage(pkg({ version: 2 }))).toEqual({ ok: false, errors: { version: "unsupported_theme_package" } });
  });

  test("validează numele, cheia, setările și fișierele CSS", () => {
    const res = parseThemePackage(
      pkg({
        key: "Bad Key",
        name: "",
        settings: { dark: { accent: "red" }, nope: 1 },
        cssFiles: [
          { name: "a.css", content: "" },
          { name: "a.css", content: "" },
          { name: "../x.css", content: "" },
          { name: "big.css", content: "x".repeat(50_001) },
        ],
      }),
    );
    expect(res.ok).toBe(false);
    expect(!res.ok && res.errors).toEqual({
      key: "invalid_key",
      name: "invalid_length",
      "settings.dark.accent": "invalid_color",
      "settings.nope": "unknown_setting",
      "cssFiles.1.name": "taken",
      "cssFiles.2.name": "invalid_css_name",
      "cssFiles.3.content": "too_long",
    });
  });

  test("imaginile site-ului sursă nu trec în pachet", () => {
    const res = parseThemePackage(pkg({ settings: { header: { image: "/files/abc", video: "/files/clip" }, logo: { imageLight: "/files/def" } } }));
    expect(res.ok && res.value.settings).toEqual({ header: { image: null, video: null }, logo: { imageLight: null, imageMobile: null, imageMobileLight: null } });
  });
});

describe("GcsThemeService: import / export", () => {
  test("exportul are setările și fișierele CSS, fără imagini; importul îl reface ca temă nouă, inactivă", async () => {
    await themes.saveDraft(root, "gcs-dark", { header: { image: "/files/hero1" }, dark: { accent: "#8B5CF6" } });
    await themes.publish(root, "gcs-dark");
    const file = await css.create(root, "gcs-dark", "extra.css");
    await css.save(root, "gcs-dark", file.id, ".gcs-nova .gcs-btn { letter-spacing: 1px; }");

    const exported = await themes.exportPackage(root, "gcs-dark");
    expect(exported.format).toBe(THEME_PACKAGE_FORMAT);
    expect(exported.settings.header?.image).toBeNull();
    expect(exported.settings.dark?.accent).toBe("#8B5CF6");
    expect(exported.cssFiles.map((f) => f.name)).toEqual(["extra.css"]);

    // Cheia ocupată primește un sufix.
    const imported = await themes.importPackage(root, JSON.parse(JSON.stringify(exported)));
    expect(imported.key).toBe("gcs-dark-2");
    expect(imported.enabled).toBe(false);
    expect(imported.isDefault).toBe(false);
    expect(imported.settings.dark.accent).toBe("#8B5CF6");
    expect(imported.settings.header.image).toBeNull();
    const files = await css.files("gcs-dark-2");
    expect(files.map((f) => f.name)).toEqual(["custom.css", "extra.css"]);
    expect(files[1]!.content).toContain("letter-spacing: 1px");
    expect((await w.db.auditLog.findMany({ where: { action: "theme.import" } })).length).toBe(1);
  });

  test("setările lipsă vin din designul pachetului; CSS-ul e sanitizat", async () => {
    const imported = await themes.importPackage(root, pkg({ cssFiles: [{ name: "neon.css", content: ".a { background: url(javascript:alert(1)); }</style>" }] }));
    expect(imported.key).toBe("neon");
    expect(imported.settings.preset).toBe("nova");
    expect(imported.settings.dark.accent).toBe("#8B5CF6");
    expect(imported.settings.dark.bg).toBe(NOVA_THEME_SETTINGS.dark.bg);
    const content = (await css.files("neon")).find((f) => f.name === "neon.css")!.content;
    expect(content).not.toMatch(/javascript:|</);
  });

  test("un pachet invalid nu creează nimic; membrii nu pot importa sau exporta", async () => {
    const before = await w.db.theme.count();
    await expect(themes.importPackage(root, pkg({ settings: { radius: 99 } }))).rejects.toBeInstanceOf(GcsValidationError);
    await expect(themes.importPackage(member, pkg())).rejects.toBeInstanceOf(GcsForbidden);
    await expect(themes.exportPackage(member, "gcs-dark")).rejects.toBeInstanceOf(GcsForbidden);
    expect(await w.db.theme.count()).toBe(before);
  });

  test("exportul și importul păstrează tema identică (dus-întors)", async () => {
    const nova = (await themes.get("gcs-dark"))!;
    const again = await themes.importPackage(root, buildThemePackage(nova));
    expect(again.settings).toEqual(nova.settings);
  });
});

/** Selectorii unei reguli (virgulele din `:is(...)` / `:has(...)` nu despart). */
function splitSelectors(list: string): string[] {
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
  return [...out, cur.trim()].filter(Boolean);
}

describe("temele livrate ca pachete (`themes/`)", () => {
  const dir = path.resolve(__dirname, "../../../../themes/redline-official");
  const bundled = () => JSON.parse(readFileSync(path.join(dir, "redline-official.gcs-theme.json"), "utf8")) as Record<string, unknown>;

  test("RED-LINE OFFICIAL: pachetul e valid, la zi cu sursele și CSS-ul trece de sanitizare neatins", () => {
    const res = parseThemePackage(bundled());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const src = JSON.parse(readFileSync(path.join(dir, "theme.json"), "utf8")) as { cssFiles: string[]; settings: unknown };
    expect(res.value.settings).toMatchObject(src.settings as object);
    expect(res.value.cssFiles.map((f) => f.name)).toEqual(src.cssFiles);
    for (const f of res.value.cssFiles) {
      expect(f.content).toBe(readFileSync(path.join(dir, "css", f.name), "utf8").trim());
      expect(sanitizeThemeCssReport(f.content).removed).toEqual([]);
      // Totul sub designul Nova al temei: nimic nu ajunge în ACP sau în designul clasic.
      for (const rule of f.content.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(^|})\s*([^{}@]+)\{/g)) {
        const selectors = splitSelectors(rule[2]!);
        for (const sel of selectors) if (!/^(from|to|\d+%)$/.test(sel)) expect(sel).toMatch(/^html\.gcs-nova/);
      }
    }
  });

  test("RED-LINE OFFICIAL se importă și se compilează", async () => {
    const theme = await themes.importPackage(root, bundled());
    expect(theme.key).toBe("redline-official");
    expect(theme.name).toBe("RED-LINE OFFICIAL");
    expect(theme.settings.preset).toBe("nova");
    const compiled = themes.css(theme);
    expect(compiled).toContain("fonts.googleapis.com/css2?family=Rajdhani");
    expect(compiled).toContain("--gcs-accent: #8B3DFF;");
    expect(compiled).toContain("html.gcs-nova .gcs-siteHeader::after");
  });
});
