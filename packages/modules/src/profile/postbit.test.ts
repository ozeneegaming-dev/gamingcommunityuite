import type { GcsActor } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { GcsPostbitService, mottoText, xpProgress } from "./postbit";

let w: GcsProfileWorld;
let postbit: GcsPostbitService;

beforeEach(async () => {
  w = await createProfileWorld();
  postbit = new GcsPostbitService({ db: w.db, cache: w.cache, permissions: w.permissions, settings: w.settings });
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

/** Un autor cu 2 insigne și câmpurile completate. */
async function author(name: string) {
  const user = await w.createUser(name, "member");
  const badges = await w.db.badge.findMany({ take: 2, orderBy: { id: "asc" } });
  for (const b of badges) await w.db.userBadge.create({ data: { userId: user.id, badgeId: b.id } });
  for (const f of await w.db.profileField.findMany({ where: { showInPostbit: true } })) {
    await w.db.profileFieldValue.create({ data: { userId: user.id, fieldId: f.id, value: f.type === "IMAGE_SELECT" ? "AWP" : `${f.key}-${name}` } });
  }
  return user;
}

async function fields() {
  await w.db.profileField.create({ data: { key: "pb_country", label: "Țară", icon: "fa-solid fa-flag", showInPostbit: true, position: 2 } });
  await w.db.profileField.create({ data: { key: "pb_secret", label: "Steam", showInPostbit: true, visibility: "STAFF", position: 1 } });
  await w.db.profileField.create({
    data: { key: "pb_weapon", label: "Armă", type: "IMAGE_SELECT", options: ["AWP", "AK-47"], optionImages: { AWP: "/files/awp" }, showInPostbit: true, position: 3 },
  });
}

/** Un client care numără interogările (modele și SQL brut). */
function counting(): { db: PrismaClient; count: () => number } {
  let n = 0;
  const db = w.db.$extends({
    query: {
      async $allOperations({ args, query }) {
        n++;
        return query(args);
      },
    },
  }) as unknown as PrismaClient;
  return { db, count: () => n };
}

describe("postbit", () => {
  test("numărul de interogări nu crește cu numărul de autori", async () => {
    await fields();
    const authors = await Promise.all(["A1", "A2", "A3", "A4", "A5"].map(author));
    const viewer = w.member;
    // Încălzește cache-ul (câmpurile și scara de XP).
    await postbit.forAuthors(viewer, [authors[0]!.id]);

    const one = counting();
    await new GcsPostbitService({ db: one.db, cache: w.cache, permissions: w.permissions, settings: w.settings }).forAuthors(viewer, [authors[0]!.id]);
    const five = counting();
    const data = await new GcsPostbitService({ db: five.db, cache: w.cache, permissions: w.permissions, settings: w.settings }).forAuthors(
      viewer,
      authors.map((a) => a.id),
    );
    expect(five.count()).toBe(one.count());
    expect(data.size).toBe(5);
    expect(data.get(authors[3]!.id)?.badges.count).toBe(2);
    expect(data.get(authors[3]!.id)?.badges.recent).toHaveLength(2);
    // Insignele vin cu adresa desenului și cu descrierea (tooltip-ul din postbit).
    for (const b of data.get(authors[3]!.id)!.badges.recent) {
      expect(b.art).toMatch(/^\/badge-art\/v1\/[a-z]+-[a-z]+-[0-9a-f]{6}-i-solid-[a-z0-9-]+\.svg$/);
      expect(typeof b.description).toBe("string");
    }
  });

  test("un câmp vizibil doar staff-ului lipsește pentru membri, apare pentru autor; ordinea din ACP e respectată", async () => {
    await fields();
    const a = await author("Ana");
    const forMember = (await postbit.forAuthors(w.member, [a.id])).get(a.id)!;
    // Doar câmpurile testului (cele implicite ale site-ului apar și ele în postbit, dar fără valori aici).
    const own = (fields: { key: string }[]) => fields.map((f) => f.key).filter((k) => k.startsWith("pb_"));
    expect(own(forMember.fields)).toEqual(["pb_country", "pb_weapon"]);
    const ownActor: GcsActor = await w.actorFor(a);
    expect(own((await postbit.forAuthors(ownActor, [a.id])).get(a.id)!.fields)).toEqual(["pb_secret", "pb_country", "pb_weapon"]);

    await w.settings.set("postbit.fields", ["pb_weapon", "pb_country"], w.root);
    expect(own((await postbit.forAuthors(w.member, [a.id])).get(a.id)!.fields)).toEqual(["pb_weapon", "pb_country"]);
  });

  test("opțiunea `IMAGE_SELECT` vine cu imaginea ei; iconița câmpului e păstrată", async () => {
    await fields();
    const a = await author("Bogdan");
    const data = (await postbit.forAuthors(w.member, [a.id])).get(a.id)!;
    expect(data.fields.find((f) => f.key === "pb_weapon")).toMatchObject({ value: "AWP", image: "/files/awp" });
    expect(data.fields.find((f) => f.key === "pb_country")).toMatchObject({ icon: "fa-solid fa-flag" });
  });

  test("bara de XP arată progresul spre rangul următor; VIP-ul activ e marcat", async () => {
    expect(xpProgress(150, [{ name: "Nou", minPoints: 0 }, { name: "Activ", minPoints: 100 }, { name: "Veteran", minPoints: 250 }])).toEqual({
      points: 150,
      floor: 100,
      next: 250,
      nextRank: "Veteran",
      percent: 33,
    });
    expect(xpProgress(900, [{ name: "Veteran", minPoints: 250 }])).toMatchObject({ next: null, percent: 100 });

    const a = await author("Vip");
    const admin = await w.actorFor(await w.createUser("Adm", "root_admin"));
    await w.vip.grant(admin, { userId: a.id, groupId: w.groups.vip_gold!, days: 30 });
    await w.db.user.update({ where: { id: a.id }, data: { lastActiveAt: new Date() } });
    const data = (await postbit.forAuthors(w.member, [a.id])).get(a.id)!;
    expect(data).toMatchObject({ vip: true, online: true, group: { key: "vip_gold" } });
    expect(data.vipName).toBeTruthy();
  });

  test("topicurile, nivelul rangului și motto-ul (ultimul status propriu, ca text) vin pentru toți autorii deodată", async () => {
    const [a, b] = await Promise.all([author("Topa"), author("Topb")]);
    const forum = await w.db.forum.create({ data: { name: "Postbit", slug: "postbit" } });
    for (const [user, n] of [[a, 2], [b, 1]] as const) {
      for (let i = 0; i < n; i++) await w.db.topic.create({ data: { forumId: forum.id, title: `T${i}`, slug: `t${i}`, authorId: user.id } });
    }
    // Un topic ascuns nu se numără.
    await w.db.topic.create({ data: { forumId: forum.id, title: "Ascuns", slug: "ascuns", authorId: b.id, visibility: "HIDDEN" } });
    const ranks = await w.db.rank.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] });
    await w.db.user.update({ where: { id: a.id }, data: { rankId: ranks[1]!.id } });
    await w.db.statusUpdate.create({ data: { profileUserId: a.id, authorId: a.id, contentJson: {}, contentHtml: "<p>Vechiul motto</p>", createdAt: new Date(Date.now() - 60_000) } });
    await w.db.statusUpdate.create({ data: { profileUserId: a.id, authorId: a.id, contentJson: {}, contentHtml: "<p>Noul <strong>motto</strong> &amp; atât</p>" } });
    // Statusul scris de altcineva pe peretele lui B nu e motto-ul lui B.
    await w.db.statusUpdate.create({ data: { profileUserId: b.id, authorId: a.id, contentJson: {}, contentHtml: "<p>Salut, B!</p>" } });

    const data = await postbit.forAuthors(w.member, [a.id, b.id]);
    expect(data.get(a.id)).toMatchObject({ topicsCount: 2, rankLevel: 2, motto: "Noul motto & atât" });
    expect(data.get(b.id)).toMatchObject({ topicsCount: 1, motto: null });
  });

  test("motto-ul e scurtat cu „…”", () => {
    expect(mottoText(`<p>${"a".repeat(200)}</p>`, 10)).toBe(`${"a".repeat(9)}…`);
    expect(mottoText("<p> </p>")).toBeNull();
  });
});
