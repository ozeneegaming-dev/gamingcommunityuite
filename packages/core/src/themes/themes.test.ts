import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsConflict, GcsForbidden, GcsValidationError } from "../errors";
import type { GcsActor } from "../permissions/types";
import { compileThemeCss, sanitizeThemeCss } from "./css";
import { DEFAULT_THEME_SETTINGS, GcsThemeService, normalizeThemeSettings } from "./service";

let w: GcsTestWorld;
let themes: GcsThemeService;
let root: GcsActor;
let member: GcsActor;

beforeEach(async () => {
  w = await createWorld([]);
  themes = new GcsThemeService({ db: w.db, cache: w.cache, bus: w.bus, acp: w.acp });
  await w.db.$transaction((tx) => GcsThemeService.seedDefault(tx));
  root = await w.actorFor(await w.createUser("Root", "root_admin"));
  member = await w.actorFor(await w.createUser("Ana", "member"));
});

afterAll(async () => {
  await w.db.$disconnect();
});

describe("sanitizeThemeCss", () => {
  test("scoate HTML-ul, vectorii de execuție, @import străin și url-urile externe nesigure", () => {
    const out = sanitizeThemeCss(
      [
        "</style><script>alert(1)</script>",
        "@charset 'utf-8';",
        "@import url('https://evil.example/x.css');",
        '@import url("https://fonts.googleapis.com/css2?family=Inter&display=swap");',
        ".a { width: expression(alert(1)); background: url(javascript:alert(1)); }",
        ".b { -moz-binding: url(x.xml#xss); behavior: url(x.htc); }",
        ".c { background: url(http://insecure.example/a.png); }",
        ".d { background: url('/files/abc123'); } .e { background: url(https://cdn.example/a.png); }",
      ].join("\n"),
    );
    expect(out).not.toContain("<");
    expect(out).not.toMatch(/expression\s*\(/i);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/-moz-binding/i);
    expect(out).not.toMatch(/behavior\s*:/i);
    expect(out).not.toContain("@charset");
    expect(out).not.toContain("evil.example");
    expect(out).toContain("fonts.googleapis.com");
    expect(out).not.toContain("insecure.example");
    expect(out).toContain("url('/files/abc123')");
    expect(out).toContain("url(https://cdn.example/a.png)");
  });

  test("CSS-ul compilat are paletele dark/light, modul auto și fontul ales", () => {
    const css = compileThemeCss({ ...DEFAULT_THEME_SETTINGS, fontText: "Inter", radius: 6 }, ".x{color:red}");
    expect(css).toContain("html:root {");
    expect(css).toContain('html[data-theme="light"]');
    expect(css).toContain('html[data-theme="auto"]');
    expect(css).toContain("family=Inter");
    expect(css).not.toContain("family=Manrope");
    expect(css).toContain("--gcs-radius: 6px;");
    expect(css).toContain(".x{color:red}");
  });

  test("setările stricate revin la valorile implicite", () => {
    const s = normalizeThemeSettings({ dark: { bg: "red", accent: "#112233" }, fontText: "Comic Sans", radius: 99 });
    expect(s.dark.bg).toBe(DEFAULT_THEME_SETTINGS.dark.bg);
    expect(s.dark.accent).toBe("#112233");
    expect(s.fontText).toBe(DEFAULT_THEME_SETTINGS.fontText);
    expect(s.radius).toBe(DEFAULT_THEME_SETTINGS.radius);
  });
});

describe("GcsThemeService", () => {
  test("refuză culorile, fonturile și fișierele invalide", async () => {
    const err = await themes.saveDraft(root, "default", { dark: { bg: "red" }, fontDisplay: "Papyrus", logoUrl: "https://x.example/a.png" }).catch((e) => e);
    expect(err).toBeInstanceOf(GcsValidationError);
    expect((err as GcsValidationError).fields).toMatchObject({ "dark.bg": "invalid_color", fontDisplay: "invalid_choice", logoUrl: "invalid" });
  });

  test("un membru nu poate edita teme", async () => {
    await expect(themes.saveDraft(member, "default", { radius: 4 })).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("draft-ul nu schimbă CSS-ul public; publicarea îl aplică și crește versiunea", async () => {
    await themes.saveDraft(root, "default", { dark: { accent: "#123456" }, customCss: ".z{color:blue}</style>" });
    const before = await themes.active();
    expect(before.version).toBe(1);
    expect(themes.css(before)).not.toContain("#123456");
    expect(themes.css(before, { draft: true })).toContain("#123456");
    expect(themes.css(before, { draft: true })).not.toContain("</style>");

    const published = await themes.publish(root, "default");
    expect(published.version).toBe(2);
    expect(published.draft).toBeNull();
    expect(themes.css(await themes.active())).toContain("--gcs-accent: #123456;");
    expect(await w.db.auditLog.count({ where: { action: "theme.publish" } })).toBe(1);

    await expect(themes.publish(root, "default")).rejects.toBeInstanceOf(GcsConflict);
  });

  test("renunțarea la draft păstrează tema publicată", async () => {
    await themes.saveDraft(root, "default", { radius: 2 });
    await themes.discardDraft(root, "default");
    const t = await themes.active();
    expect(t.draft).toBeNull();
    expect(t.settings.radius).toBe(DEFAULT_THEME_SETTINGS.radius);
  });

  test("membrul alege doar dintre temele active; tema implicită nu poate fi dezactivată sau ștearsă", async () => {
    await themes.create(root, { key: "neon", name: "Neon", from: "default" });
    expect((await themes.active("neon")).key).toBe("neon");
    await themes.update(root, "neon", { enabled: false });
    expect((await themes.active("neon")).key).toBe("default");
    expect((await themes.active("nu-exista")).key).toBe("default");

    await expect(themes.update(root, "default", { enabled: false })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(themes.remove(root, "default")).rejects.toBeInstanceOf(GcsValidationError);

    await themes.update(root, "neon", { isDefault: true });
    expect((await themes.active()).key).toBe("neon");
    await themes.remove(root, "default");
    expect((await themes.list()).map((t) => t.key)).toEqual(["neon"]);
  });

  test("cheile invalide sau duplicate sunt refuzate", async () => {
    await expect(themes.create(root, { key: "Bad Key", name: "X" })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(themes.create(root, { key: "default", name: "X" })).rejects.toBeInstanceOf(GcsValidationError);
  });
});
