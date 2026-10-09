import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsForbidden, GcsValidationError } from "../errors";
import type { GcsActor } from "../permissions/types";
import { sanitizeThemeCss, sanitizeThemeCssReport } from "./css";
import { GcsThemeCssService } from "./files";
import { GcsThemeService, themeCustomCss } from "./service";

let w: GcsTestWorld;
let css: GcsThemeCssService;
let themes: GcsThemeService;
let root: GcsActor;
let member: GcsActor;

beforeEach(async () => {
  w = await createWorld([]);
  css = new GcsThemeCssService({ db: w.db, bus: w.bus, acp: w.acp });
  themes = new GcsThemeService({ db: w.db, cache: w.cache, bus: w.bus, acp: w.acp });
  await w.db.$transaction((tx) => GcsThemeService.seedDefault(tx));
  root = await w.actorFor(await w.createUser("Root", "root_admin"));
  member = await w.actorFor(await w.createUser("Ana", "member"));
});

afterAll(async () => {
  await w.db.$disconnect();
});

const custom = async () => (await css.files("default")).find((f) => f.name === "custom.css")!;

describe("sanitizeThemeCssReport", () => {
  test("spune ce a scos, cu rândul și motivul; CSS-ul e același ca al lui sanitizeThemeCss", () => {
    const raw = [
      ".a { color: red; }",
      "@charset 'utf-8';",
      "@import url('https://evil.example/x.css');",
      ".b { width: expression(alert(1)); }",
      ".c { background: url(javascript:alert(1)); }",
      ".d { background: url(http://insecure.example/a.png); }",
      "</style><b>",
      ".e { behavior: url(x.htc); -moz-binding: url(y); }",
    ].join("\n");
    const { css: out, removed } = sanitizeThemeCssReport(raw);
    expect(out).toBe(sanitizeThemeCss(raw));
    expect(removed.map((r) => [r.line, r.reason])).toEqual([
      [2, "charset"],
      [3, "import"],
      [4, "expression"],
      [5, "script_url"],
      [5, "url"],
      [6, "url"],
      [7, "html"],
      [7, "html"],
      [8, "binding"],
      [8, "behavior"],
      [8, "url"],
      [8, "url"],
    ]);
    expect(sanitizeThemeCssReport(".ok { color: #fff; background: url(/files/a.png); }").removed).toEqual([]);
  });
});

describe("GcsThemeCssService", () => {
  test("tema implicită are custom.css; salvarea sanitizează, face o versiune și schimbă CSS-ul public", async () => {
    const file = await custom();
    expect(file.locked).toBe(true);
    const before = ((await themes.get("default"))!).version;
    const res = await css.save(root, "default", file.id, ".x { color: red; }\n</style>");
    expect(res.changed).toBe(true);
    expect(res.file.content).toBe(".x { color: red; }\n/style>");
    expect(res.removed.map((r) => r.reason)).toEqual(["html"]);
    const theme = (await themes.get("default"))!;
    expect(theme.version).toBe(before + 1);
    expect(themes.css(theme)).toContain("/* custom.css */\n.x { color: red; }");
    // Același conținut: nicio versiune nouă.
    expect((await css.save(root, "default", file.id, ".x { color: red; }\n/style>")).changed).toBe(false);
    const { versions, original } = await css.history("default", file.id);
    expect(versions.map((v) => v.action)).toEqual(["save", "create"]);
    expect(original?.content).toBe("");
    expect(await w.db.auditLog.count({ where: { action: "theme.css.save" } })).toBe(1);
  });

  test("fișierele se compilează în ordine; se pot crea, redenumi, muta și șterge", async () => {
    const a = await css.create(root, "default", "Layout.css");
    expect(a.name).toBe("layout.css");
    const b = await css.create(root, "default", "extra.css");
    await css.save(root, "default", a.id, ".layout{}");
    await css.save(root, "default", b.id, ".extra{}");
    const compiled = () => themes.get("default").then((t) => t!).then((t) => themes.css(t));
    expect((await compiled()).indexOf(".layout{}")).toBeLessThan((await compiled()).indexOf(".extra{}"));
    await css.move(root, "default", b.id, -1);
    expect((await css.files("default")).map((f) => f.name)).toEqual(["custom.css", "extra.css", "layout.css"]);
    expect((await compiled()).indexOf(".extra{}")).toBeLessThan((await compiled()).indexOf(".layout{}"));
    await css.rename(root, "default", b.id, "first.css");
    await css.remove(root, "default", a.id);
    expect((await css.files("default")).map((f) => f.name)).toEqual(["custom.css", "first.css"]);
    expect(await compiled()).not.toContain(".layout{}");
  });

  test("custom.css nu se redenumește și nu se șterge; numele invalide și duplicate sunt refuzate", async () => {
    const file = await custom();
    await expect(css.rename(root, "default", file.id, "alt.css")).rejects.toBeInstanceOf(GcsValidationError);
    await expect(css.remove(root, "default", file.id)).rejects.toBeInstanceOf(GcsValidationError);
    await expect(css.create(root, "default", "../x.css")).rejects.toBeInstanceOf(GcsValidationError);
    await expect(css.create(root, "default", "x.js")).rejects.toBeInstanceOf(GcsValidationError);
    await expect(css.create(root, "default", "custom.css")).rejects.toBeInstanceOf(GcsValidationError);
    await expect(css.save(root, "default", file.id, "x".repeat(50_001))).rejects.toBeInstanceOf(GcsValidationError);
  });

  test("drepturile: un membru nu poate edita; ștergerea cere dreptul delete", async () => {
    const file = await custom();
    await expect(css.save(member, "default", file.id, ".x{}")).rejects.toBeInstanceOf(GcsForbidden);
    await expect(css.create(member, "default", "a.css")).rejects.toBeInstanceOf(GcsForbidden);
    const role = await w.db.acpRole.create({ data: { name: "Designer", permissions: { create: [{ section: "appearance.css", canView: true, canEdit: true, canDelete: false }] } } });
    const designerUser = await w.createUser("Designer", "member");
    await w.db.acpRoleAssignment.create({ data: { roleId: role.id, userId: designerUser.id } });
    const designer = await w.actorFor(designerUser);
    const extra = await css.create(designer, "default", "a.css");
    await css.save(designer, "default", extra.id, ".a{}");
    await expect(css.remove(designer, "default", extra.id)).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("restaurarea unei versiuni vechi devine o versiune nouă", async () => {
    const file = await custom();
    await css.save(root, "default", file.id, ".v1{}");
    await css.save(root, "default", file.id, ".v2{}");
    const { versions } = await css.history("default", file.id);
    const v1 = versions.find((v) => v.content === ".v1{}")!;
    const res = await css.restore(root, "default", file.id, v1.id);
    expect(res.file.content).toBe(".v1{}");
    expect((await css.history("default", file.id)).versions[0]?.action).toBe("restore");
    expect(themeCustomCss((await themes.get("default"))!)).toBe(".v1{}");
  });

  test("o singură sursă: editorul vizual publică în custom.css, iar salvarea din ACP șterge CSS-ul din draft", async () => {
    await themes.saveDraft(root, "default", { customCss: ".studio{}", radius: 4 });
    expect(themes.css((await themes.get("default"))!, { draft: true })).toContain(".studio{}");
    expect(themes.css((await themes.get("default"))!)).not.toContain(".studio{}");
    await themes.publish(root, "default");
    const file = await custom();
    expect(file.content).toBe(".studio{}");
    expect((await css.history("default", file.id)).versions[0]?.action).toBe("publish");

    // Un draft nou cu CSS, apoi o salvare din ACP → CSS: draft-ul își pierde CSS-ul (rămân celelalte setări).
    await themes.saveDraft(root, "default", { customCss: ".vechi{}", radius: 6 });
    await css.save(root, "default", file.id, ".acp{}");
    const theme = (await themes.get("default"))!;
    expect(theme.draft).toEqual({ radius: 6 });
    expect(themes.css(theme, { draft: true })).toContain(".acp{}");
    await themes.publish(root, "default");
    expect((await custom()).content).toBe(".acp{}");
  });

  test("o temă nouă copiază fișierele temei sursă (sau pornește doar cu custom.css)", async () => {
    const file = await custom();
    await css.save(root, "default", file.id, ".base{}");
    const extra = await css.create(root, "default", "extra.css");
    await css.save(root, "default", extra.id, ".extra{}");
    await themes.create(root, { key: "copie", name: "Copie", from: "default" });
    expect((await css.files("copie")).map((f) => [f.name, f.content])).toEqual([
      ["custom.css", ".base{}"],
      ["extra.css", ".extra{}"],
    ]);
    await themes.create(root, { key: "goala", name: "Goală" });
    expect((await css.files("goala")).map((f) => f.name)).toEqual(["custom.css"]);
  });
});
