import { describe, expect, test } from "vitest";
import { coreSchemaFixture, prefixedSchemaFixture } from "../fixtures";
import type { GcsBatch, GcsSourceAdapter } from "../types";
import { GcsCoreSchemaAdapter } from "./coreSchema";
import { createAdapter, detectSchema, isSupportedVersion } from "./detect";
import { GcsPrefixedSchemaAdapter } from "./prefixedSchema";
import { buildSelect, createMemoryReader, ident } from "./reader";
import { hexColor, ipString, phpUnserialize, plainText } from "./values";

/** Toate loturile unei metode cu cursor, cu loturi mici (testează și paginarea). */
async function drain<T>(fn: (cursor: string | null, limit: number) => Promise<GcsBatch<T>>, limit = 1): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 100; i++) {
    const batch: GcsBatch<T> = await fn(cursor, limit);
    out.push(...batch.rows);
    if (batch.next === null) return out;
    cursor = batch.next;
  }
  throw new Error("cursorul nu se termină");
}

describe("cititorul structurat", () => {
  test("SQL parametrizat, identificatori validați", () => {
    expect(buildSelect("xf_post", { columns: ["post_id"], where: { thread_id: { in: [1, 2] }, message_state: "visible", post_id: { gt: 5 } }, orderBy: [["post_id", "asc"]], limit: 50 })).toEqual({
      sql: "SELECT `post_id` FROM `xf_post` WHERE `thread_id` IN (?, ?) AND `message_state` = ? AND `post_id` > ? ORDER BY `post_id` ASC LIMIT 50",
      params: [1, 2, "visible", 5],
    });
    expect(buildSelect("t", { where: { a: null, b: { ne: 3 }, c: { between: [0, 10] }, d: { in: [] } } }).sql).toBe(
      "SELECT * FROM `t` WHERE `a` IS NULL AND (`b` <> ? OR `b` IS NULL) AND `c` > ? AND `c` <= ? AND 1 = 0",
    );
    expect(() => ident("users; DROP TABLE x")).toThrow();
    expect(() => ident("a`b")).toThrow();
  });

  test("cititorul în memorie aplică aceleași filtre", async () => {
    const r = createMemoryReader({ t: [{ id: 3, s: "b" }, { id: 1, s: "a" }, { id: 2, s: null }] });
    expect(await r.select("t", { where: { id: { gt: 1 } }, orderBy: [["id", "asc"]] })).toEqual([{ id: 2, s: null }, { id: 3, s: "b" }]);
    expect(await r.select("t", { where: { s: null } })).toEqual([{ id: 2, s: null }]);
    expect(await r.count("t", { s: { ne: "a" } })).toBe(2);
    expect(await r.max("t", "id")).toBe(3);
    expect(await r.columns("lipsa")).toEqual([]);
  });
});

describe("valorile din baza veche", () => {
  test("PHP serializat, IP binar, culori, text simplu", () => {
    // Lungimile `s:` sunt în octeți: „ș” are 2.
    expect(phpUnserialize('a:2:{s:4:"hash";s:3:"abc";s:4:"salt";s:3:"șx";}')).toEqual({ hash: "abc", salt: "șx" });
    expect(phpUnserialize('a:1:{s:4:"salt";s:2:"șx";}')).toBeNull();
    expect(phpUnserialize('O:8:"stdClass":0:{}')).toBeNull();
    expect(phpUnserialize("nu")).toBeNull();
    expect(ipString(Buffer.from([203, 0, 113, 7]))).toBe("203.0.113.7");
    expect(ipString(Buffer.from("20010db8000000000000000000000001", "hex"))).toBe("2001:db8::1");
    expect(ipString("<script>")).toBeNull();
    expect(hexColor("color: #d62839; font-weight: bold")).toBe("#D62839");
    expect(hexColor("<span style='color:#f00'>")).toBe("#FF0000");
    expect(plainText("<p>Despre <strong>orice</strong> &amp; mai mult.</p>")).toBe("Despre orice & mai mult.");
  });
});

describe("detecția", () => {
  test("schema, prefixul și versiunea", async () => {
    const core = createMemoryReader(coreSchemaFixture().tables);
    expect(await detectSchema(core)).toEqual({ schema: "core-schema", prefix: "" });
    const prefixed = createMemoryReader(prefixedSchemaFixture().tables);
    expect(await detectSchema(prefixed)).toEqual({ schema: "prefixed-schema", prefix: "xf_" });
    const withPrefix = createMemoryReader(Object.fromEntries(Object.entries(coreSchemaFixture().tables).map(([k, v]) => [`ibf_${k}`, v])));
    expect(await detectSchema(withPrefix, "ibf_")).toEqual({ schema: "core-schema", prefix: "ibf_" });
    expect(await createAdapter(withPrefix, { schema: "core-schema", prefix: "ibf_" }).version()).toBe("4.7.18");
    expect(await createAdapter(prefixed, { schema: "prefixed-schema", prefix: "xf_" }).version()).toBe("2.2.13");
    expect(await detectSchema(createMemoryReader({ wp_posts: [] }))).toBeNull();
  });

  test("versiunile suportate", () => {
    expect(isSupportedVersion("core-schema", "4.7.18")).toBe(true);
    expect(isSupportedVersion("core-schema", "5.0.4")).toBe(true);
    expect(isSupportedVersion("core-schema", "4.3.6")).toBe(false);
    expect(isSupportedVersion("core-schema", "3.4.9")).toBe(false);
    expect(isSupportedVersion("prefixed-schema", "2.1.0")).toBe(true);
    expect(isSupportedVersion("prefixed-schema", "2.3.6")).toBe(true);
    expect(isSupportedVersion("prefixed-schema", "1.5.24")).toBe(false);
    expect(isSupportedVersion("prefixed-schema", "?")).toBe(false);
  });
});

describe("adaptorul core-schema", () => {
  const a: GcsSourceAdapter = new GcsCoreSchemaAdapter(createMemoryReader(coreSchemaFixture().tables));

  test("grupurile, după rol", async () => {
    expect(await a.groups()).toEqual([
      { id: "2", name: "Guests", color: null, role: "guest" },
      { id: "3", name: "Members", color: null, role: "member" },
      { id: "4", name: "Administrators", color: "#D62839", role: "admin" },
      { id: "6", name: "Moderators", color: "#5EA2FF", role: "moderator" },
      { id: "7", name: "Veterani", color: "#29A3A3", role: "other" },
    ]);
  });

  test("membrii: parole, ban, grupuri secundare, avatar, ziua de naștere publică", async () => {
    const members = await drain((c, l) => a.members(c, l), 2);
    expect(members.map((m) => m.id)).toEqual(["1", "2", "3", "4"]);
    const [admin, ana, codrin, dublura] = members;
    expect(admin).toMatchObject({ name: "Vechiul Admin", primaryGroupId: "4", avatarPaths: ["uploads/monthly_2023_11/avatar-1.png"], birthday: { day: 3, month: 5, year: 1990 }, title: "Fondator", reputation: 42 });
    expect(admin!.password).toMatchObject({ scheme: "bcrypt" });
    expect(ana).toMatchObject({ email: "Ana@Exemplu.ro", secondaryGroupIds: ["7"], registrationIp: "198.51.100.20", ban: null, birthday: null });
    expect(codrin!.password).toEqual({ scheme: "md5s", hash: "59a84e4db1b780a0f10e568bf180a503", salt: "k9#Z1" });
    expect(codrin!.ban).toEqual({ reason: "", expiresAt: null });
    expect(dublura!.password).toBeNull();
  });

  test("câmpurile de profil și valorile", async () => {
    expect(await a.profileFields()).toEqual([{ id: "1", name: "Joc preferat", type: "SELECT", options: ["CS2", "Valorant", "Rust"], required: false, visibility: "PUBLIC", position: 1, maxLength: 200 }]);
    expect(await drain((c, l) => a.profileValues(c, l))).toEqual([
      { memberId: "1", fieldId: "1", value: "Rust" },
      { memberId: "2", fieldId: "1", value: "CS2" },
    ]);
  });

  test("forumurile și permisiunile", async () => {
    expect(await a.forums()).toEqual([
      { id: "1", parentId: null, type: "CATEGORY", name: "Comunitate", description: "", position: 1, linkUrl: null },
      { id: "2", parentId: "1", type: "FORUM", name: "Discuții generale", description: "Despre orice.", position: 1, linkUrl: null },
      { id: "3", parentId: "2", type: "FORUM", name: "Staff", description: "", position: 1, linkUrl: null },
      { id: "4", parentId: "1", type: "LINK", name: "Site oficial", description: "", position: 2, linkUrl: "https://exemplu.ro/" },
    ]);
    const perms = await a.forumPermissions();
    expect(perms.find((p) => p.forumId === "2" && p.groupId === "2")?.actions).toEqual(["view", "read", "download"]);
    expect(perms.find((p) => p.forumId === "2" && p.groupId === "3")?.actions).toEqual(["view", "read", "reply", "create", "upload", "download"]);
    expect(perms.find((p) => p.forumId === "3" && p.groupId === "3")).toBeUndefined();
  });

  test("topicurile: prefix, tag-uri, sondaj, topicul mutat", async () => {
    expect(await a.prefixes()).toEqual([{ id: "ghid", name: "Ghid", color: null }]);
    const topics = await drain((c, l) => a.topics(c, l));
    expect(topics.find((t) => t.id === "10")).toMatchObject({ pinned: true, prefixId: "ghid", tags: ["cs2", "config"], visibility: "VISIBLE" });
    expect(topics.find((t) => t.id === "10")!.poll).toEqual({
      question: "Ce jucați?",
      multiple: false,
      closesAt: null,
      options: [
        { id: "1", text: "CS2" },
        { id: "2", text: "Valorant" },
      ],
      votes: [{ optionId: "1", memberId: "2" }],
    });
    expect(topics.find((t) => t.id === "11")).toMatchObject({ locked: true });
    expect(topics.find((t) => t.id === "12")).toMatchObject({ isRedirect: true });
    expect(topics.find((t) => t.id === "13")).toMatchObject({ visibility: "HIDDEN" });
  });

  test("postările, atașamentele, reacțiile", async () => {
    const posts = await drain((c, l) => a.posts(c, l), 3);
    expect(posts.map((p) => [p.id, p.attachmentIds])).toEqual([
      ["100", ["50"]],
      ["101", []],
      ["102", ["51"]],
      ["103", []],
    ]);
    expect(posts[1]).toMatchObject({ authorId: "2", editedAt: new Date((1_700_000_000 + 1600) * 1000) });
    expect(await drain((c, l) => a.attachments(c, l))).toEqual([
      { id: "50", ownerId: "1", filename: "poza.png", path: "uploads/monthly_2023_11/poza.png", size: expect.any(Number) },
      { id: "51", ownerId: "2", filename: "config.cfg", path: "uploads/monthly_2023_11/config.cfg", size: expect.any(Number) },
      { id: "52", ownerId: "2", filename: "harta.png", path: "uploads/monthly_2023_11/harta.png", size: expect.any(Number) },
    ]);
    expect((await a.reactionTypes()).map((r) => r.name)).toEqual(["Like", "Thanks", "Confused"]);
    expect((await drain((c, l) => a.reactions(c, l))).map((r) => [r.typeId, r.postId, r.memberId])).toEqual([
      ["2", "100", "2"],
      ["3", "101", "1"],
    ]);
  });

  test("conversațiile, urmăririle, ignorările, avertismentele, status-urile", async () => {
    const [conv] = await drain((c, l) => a.conversations(c, l));
    expect(conv).toMatchObject({ id: "30", title: "Salut din privat", starterId: "2" });
    expect(conv!.participants.map((p) => p.memberId)).toEqual(["2", "1"]);
    expect(conv!.messages.map((m) => [m.id, m.attachmentIds])).toEqual([
      ["300", ["52"]],
      ["301", []],
    ]);
    expect(await drain((c, l) => a.follows(c, l))).toEqual([
      { memberId: "1", type: "forum", targetId: "2" },
      { memberId: "2", type: "topic", targetId: "10" },
      { memberId: "2", type: "user", targetId: "1" },
    ]);
    expect(await drain((c, l) => a.ignores(c, l))).toEqual([{ memberId: "1", ignoredId: "3" }]);
    expect(await drain((c, l) => a.warnings(c, l))).toEqual([
      { id: "1", memberId: "3", issuerId: "1", points: 2, reason: "Limbaj nepotrivit", createdAt: expect.any(Date), expiresAt: null },
    ]);
    expect((await drain((c, l) => a.statuses(c, l))).map((s) => [s.id, s.parentId, s.authorId])).toEqual([
      ["5", null, "2"],
      ["r6", "5", "1"],
    ]);
  });

  test("numerele pe tip", async () => {
    expect(await a.counts()).toMatchObject({ members: 4, forums: 4, topics: 4, posts: 4, attachments: 3, prefixes: 1, reactions: 2, conversations: 1 });
    expect(await a.postsPerPage()).toBe(25);
  });
});

describe("adaptorul prefixed-schema", () => {
  const a: GcsSourceAdapter = new GcsPrefixedSchemaAdapter(createMemoryReader(prefixedSchemaFixture().tables));

  test("grupurile și membrii", async () => {
    expect((await a.groups()).map((g) => [g.id, g.role, g.color])).toEqual([
      ["1", "guest", null],
      ["2", "member", null],
      ["3", "admin", "#D62839"],
      ["4", "moderator", "#5EA2FF"],
      ["5", "other", "#F4B740"],
    ]);
    const [admin, mihai, spammer] = await drain((c, l) => a.members(c, l));
    expect(admin).toMatchObject({ secondaryGroupIds: ["2"], registrationIp: "203.0.113.1", signature: "[B]Admin[/B] din 2015", avatarPaths: [] });
    expect(admin!.password).toMatchObject({ scheme: "bcrypt" });
    expect(mihai!.password).toEqual({ scheme: "sha256s", hash: "3e5dedfcb825857dc9396887429dd2841d78d64c070a4dab72a7b91ca4d9aa54", salt: "saltsalt" });
    expect(mihai).toMatchObject({ birthday: { day: 12, month: 8, year: null }, title: "Veteran", avatarPaths: ["data/avatars/o/0/2.jpg", "data/avatars/h/0/2.jpg", "data/avatars/l/0/2.jpg"] });
    expect(spammer).toMatchObject({ password: null, ban: { reason: "Spam", expiresAt: null } });
  });

  test("câmpurile de profil: eticheta opțiunii, nu cheia ei", async () => {
    expect(await a.profileFields()).toEqual([{ id: "platforma", name: "Platformă", type: "SELECT", options: ["PC", "PlayStation 5"], required: false, visibility: "PUBLIC", position: 1, maxLength: 200 }]);
    expect(await drain((c, l) => a.profileValues(c, l))).toEqual([{ memberId: "2", fieldId: "platforma", value: "PC" }]);
  });

  test("forumurile (fără pagini) și matricea efectivă cu `reset` pe nod", async () => {
    expect((await a.forums()).map((f) => [f.id, f.type, f.parentId, f.description])).toEqual([
      ["1", "CATEGORY", null, ""],
      ["2", "FORUM", "1", "Noutăți despre server"],
    ]);
    const perms = await a.forumPermissions();
    expect(perms.find((p) => p.forumId === "2" && p.groupId === "2")?.actions).toEqual(["view", "read", "reply"]);
    expect(perms.find((p) => p.forumId === "2" && p.groupId === "3")?.actions).toEqual(["view", "read", "create", "reply"]);
    expect(perms.find((p) => p.forumId === "2" && p.groupId === "1")?.actions).toEqual(["view", "read"]);
  });

  test("topicurile, postările, atașamentele", async () => {
    expect(await a.prefixes()).toEqual([{ id: "1", name: "Întrebare", color: "#1C7ED6" }]);
    const topics = await drain((c, l) => a.topics(c, l));
    expect(topics[0]).toMatchObject({ id: "20", pinned: true, prefixId: "1", tags: ["server"], poll: { question: "Vii la lansare?", multiple: false } });
    expect(topics[1]).toMatchObject({ isRedirect: true });
    const posts = await drain((c, l) => a.posts(c, l));
    expect(posts.map((p) => [p.id, p.attachmentIds, p.ip, p.editedById])).toEqual([
      ["200", ["60"], null, null],
      ["201", [], "203.0.113.2", "2"],
    ]);
    expect(await drain((c, l) => a.attachments(c, l))).toEqual([
      { id: "60", ownerId: "1", filename: "afis.png", path: "internal_data/attachments/1/1060-aaaa.data", size: expect.any(Number) },
      { id: "61", ownerId: "2", filename: "dovada.png", path: "internal_data/attachments/1/1061-bbbb.data", size: expect.any(Number) },
    ]);
  });

  test("conversațiile, urmăririle pe faze, status-urile pe faze", async () => {
    const [conv] = await drain((c, l) => a.conversations(c, l));
    expect(conv!.messages.map((m) => [m.id, m.attachmentIds])).toEqual([
      ["400", ["61"]],
      ["401", []],
    ]);
    expect(await drain((c, l) => a.follows(c, l))).toEqual([
      { memberId: "2", type: "forum", targetId: "2" },
      { memberId: "2", type: "topic", targetId: "20" },
      { memberId: "2", type: "user", targetId: "1" },
    ]);
    expect((await drain((c, l) => a.statuses(c, l))).map((s) => [s.id, s.parentId])).toEqual([
      ["7", null],
      ["c8", "7"],
    ]);
    expect(await a.postsPerPage()).toBe(20);
    expect(await a.counts()).toMatchObject({ forums: 2, follows: 3, attachments: 2 });
  });
});
