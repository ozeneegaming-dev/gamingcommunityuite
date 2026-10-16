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

const custom = async () => (await css.files("gcs-dark")).find((f) => f.name === "custom.css")!;

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
    const before = ((await themes.get("gcs-dark"))!).version;
    const res = await css.save(root, "gcs-dark", file.id, ".x { color: red; }\n</style>");
    expect(res.changed).toBe(true);
    expect(res.file.content).toBe(".x { color: red; }\n/style>");
    expect(res.removed.map((r) => r.reason)).toEqual(["html"]);
    const theme = (await themes.get("gcs-dark"))!;
    expect(theme.version).toBe(before + 1);
    expect(themes.css(theme)).toContain("/* custom.css */\n.x { color: red; }");
    // Același conținut: nicio versiune nouă.
    expect((await css.save(root, "gcs-dark", file.id, ".x { color: red; }\n/style>")).changed).toBe(false);
    const { versions, original } = await css.history("gcs-dark", file.id);
    expect(versions.map((v) => v.action)).toEqual(["save", "create"]);
    expect(original?.content).toBe("");
    expect(await w.db.auditLog.count({ where: { action: "theme.css.save" } })).toBe(1);
  });

  test("fișierele se compilează în ordine; se pot crea, redenumi, muta și șterge", async () => {
    const a = await css.create(root, "gcs-dark", "Layout.css");
    expect(a.name).toBe("layout.css");
    const b = await css.create(root, "gcs-dark", "extra.css");
    await css.save(root, "gcs-dark", a.id, ".layout{}");
    await css.save(root, "gcs-dark", b.id, ".extra{}");
    const compiled = () => themes.get("gcs-dark").then((t) => t!).then((t) => themes.css(t));
    expect((await compiled()).indexOf(".layout{}")).toBeLessThan((await compiled()).indexOf(".extra{}"));
    await css.move(root, "gcs-dark", b.id, -1);
    expect((await css.files("gcs-dark")).map((f) => f.name)).toEqual(["custom.css", "extra.css", "layout.css"]);
    expect((await compiled()).indexOf(".extra{}")).toBeLessThan((await compiled()).indexOf(".layout{}"));
    await css.rename(root, "gcs-dark", b.id, "first.css");
    await css.remove(root, "gcs-dark", a.id);
    expect((await css.files("gcs-dark")).map((f) => f.name)).toEqual(["custom.css", "first.css"]);
    expect(await compiled()).not.toContain(".layout{}");
  });

  test("custom.css nu se redenumește și nu se șterge; numele invalide și duplicate sunt refuzate", async () => {
    const file = await custom();
    await expect(css.rename(root, "gcs-dark", file.id, "alt.css")).rejects.toBeInstanceOf(GcsValidationError);
    await expect(css.remove(root, "gcs-dark", file.id)).rejects.toBeInstanceOf(GcsValidationError);
    await expect(css.create(root, "gcs-dark", "../x.css")).rejects.toBeInstanceOf(GcsValidationError);
    await expect(css.create(root, "gcs-dark", "x.js")).rejects.toBeInstanceOf(GcsValidationError);
    await expect(css.create(root, "gcs-dark", "custom.css")).rejects.toBeInstanceOf(GcsValidationError);
    await expect(css.save(root, "gcs-dark", file.id, "x".repeat(50_001))).rejects.toBeInstanceOf(GcsValidationError);
  });

  test("drepturile: un membru nu poate edita; ștergerea cere dreptul delete", async () => {
    const file = await custom();
    await expect(css.save(member, "gcs-dark", file.id, ".x{}")).rejects.toBeInstanceOf(GcsForbidden);
    await expect(css.create(member, "gcs-dark", "a.css")).rejects.toBeInstanceOf(GcsForbidden);
    const role = await w.db.acpRole.create({ data: { name: "Designer", permissions: { create: [{ section: "appearance.css", canView: true, canEdit: true, canDelete: false }] } } });
    const designerUser = await w.createUser("Designer", "member");
    await w.db.acpRoleAssignment.create({ data: { roleId: role.id, userId: designerUser.id } });
    const designer = await w.actorFor(designerUser);
    const extra = await css.create(designer, "gcs-dark", "a.css");
    await css.save(designer, "gcs-dark", extra.id, ".a{}");
    await expect(css.remove(designer, "gcs-dark", extra.id)).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("restaurarea unei versiuni vechi devine o versiune nouă", async () => {
    const file = await custom();
    await css.save(root, "gcs-dark", file.id, ".v1{}");
    await css.save(root, "gcs-dark", file.id, ".v2{}");
    const { versions } = await css.history("gcs-dark", file.id);
    const v1 = versions.find((v) => v.content === ".v1{}")!;
    const res = await css.restore(root, "gcs-dark", file.id, v1.id);
    expect(res.file.content).toBe(".v1{}");
    expect((await css.history("gcs-dark", file.id)).versions[0]?.action).toBe("restore");
    expect(themeCustomCss((await themes.get("gcs-dark"))!)).toBe(".v1{}");
  });

  test("o singură sursă: editorul vizual publică în custom.css, iar salvarea din ACP șterge CSS-ul din draft", async () => {
    await themes.saveDraft(root, "gcs-dark", { customCss: ".studio{}", radius: 4 });
    expect(themes.css((await themes.get("gcs-dark"))!, { draft: true })).toContain(".studio{}");
    expect(themes.css((await themes.get("gcs-dark"))!)).not.toContain(".studio{}");
    await themes.publish(root, "gcs-dark");
    const file = await custom();
    expect(file.content).toBe(".studio{}");
    expect((await css.history("gcs-dark", file.id)).versions[0]?.action).toBe("publish");

    // Un draft nou cu CSS, apoi o salvare din ACP → CSS: draft-ul își pierde CSS-ul (rămân celelalte setări).
    await themes.saveDraft(root, "gcs-dark", { customCss: ".vechi{}", radius: 6 });
    await css.save(root, "gcs-dark", file.id, ".acp{}");
    const theme = (await themes.get("gcs-dark"))!;
    expect(theme.draft).toEqual({ radius: 6 });
    expect(themes.css(theme, { draft: true })).toContain(".acp{}");
    await themes.publish(root, "gcs-dark");
    expect((await custom()).content).toBe(".acp{}");
  });

  test("o temă nouă copiază fișierele temei sursă (sau pornește doar cu custom.css)", async () => {
    const file = await custom();
    await css.save(root, "gcs-dark", file.id, ".base{}");
    const extra = await css.create(root, "gcs-dark", "extra.css");
    await css.save(root, "gcs-dark", extra.id, ".extra{}");
    await themes.create(root, { key: "copie", name: "Copie", from: "gcs-dark" });
    expect((await css.files("copie")).map((f) => [f.name, f.content])).toEqual([
      ["custom.css", ".base{}"],
      ["extra.css", ".extra{}"],
    ]);
    await themes.create(root, { key: "goala", name: "Goală" });
    expect((await css.files("goala")).map((f) => f.name)).toEqual(["custom.css"]);
  });
});
