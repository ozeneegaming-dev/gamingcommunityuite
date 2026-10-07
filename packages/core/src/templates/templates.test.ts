import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsForbidden, GcsNotFound, GcsValidationError } from "../errors";
import type { GcsActor } from "../permissions/types";
import { GcsThemeService } from "../themes/service";
import { DEFAULT_TEMPLATES, defaultTemplate } from "./defaults";
import { renderTemplate } from "./render";
import { GcsTemplateService } from "./service";
import { sanitizeTemplateHtml } from "./sanitize";

let w: GcsTestWorld;
let templates: GcsTemplateService;
let themes: GcsThemeService;
let root: GcsActor;
let member: GcsActor;

beforeEach(async () => {
  w = await createWorld([]);
  templates = new GcsTemplateService({ db: w.db, cache: w.cache, bus: w.bus, acp: w.acp });
  themes = new GcsThemeService({ db: w.db, cache: w.cache, bus: w.bus, acp: w.acp });
  await w.db.$transaction((tx) => GcsThemeService.seedDefault(tx));
  root = await w.actorFor(await w.createUser("Root", "root_admin"));
  member = await w.actorFor(await w.createUser("Ana", "member"));
});

afterAll(async () => {
  await w.db.$disconnect();
});

const ROW = "forum.row";

describe("șabloanele implicite", () => {
  test("toate se parsează și au chei, grupuri și versiuni valide", () => {
    const keys = new Set<string>();
    for (const def of DEFAULT_TEMPLATES) {
      expect(def.key).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(keys.has(def.key)).toBe(false);
      keys.add(def.key);
      expect(def.version).toBeGreaterThanOrEqual(1);
      expect(() => templates.validate(def.key, def.source)).not.toThrow();
      for (const slot of def.slots) expect(def.source).toContain(`{% slot "${slot.name}" %}`);
    }
  });

  test("se randează fără erori pe date de exemplu (ieșirea trece de sanitizer neschimbată ca structură)", () => {
    const user = { id: "u1", name: "Ana", url: "/members/u1-ana", image: null, nameKey: "member", frameKey: null };
    const data: Record<string, unknown> = {
      site: { name: "Test", url: "https://x.example" },
      year: 2026,
      forum: {
        id: 1,
        name: "General",
        description: "Discuții",
        url: "/forum/1-general",
        external: false,
        icon: "fa-solid fa-comments",
        color: "#D62839",
        unread: true,
        topicsCount: 3,
        postsCount: 9,
        subforumColumns: 2,
        subforums: [{ id: 2, name: "Sub", url: "/forum/2-sub", icon: "fa-regular fa-comment", topicsCount: 1 }],
        last: { topicTitle: "Salut", topicUrl: "/topic/1-salut", at: "2026-10-06T10:00:00Z", user },
      },
      topic: {
        id: 1,
        title: "Salut",
        url: "/topic/1-salut",
        unreadUrl: "/topic/1/unread",
        unread: true,
        pinned: true,
        featured: false,
        solved: false,
        locked: false,
        visibility: "VISIBLE",
        prefix: { name: "Info", color: "#00AAFF" },
        tags: [{ name: "x", url: "/tags/x" }],
        createdAt: "2026-10-06T10:00:00Z",
        repliesCount: 2,
        viewsCount: 5,
        author: user,
        last: { at: "2026-10-06T11:00:00Z", user },
      },
      author: {
        ...user,
        handle: "ana",
        hasData: true,
        online: true,
        secondary: "Membru",
        customTitle: "Veteran",
        vip: false,
        rankLevel: 2,
        pips: 2,
        rank: { name: "Rang", symbol: null },
        rankIcon: "fa-solid fa-shield-halved",
        group: { label: "Membri", icon: "fa-solid fa-user", banner: "#334455" },
        xp: { points: 10, next: 20, nextRank: "Următorul", percent: 50 },
        badges: {
          count: 3,
          more: 2,
          recent: [{ key: "b", name: "Insignă", description: "Prima", color: "#FFAA00", image: null, art: "/badge-art/v1/medal-gold-ffaa00-i-solid-star.svg", icon: "fa-solid fa-star", symbol: null, initial: "I" }],
        },
        postsCount: 5,
        topicsCount: 1,
        reputation: 3,
        joinedAt: "2026-01-01T00:00:00Z",
        motto: "Salut!",
        fields: [{ key: "site", label: "Site", icon: "fa-solid fa-link", type: "URL", value: "https://a.example", display: "a.example", image: null }],
      },
      member: { ...user, online: true, customTitle: null, group: { name: "Membri", color: "#00AA00" }, rank: null, postsCount: 1, reputation: 2, joinedAt: "2026-01-01T00:00:00Z" },
      user: { ...user, bio: "Bio", accentColor: null, cover: null, group: { name: "Membri", color: null }, rank: null },
      stats: { posts: 1, reputation: -2, followers: 3, joinedAt: "2026-01-01T00:00:00Z" },
      online: true,
      badges: [{ key: "b", name: "Insignă", description: "", symbol: null, image: "/files/abc", color: "#FFAA00", art: "/badge-art/v1/medal-gold-ffaa00-t-49.svg" }],
      fields: [],
      viewer: { canFollow: true, canMessage: false, isFollowing: false },
      widget: { id: "1", type: "forums.stats", title: "Statistici", icon: "fa-solid fa-chart-simple", headingId: "gcs-widget-1", hasExtra: false, testId: null },
      subject: "Subiect",
      content: { html: "<p>x</p>" },
    };
    const include = (name: string) => defaultTemplate(name)?.source ?? null;
    for (const def of DEFAULT_TEMPLATES) {
      const html = sanitizeTemplateHtml(renderTemplate(def.source, data, { locale: "en", include, translate: (k) => k }), def.mode);
      if (def.key !== "email.layout") expect(html.length, def.key).toBeGreaterThan(20);
      expect(html).not.toMatch(/<script|javascript:/i);
    }
    // Insignele (specul 2026-10-07-insigne-grafice): imaginea generată sau cea proprie, „+N” pentru restul.
    const postbit = sanitizeTemplateHtml(renderTemplate(defaultTemplate("postbit.author")!.source, data, { locale: "en", include, translate: (k) => k }), "site");
    expect(postbit).toContain('src="/badge-art/v1/medal-gold-ffaa00-i-solid-star.svg"');
    expect(postbit).toContain('title="Insignă: Prima"');
    expect(postbit).toMatch(/class="gcs-badgeArt__more"[^>]*>\+2</);
    const card = sanitizeTemplateHtml(renderTemplate(defaultTemplate("members.hover_card")!.source, data, { locale: "en", include, translate: (k) => k }), "site");
    expect(card).toContain('<img class="gcs-badgeArt gcs-badgeArt--32 gcs-badgeArt--image" src="/files/abc" alt="Insignă"');
  });
});

describe("GcsTemplateService", () => {
  test("arborele arată starea fiecărui șablon pe temă", async () => {
    const tree = await templates.tree("default");
    expect(tree.map((e) => e.def.key)).toEqual(DEFAULT_TEMPLATES.map((d) => d.key));
    expect(tree.every((e) => e.status === "default")).toBe(true);
    await templates.save(root, "default", ROW, "<p>{{ forum.name }}</p>");
    expect((await templates.tree("default")).find((e) => e.def.key === ROW)?.status).toBe("modified");
  });

  test("salvarea validează sintaxa (eroarea are rândul și coloana)", async () => {
    const err = await templates.save(root, "default", ROW, "<p>\n  {{ forum.name | nope }}</p>").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GcsValidationError);
    expect((err as GcsValidationError).fields).toEqual({ source: "template_syntax" });
    expect((err as GcsValidationError).params).toMatchObject({ error: "unknown_filter", line: "2", column: "19", detail: "nope" });
    expect(await w.db.themeTemplate.count()).toBe(0);
  });

  test("cheile necunoscute, temele inexistente și membrii fără drept sunt refuzați", async () => {
    await expect(templates.save(root, "default", "nu.exista", "x")).rejects.toBeInstanceOf(GcsNotFound);
    await expect(templates.save(root, "nu-exista", ROW, "x")).rejects.toBeInstanceOf(GcsNotFound);
    await expect(templates.save(member, "default", ROW, "x")).rejects.toBeInstanceOf(GcsForbidden);
    await expect(templates.revert(member, "default", ROW)).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("salvarea face o versiune și o intrare în jurnal; site-ul vede imediat suprascrierea (cache invalidat)", async () => {
    expect(await templates.overrides("default")).toEqual({});
    await templates.save(root, "default", ROW, "<p>A</p>");
    expect((await templates.overrides("default"))[ROW]?.source).toBe("<p>A</p>");
    await templates.save(root, "default", ROW, "<p>B</p>");
    expect((await templates.overrides("default"))[ROW]?.source).toBe("<p>B</p>");
    const detail = await templates.detail("default", ROW);
    expect(detail.versions.map((v) => [v.action, v.source, v.authorName])).toEqual([
      ["save", "<p>B</p>", "Root"],
      ["save", "<p>A</p>", "Root"],
    ]);
    expect(detail.override?.baseVersion).toBe(defaultTemplate(ROW)!.version);
    expect(await w.db.auditLog.count({ where: { action: "theme.template.save" } })).toBe(2);
  });

  test("randarea pe temă: includerile cad pe șabloanele implicite, ieșirea e sanitizată", async () => {
    expect(await templates.render("default", ROW, {})).toBeNull();
    await templates.save(root, "default", "postbit.author", '<div onclick="x()">{{ author.name }}<script>alert(1)</script>{% include "postbit.fields" %}</div>');
    const html = await templates.render("default", "postbit.author", { author: { name: "Ana", fields: [{ key: "k", label: "L", icon: "fa-solid fa-link", type: "TEXT", value: "V" }] } });
    expect(html).toContain("Ana");
    expect(html).toContain('data-field="k"');
    expect(html).not.toMatch(/onclick|<script|alert/);
    // Previzualizarea: sursa nesalvată, fără să atingă baza.
    expect(await templates.render("default", ROW, { forum: { name: "X" } }, { source: "<b>{{ forum.name }}</b>" })).toBe("<b>X</b>");
  });

  test("„Revino la original” șterge suprascrierea, istoricul rămâne; o versiune se poate restaura", async () => {
    await templates.save(root, "default", ROW, "<p>A</p>");
    await templates.revert(root, "default", ROW);
    expect(await templates.overrides("default")).toEqual({});
    const detail = await templates.detail("default", ROW);
    expect(detail.status).toBe("default");
    expect(detail.versions.map((v) => v.action)).toEqual(["revert", "save"]);
    const saved = detail.versions.find((v) => v.action === "save")!;
    expect(await templates.restore(root, "default", saved.id)).toBe(ROW);
    expect((await templates.overrides("default"))[ROW]?.source).toBe("<p>A</p>");
    expect((await templates.detail("default", ROW)).versions[0]?.action).toBe("restore");
    expect(await w.db.auditLog.count({ where: { action: "theme.template.revert" } })).toBe(1);
  });

  test("o versiune nouă a originalului marchează suprascrierea „necesită revizuire”, până la revizuire", async () => {
    await templates.save(root, "default", ROW, "<p>A</p>");
    // Ca după o actualizare GCS: suprascrierea pornise de la o versiune mai veche a originalului.
    await w.db.themeTemplate.updateMany({ data: { baseVersion: 0, baseSource: "vechi" } });
    await w.cache.invalidateTags(["templates"]);
    expect((await templates.detail("default", ROW)).status).toBe("review");
    expect((await templates.tree("default")).find((e) => e.def.key === ROW)?.status).toBe("review");
    await templates.markReviewed(root, "default", ROW);
    const detail = await templates.detail("default", ROW);
    expect(detail.status).toBe("modified");
    expect(detail.override?.baseSource).toBe(defaultTemplate(ROW)!.source);
    expect(detail.override?.source).toBe("<p>A</p>");
  });

  test("o temă nouă copiază suprascrierile temei sursă; ștergerea temei le șterge", async () => {
    await templates.save(root, "default", ROW, "<p>A</p>");
    await themes.create(root, { key: "neon", name: "Neon", from: "default" });
    expect((await templates.overrides("neon"))[ROW]?.source).toBe("<p>A</p>");
    await templates.save(root, "neon", ROW, "<p>N</p>");
    expect((await templates.overrides("default"))[ROW]?.source).toBe("<p>A</p>");
    await themes.remove(root, "neon");
    expect(await w.db.themeTemplate.count()).toBe(1);
    expect(await w.db.themeTemplateVersion.count({ where: { theme: { key: "neon" } } })).toBe(0);
  });
});
