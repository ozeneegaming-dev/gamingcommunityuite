import { describe, expect, test } from "vitest";
import {
  HEADER_PRESETS,
  HEADER_ROWS,
  HEADER_ZONES,
  MOBILE_BAR_ITEMS,
  compactHeaderLayout,
  headerBuilderError,
  headerLayoutIsPreset,
  headerPreset,
  isHeaderElementKey,
  mobileBarError,
  moveHeaderElement,
  placedHeaderElements,
  splitNavItems,
  unusedHeaderElements,
  type GcsHeaderBuilder,
} from "./headerBuilder";
import { compileThemeCss } from "./css";
import { DEFAULT_THEME_SETTINGS, NOVA_THEME_SETTINGS, THEME_PRESETS, normalizeThemeSettings, themeDefaults, themeSettingsErrors, withThemePath } from "./settings";

const clone = <T>(v: T): T => structuredClone(v);

describe("constructorul de antet: elementele și presetările", () => {
  test("cheile elementelor: cele de bază și cele înregistrate de aplicații (`aplicație.element`)", () => {
    for (const key of ["logo", "nav", "navRight", "search", "searchField", "create", "messages", "notifications", "account", "breadcrumb", "serversLive", "social", "themeToggle", "language", "custom"]) {
      expect(isHeaderElementKey(key)).toBe(true);
    }
    expect(isHeaderElementKey("chat.button")).toBe(true);
    expect(isHeaderElementKey("servers.playNow")).toBe(true);
    expect(isHeaderElementKey("Logo")).toBe(false);
    expect(isHeaderElementKey("<script>")).toBe(false);
    expect(isHeaderElementKey("a.b.c")).toBe(false);
    expect(isHeaderElementKey("")).toBe(false);
  });

  test("fiecare presetare e validă pe toate dispozitivele, cu rândurile și zonele complete", () => {
    for (const name of HEADER_PRESETS) {
      const p = headerPreset(name);
      expect(p.preset).toBe(name);
      expect(headerBuilderError(p)).toBeNull();
      for (const device of ["desktop", "tablet", "mobile"] as const) {
        expect(Object.keys(p[device]).sort()).toEqual([...HEADER_ROWS].sort());
        for (const row of HEADER_ROWS) expect(Object.keys(p[device][row]).sort()).toEqual([...HEADER_ZONES].sort());
        // Logo-ul și navigația sunt mereu undeva (altfel antetul ar fi fără ieșire).
        expect(placedHeaderElements(p[device])).toEqual(expect.arrayContaining(["logo", "nav"]));
      }
    }
  });

  test("„Clasic” = antetul clasic de până acum: un rând (logo + meniu; căutarea, notificările, mesajele, contul), sertarul pe ecranele mici", () => {
    // Antetul temelor clasice de dinainte de constructor (`GcsSiteHeader`, ramura clasică): pe desktop logo-ul și meniul,
    // apoi uneltele (căutarea extensibilă, clopoțelul, mesajele, meniul userului); pe tabletă / mobil butonul sertarului
    // înaintea logo-ului; fără rândul cu breadcrumb-ul (ascuns pe designul clasic).
    const today = {
      top: { left: [], center: [], right: [] },
      main: { left: ["logo", "nav"], center: [], right: ["search", "notifications", "messages", "account"] },
      bottom: { left: [], center: [], right: [] },
    };
    const small = { ...today, main: { ...today.main, left: ["nav", "logo"] } };
    expect(headerPreset("basic")).toEqual({ preset: "basic", desktop: today, tablet: small, mobile: small, split: null });
    expect(HEADER_PRESETS[0]).toBe("basic");
  });

  test("Cockpit: logo + acțiunile în rândul 1, meniul în rândul 2 cu statusul serverelor în dreapta", () => {
    const p = headerPreset("cockpit");
    expect(p.desktop.main.left).toEqual(["logo"]);
    expect(p.desktop.main.right).toEqual(["search", "create", "messages", "notifications", "account"]);
    expect(p.desktop.bottom.left).toEqual(["nav"]);
    expect(p.desktop.bottom.right).toEqual(["serversLive"]);
  });

  test("Esports: sociale + cont sus, meniul împărțit în jurul logo-ului din centru, căutarea în dreapta; pe mobil meniu / logo / cont", () => {
    const p = headerPreset("esports");
    expect(p.desktop.top.left).toEqual(["social"]);
    expect(p.desktop.top.right).toEqual(["create", "messages", "notifications", "account"]);
    expect(p.desktop.main).toEqual({ left: ["nav"], center: ["logo"], right: ["navRight", "search"] });
    expect(p.mobile.main).toEqual({ left: ["nav"], center: ["logo"], right: ["account"] });
    expect(p.split).toBeNull();
  });

  test("Centrat și Panou lateral", () => {
    expect(headerPreset("centered").desktop.main.center).toEqual(["logo"]);
    expect(headerPreset("centered").desktop.bottom.center).toEqual(["nav"]);
    expect(headerPreset("side").desktop.main.left).toEqual(["logo"]);
    expect(headerPreset("side").desktop.main.center).toEqual(["nav"]);
  });

  test("o presetare cerută de mai multe ori dă copii independente", () => {
    const a = headerPreset("cockpit");
    a.desktop.main.left.push("social");
    expect(headerPreset("cockpit").desktop.main.left).toEqual(["logo"]);
  });
});

describe("constructorul de antet: validarea", () => {
  test("respinge formele greșite: preset necunoscut, rând sau zonă lipsă, element necunoscut sau dublat", () => {
    const ok = headerPreset("cockpit");
    expect(headerBuilderError(null)).toBe("invalid_type");
    expect(headerBuilderError({ ...ok, preset: "matrix" })).toBe("invalid_choice");
    const noRow = clone(ok) as unknown as Record<string, Record<string, unknown>>;
    delete noRow.desktop!.top;
    expect(headerBuilderError(noRow)).toBe("invalid");
    expect(headerBuilderError(withPath(ok, ["desktop", "main", "left"], ["logo", "evil"]))).toBe("invalid");
    expect(headerBuilderError(withPath(ok, ["desktop", "main", "left"], ["logo", "logo"]))).toBe("invalid");
    // Același element în două zone ale aceluiași dispozitiv.
    expect(headerBuilderError(withPath(ok, ["desktop", "top", "left"], ["account"]))).toBe("invalid");
    // Pe dispozitive diferite, același element e permis (fiecare presetare are logo-ul pe toate).
    expect(headerBuilderError(withPath(ok, ["tablet", "top", "left"], ["social"]))).toBeNull();
    expect(headerBuilderError(withPath(ok, ["desktop", "extra"], {}))).toBe("invalid");
    expect(headerBuilderError(withPath(ok, ["desktop", "main", "left"], Array.from({ length: 13 }, (_, i) => `x.e${i}`)))).toBe("invalid");
  });

  test("împărțirea meniului: `null` sau o listă scurtă de id-uri întregi pozitive, fără dubluri", () => {
    const ok = headerPreset("esports");
    expect(headerBuilderError({ ...ok, split: [3, 7] })).toBeNull();
    expect(headerBuilderError({ ...ok, split: [3, 3] })).toBe("invalid");
    expect(headerBuilderError({ ...ok, split: [-1] })).toBe("invalid");
    expect(headerBuilderError({ ...ok, split: ["3"] })).toBe("invalid");
    expect(headerBuilderError({ ...ok, split: Array.from({ length: 51 }, (_, i) => i + 1) })).toBe("invalid");
  });

  test("bara de jos (mobil): 1–5 elemente cunoscute, fără dubluri", () => {
    expect(mobileBarError(["forum", "servers", "create", "messages", "notifications"])).toBeNull();
    expect(mobileBarError([])).toBe("invalid");
    expect(mobileBarError(["forum", "forum"])).toBe("invalid");
    expect(mobileBarError(["forum", "nuke"])).toBe("invalid");
    expect(mobileBarError(["forum", "servers", "create", "messages", "notifications", "menu"])).toBe("invalid");
    expect(MOBILE_BAR_ITEMS).toEqual(expect.arrayContaining(["forum", "servers", "create", "messages", "notifications", "menu", "search", "account"]));
  });
});

describe("constructorul de antet: mutările (editorul cu drag & drop)", () => {
  test("mută un element între zone și rânduri, la poziția cerută", () => {
    const p = headerPreset("cockpit");
    const moved = moveHeaderElement(p.desktop, "create", { row: "top", zone: "center", index: 0 });
    expect(moved.top.center).toEqual(["create"]);
    expect(moved.main.right).toEqual(["search", "messages", "notifications", "account"]);
    // Originalul rămâne neschimbat.
    expect(p.desktop.main.right).toContain("create");
    const reordered = moveHeaderElement(p.desktop, "account", { row: "main", zone: "right", index: 0 });
    expect(reordered.main.right).toEqual(["account", "search", "create", "messages", "notifications"]);
  });

  test("mută în tava „nefolosite” și înapoi; elementele nefolosite sunt cele nepuse", () => {
    const p = headerPreset("cockpit");
    const out = moveHeaderElement(p.desktop, "serversLive", null);
    expect(placedHeaderElements(out)).not.toContain("serversLive");
    expect(unusedHeaderElements(out, ["serversLive", "chat.button"])).toEqual(expect.arrayContaining(["serversLive", "chat.button", "breadcrumb", "social"]));
    const back = moveHeaderElement(out, "serversLive", { row: "top", zone: "right", index: 5 });
    expect(back.top.right).toEqual(["serversLive"]);
  });

  test("o cheie necunoscută nu se poate pune în antet", () => {
    const p = headerPreset("cockpit");
    expect(moveHeaderElement(p.desktop, "evil" as never, { row: "top", zone: "left", index: 0 })).toEqual(p.desktop);
  });

  test("aspectul e „al presetării” cât timp nu a fost mutat nimic", () => {
    const p = headerPreset("esports");
    expect(headerLayoutIsPreset(p)).toBe(true);
    expect(headerLayoutIsPreset({ ...p, desktop: moveHeaderElement(p.desktop, "social", null) })).toBe(false);
    expect(headerLayoutIsPreset({ ...p, split: [1] })).toBe(false);
  });
});

describe("constructorul de antet: starea compactă la derulare", () => {
  test("Esports: rămâne rândul meniului cu logo-ul și căutarea, fără mutări (doar CSS)", () => {
    const c = compactHeaderLayout(headerPreset("esports").desktop);
    expect(c.moved).toBe(false);
    expect(c.row).toBe("main");
    expect(c.layout.main).toEqual({ left: ["nav"], center: ["logo"], right: ["navRight", "search"] });
    expect(c.layout.top).toEqual({ left: [], center: [], right: [] });
  });

  test("Cockpit: un singur rând cu logo-ul, meniul și iconița de căutare (acțiunile contului dispar)", () => {
    const c = compactHeaderLayout(headerPreset("cockpit").desktop);
    expect(c.moved).toBe(true);
    expect(c.row).toBe("bottom");
    expect(c.layout.bottom).toEqual({ left: ["logo", "nav"], center: [], right: ["search"] });
    expect(placedHeaderElements(c.layout).sort()).toEqual(["logo", "nav", "search"]);
  });

  test("câmpul de căutare devine iconiță; fără meniu, rămâne rândul principal", () => {
    const base = headerPreset("cockpit").desktop;
    const noNav = moveHeaderElement(base, "nav", null);
    const c = compactHeaderLayout(moveHeaderElement(noNav, "search", null));
    expect(c.row).toBe("main");
    expect(c.layout.main.left).toEqual(["logo"]);
    expect(c.layout.main.right).toEqual(["search"]);
    const field = compactHeaderLayout(moveHeaderElement(base, "searchField", { row: "bottom", zone: "right", index: 0 }));
    expect(placedHeaderElements(field.layout)).toContain("search");
    expect(placedHeaderElements(field.layout)).not.toContain("searchField");
  });
});

describe("constructorul de antet: meniul împărțit (Esports)", () => {
  const items = [1, 2, 3, 4, 5].map((id) => ({ id }));
  test("implicit: jumătate stânga, jumătate dreapta (stânga ia elementul în plus)", () => {
    expect(splitNavItems(items, null)).toEqual({ left: [{ id: 1 }, { id: 2 }, { id: 3 }], right: [{ id: 4 }, { id: 5 }] });
    expect(splitNavItems([], null)).toEqual({ left: [], right: [] });
  });
  test("adminul alege care itemi merg în dreapta (ordinea meniului rămâne)", () => {
    expect(splitNavItems(items, [5, 1])).toEqual({ left: [{ id: 2 }, { id: 3 }, { id: 4 }], right: [{ id: 1 }, { id: 5 }] });
    // Id-uri care nu mai există sunt ignorate.
    expect(splitNavItems(items, [99])).toEqual({ left: items, right: [] });
  });
});

describe("setările temei: antetul, bara de jos și consola", () => {
  test("valorile implicite: designul clasic pornește de la „Clasic” (64 px), designul GCS de la „Standard”; consola oprită", () => {
    expect(DEFAULT_THEME_SETTINGS.header.layout).toEqual(headerPreset("basic"));
    expect(DEFAULT_THEME_SETTINGS.header.rowMain).toBe(64);
    expect(NOVA_THEME_SETTINGS.header.layout.preset).toBe("classic");
    expect(NOVA_THEME_SETTINGS.cockpit.enabled).toBe(false);
    expect(NOVA_THEME_SETTINGS.cockpit.pages).toBe("home");
    expect([NOVA_THEME_SETTINGS.cockpit.left, NOVA_THEME_SETTINGS.cockpit.center, NOVA_THEME_SETTINGS.cockpit.right]).toEqual(["feed", "live", "top"]);
    expect(NOVA_THEME_SETTINGS.mobileNav.items).toEqual(["forum", "servers", "create", "messages", "notifications"]);
    expect(themeSettingsErrors(NOVA_THEME_SETTINGS)).toEqual({});
  });

  test("un aspect de antet salvat se păstrează; unul stricat revine la cel implicit", () => {
    const esports = headerPreset("esports");
    const s = normalizeThemeSettings(withThemePath(clone(NOVA_THEME_SETTINGS), "header.layout", esports));
    expect(s.header.layout).toEqual(esports);
    const bad = normalizeThemeSettings(withThemePath(clone(NOVA_THEME_SETTINGS), "header.layout", { preset: "esports" }));
    expect(bad.header.layout).toEqual(NOVA_THEME_SETTINGS.header.layout);
  });

  test("validarea strictă a câmpurilor noi", () => {
    expect(themeSettingsErrors({ header: { layout: { ...headerPreset("cockpit"), preset: "nope" } } })).toEqual({ "header.layout": "invalid_choice" });
    expect(themeSettingsErrors({ header: { dropdowns: "hover", mega: true, navAlign: "center", compact: true, hideOnScroll: false, rowTop: 76, rowMain: 94, rowBottom: 56 } })).toEqual({});
    expect(themeSettingsErrors({ header: { rowMain: 500 } })).toEqual({ "header.rowMain": "invalid_range" });
    expect(themeSettingsErrors({ mobileNav: { placement: "bottom", labels: true, items: ["forum", "menu"] } })).toEqual({});
    expect(themeSettingsErrors({ mobileNav: { items: ["forum", "forum"] } })).toEqual({ "mobileNav.items": "invalid" });
    expect(themeSettingsErrors({ cockpit: { enabled: true, pages: "all", left: "top", center: "featured", right: "none", image: null } })).toEqual({});
    expect(themeSettingsErrors({ cockpit: { left: "chess" } })).toEqual({ "cockpit.left": "invalid_choice" });
    expect(themeSettingsErrors({ header: { customHtml: "x".repeat(2001) } })).toEqual({ "header.customHtml": "too_long" });
  });
});

describe("constructorul de antet: CSS-ul temei", () => {
  test("setările funcționale se emit pentru ORICE design (pe `html`, nu doar pe designul GCS)", () => {
    for (const preset of THEME_PRESETS) {
      const base = clone(themeDefaults(preset));
      const off = compileThemeCss(withThemePath(base, "effects.hover", false), "");
      expect(off, preset).toContain("html:root {\n  --gcs-hover-scale: 1;\n  --gcs-hover-lift: 0px;\n  --gcs-ease: 0s;\n}");
      expect(compileThemeCss(withThemePath(base, "header.navIcons", false), ""), preset).toContain(".gcs-hb__navBar .gcs-hb__nav > .gcs-icon:not(.gcs-hb__caret)");
      expect(compileThemeCss(base, ""), preset).not.toContain("--gcs-hover-scale: 1;");
      // Butonul plin se luminează (strat alb), în orice design; fundalul e accentul sau nuanța lui lizibilă (≥ 4.5:1).
      expect(compileThemeCss(base, ""), preset).toMatch(/--gcs-btn-primary-hover: color-mix\(in srgb, (var\(--gcs-accent\)|#[0-9A-F]{6}) 92%, #fff\);/);
    }
  });

  test("decorul designului GCS (benzile, grafica antetului) rămâne doar pe el", () => {
    const decor = (preset: (typeof THEME_PRESETS)[number]) => compileThemeCss(withThemePath(withThemePath(clone(themeDefaults(preset)), "bands.style", "accent"), "header.pattern", false), "");
    expect(decor("nova")).toContain("html.gcs-nova {\n  --gcs-band-shadow");
    expect(decor("nova")).toContain("--gcs-hero-pattern: none;");
    expect(decor("classic")).not.toContain("gcs-nova");
  });

  test("fără iconițe în meniu: ascunse și în bara constructorului, nu doar în antetul clasic", () => {
    const off = compileThemeCss(withThemePath(clone(NOVA_THEME_SETTINGS), "header.navIcons", false), "");
    expect(off).toContain(".gcs-hb__navBar .gcs-hb__nav > .gcs-icon:not(.gcs-hb__caret)");
    const on = compileThemeCss(withThemePath(clone(NOVA_THEME_SETTINGS), "header.navIcons", true), "");
    expect(on).not.toContain(".gcs-hb__navBar .gcs-hb__nav > .gcs-icon");
  });
});

/** O copie cu valoarea pusă la calea dată (pentru construirea cazurilor invalide). */
function withPath(builder: GcsHeaderBuilder, path: string[], value: unknown): unknown {
  const out = clone(builder) as unknown as Record<string, unknown>;
  let cur = out;
  for (const part of path.slice(0, -1)) cur = cur[part] as Record<string, unknown>;
  cur[path.at(-1)!] = value;
  return out;
}
