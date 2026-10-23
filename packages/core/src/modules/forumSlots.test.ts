import { describe, expect, test } from "vitest";
import {
  assertForumExtension,
  fieldsListSlots,
  fieldsStyle,
  isSafeCssValue,
  mergeSlotStyles,
  sanitizeSlotItems,
  sanitizeSlotStyle,
  tabsForType,
  validateExtensionValues,
  withExtensionDefaults,
  type GcsForumExtension,
  type GcsForumExtField,
} from "./forumSlots";
import { GcsModuleRegistry, type GcsModule } from "./registry";

const mod = (key: string, forumExtensions: GcsForumExtension[]): GcsModule => ({ key, permissions: [], settings: [], acpMenu: [], eventListeners: [], forumExtensions });

describe("sloturile forumului: elementele", () => {
  test("păstrează doar tipurile acceptate de slot și curăță textele, linkurile, iconițele și culorile", () => {
    const items = sanitizeSlotItems("forum.row.title", [
      { kind: "chip", label: "  Live  ", icon: "fa-solid fa-signal", tone: "ok", href: "/servers/1", tooltip: { key: "servers.live", params: { n: 3 } }, color: "#ff0000" },
      { kind: "text", text: "nu în titlu" },
      { kind: "chip", label: "rău", href: "javascript:alert(1)", icon: "<svg>", tone: "rainbow", color: "red" },
      { kind: "chip", label: "" },
      { kind: "html", html: "<b>x</b>" },
    ]);
    expect(items).toEqual([
      { kind: "chip", label: "Live", icon: "fa-solid fa-signal", tone: "ok", color: "#FF0000", href: "/servers/1", tooltip: { key: "servers.live", params: { n: 3 } } },
      { kind: "chip", label: "rău" },
    ]);
  });

  test("HTML-ul e permis doar când îl marchează gazda pluginurilor; cardurile doar în sloturile mari", () => {
    expect(sanitizeSlotItems("forum.row.meta", [{ kind: "html", html: "<b>x</b>" }])).toEqual([]);
    expect(sanitizeSlotItems("forum.row.meta", [{ kind: "html", html: "<b>x</b>", plugin: "gcs.hello" }], { allowHtml: true })).toEqual([{ kind: "html", html: "<b>x</b>", plugin: "gcs.hello" }]);
    expect(sanitizeSlotItems("forum.row.meta", [{ kind: "card", title: "x" }])).toEqual([]);
    const [card] = sanitizeSlotItems("forum.page.top", [
      { kind: "card", title: "Server", body: "Online", items: [{ kind: "stat", label: "Jucători", value: 12 }, { kind: "card" }], actions: [{ label: "Conectează", href: "https://example.com/c" }, { label: "x", href: "ftp://x" }], image: "https://evil.example/x.png" },
    ]);
    expect(card).toEqual({ kind: "card", title: "Server", body: "Online", items: [{ kind: "stat", label: "Jucători", value: 12 }], actions: [{ label: "Conectează", href: "https://example.com/c" }], image: "https://evil.example/x.png" });
  });

  test("componentele: cheie `modul.nume` și props JSON (funcțiile și valorile infinite dispar)", () => {
    expect(sanitizeSlotItems("topic.bar", [{ kind: "component", component: "servers.status", props: { id: 3, ok: true, n: Number.POSITIVE_INFINITY, f: () => 1 } }])).toEqual([
      { kind: "component", component: "servers.status", props: { id: 3, ok: true } },
    ]);
    expect(sanitizeSlotItems("topic.bar", [{ kind: "component", component: "../x" }])).toEqual([]);
  });

  test("cel mult 12 elemente pe slot și extensie; o listă care nu e listă = nimic", () => {
    expect(sanitizeSlotItems("forum.row.meta", Array.from({ length: 30 }, (_x, i) => ({ kind: "text", text: `#${i}` })))).toHaveLength(12);
    expect(sanitizeSlotItems("forum.row.meta", "x")).toEqual([]);
  });
});

describe("sloturile forumului: stilul", () => {
  test("valorile CSS sigure: culori, numere, poziții, fișierele site-ului, gradiente simple", () => {
    for (const v of ["#FF6A3D", "#fff", "0.7", "12px", "50% 30%", "center", "uppercase", 'url("/files/abc123")', 'url("/plugins/gcs.hello/media/x1.webp")', "linear-gradient(90deg, #FF6A3D, #FFD36A)"]) {
      expect(isSafeCssValue(v), v).toBe(true);
    }
    for (const v of ["red;}", "expression(alert(1))", 'url("https://evil.example/x.png")', 'url("/files/../etc")', 'url("/plugins/gcs.hello/media/../../x")', "var(--x)", "1px; color: red", ""]) {
      expect(isSafeCssValue(v), v).toBe(false);
    }
  });

  test("clasele și variabilele permise; containerul pluginului doar când e al lui", () => {
    const style = sanitizeSlotStyle(
      {
        classes: ["gcs-forumRow--titleCaps", "gcsx-servers-live", "gcsp-aspect-glow", "gcs-btn", "evil", "gcsp--gcs--hello", "gcsp--other--plugin"],
        vars: { "--gcs-forum-title-color": "#FF0000", "--gcsx-ping": "35ms", "--gcsp-x": "1", "--gcs-accent": "#000000", color: "red", "--gcsx-bad": "red;}" },
      },
      { pluginScope: "gcsp--gcs--hello" },
    );
    expect(style).toEqual({ classes: ["gcs-forumRow--titleCaps", "gcsx-servers-live", "gcsp-aspect-glow", "gcsp--gcs--hello"], vars: { "--gcs-forum-title-color": "#FF0000", "--gcsx-ping": "35ms", "--gcsp-x": "1" } });
    expect(sanitizeSlotStyle("x")).toEqual({ classes: [], vars: {} });
  });

  test("mai multe extensii: clasele se adună, la aceeași variabilă câștigă ultima", () => {
    expect(mergeSlotStyles([{ classes: ["gcsx-a"], vars: { "--gcsx-c": "1" } }, null, { classes: ["gcsx-a", "gcsx-b"], vars: { "--gcsx-c": "2" } }])).toEqual({ classes: ["gcsx-a", "gcsx-b"], vars: { "--gcsx-c": "2" } });
  });
});

const FIELDS: GcsForumExtField[] = [
  { key: "tag", type: "text", labelKey: "x", maxLength: 10, slot: { slot: "forum.row.title", as: "chip", icon: "fa-solid fa-tag" } },
  { key: "note", type: "textarea", labelKey: "x", maxLength: 50, slot: { slot: "forum.row.meta", as: "text" } },
  { key: "size", type: "number", labelKey: "x", min: 0, max: 10, step: 2, default: 4, style: { var: "--gcsx-size", unit: "px" } },
  { key: "caps", type: "toggle", labelKey: "x", style: { class: "gcs-forumRow--titleCaps" } },
  { key: "look", type: "select", labelKey: "x", options: [{ value: "dark", labelKey: "x" }, { value: "neon", labelKey: "x" }], style: { class: "gcsx-look-" } },
  { key: "server", type: "select", labelKey: "x", optionsFrom: "servers" },
  { key: "accent", type: "color", labelKey: "x", style: { var: "--gcs-forum-color" } },
  { key: "icon", type: "icon", labelKey: "x" },
];

describe("taburile contribuite: câmpurile", () => {
  test("valorile din formular, validate și normalizate (toggle din `on`, numere din text, culoarea cu majuscule)", () => {
    const ok = validateExtensionValues(FIELDS, { tag: " Live ", note: "", size: "6", caps: "on", look: "neon", server: "7", accent: "#ff6a3d", icon: "fa-solid fa-gamepad" }, { server: ["7", "8"] });
    expect(ok).toEqual({ ok: true, values: { tag: "Live", note: "", size: 6, caps: true, look: "neon", server: "7", accent: "#FF6A3D", icon: "fa-solid fa-gamepad" } });
  });

  test("erorile pe câmp: lungime, interval, pas, alegere, culoare, iconiță", () => {
    const bad = validateExtensionValues(FIELDS, { tag: "prea lung de tot", size: "5", look: "x", server: "9", accent: "red", icon: "<b>" }, { server: ["7"] });
    expect(bad).toEqual({ ok: false, errors: { tag: "too_long", size: "invalid_range", look: "invalid_choice", server: "invalid_choice", accent: "invalid_color", icon: "invalid_icon" } });
  });

  test("stilul și sloturile declarate pe câmpuri, din valorile salvate (cu valorile implicite)", () => {
    const data = withExtensionDefaults(FIELDS, { tag: "Live", caps: true, look: "neon", accent: "#FF6A3D", note: "Server oficial" });
    expect(data.size).toBe(4);
    expect(fieldsStyle(FIELDS, data)).toEqual({ classes: ["gcs-forumRow--titleCaps", "gcsx-look-neon"], vars: { "--gcsx-size": "4px", "--gcs-forum-color": "#FF6A3D" } });
    expect(fieldsListSlots(FIELDS, data)).toEqual({
      title: [{ kind: "chip", label: "Live", icon: "fa-solid fa-tag", tone: "accent", id: "tag" }],
      meta: [{ kind: "text", text: "Server oficial", id: "note" }],
    });
  });

  test("taburile apar doar pe tipurile lor de noduri", () => {
    const ext: GcsForumExtension = { key: "x", tabs: [{ key: "a", labelKey: "a", icon: "fa-solid fa-a", types: ["FORUM"] }, { key: "b", labelKey: "b", icon: "fa-solid fa-b" }] };
    expect(tabsForType(ext, "FORUM").map((t) => t.key)).toEqual(["a", "b"]);
    expect(tabsForType(ext, "CATEGORY").map((t) => t.key)).toEqual(["b"]);
  });
});

describe("înregistrarea extensiilor", () => {
  test("declarații greșite sunt refuzate (cheie, câmpuri repetate, interval, stil nepermis)", () => {
    expect(() => assertForumExtension({ key: "Bad Key" })).toThrow(/cheie/);
    expect(() => assertForumExtension({ key: "x", tabs: [{ key: "t", labelKey: "t", icon: "fa-solid fa-t", fields: [FIELDS[0]!, FIELDS[0]!] }] })).toThrow(/repetat/);
    expect(() => assertForumExtension({ key: "x", tabs: [{ key: "t", labelKey: "t", icon: "fa-solid fa-t", fields: [{ key: "n", type: "number", labelKey: "n", min: 5, max: 1 }] }] })).toThrow(/interval/);
    expect(() => assertForumExtension({ key: "x", tabs: [{ key: "t", labelKey: "t", icon: "fa-solid fa-t", fields: [{ key: "c", type: "color", labelKey: "c", style: { var: "--gcs-accent" } }] }] })).toThrow(/variabilă/);
    expect(() => assertForumExtension({ key: "x", tabs: [{ key: "t", labelKey: "t", icon: "fa-solid fa-t", fields: [{ key: "c", type: "toggle", labelKey: "c", style: { class: "gcs-btn" } }] }] })).toThrow(/clasă/);
    expect(() => assertForumExtension({ key: "x", tabs: [{ key: "t", labelKey: "t", icon: "fa-solid fa-t", fields: FIELDS }] })).not.toThrow();
  });

  test("registry-ul: chei unice între module, ordinea după `position`, apoi a înregistrării", () => {
    const registry = new GcsModuleRegistry();
    registry.register(mod("a", [{ key: "late", position: 300 }, { key: "first" }]));
    registry.register(mod("b", [{ key: "early", position: 10 }, { key: "second" }]));
    expect(registry.forumExtensions().map((e) => `${e.module}:${e.def.key}`)).toEqual(["b:early", "a:first", "b:second", "a:late"]);
    expect(() => registry.register(mod("c", [{ key: "first" }]))).toThrow(/extensia de forum/);
    registry.unregister("a");
    expect(registry.forumExtensions().map((e) => e.def.key)).toEqual(["early", "second"]);
  });
});
