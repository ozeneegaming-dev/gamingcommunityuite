import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../../test/world";
import { GcsRedisRateLimiter } from "../../auth/rateLimit";
import { GcsAttachmentService } from "../../content/files/attachments";
import { GcsLocalFileStore } from "../../content/files/localStore";
import { GcsReactionService } from "../../content/reactions";
import type { GcsEvent } from "../../events";
import type { GcsActor } from "../../permissions/types";
import { accountDataHandler, fileDataHandler, followDataHandler, notificationDataHandler, reactionDataHandler } from "./coreHandlers";
import { DELETED_EMAIL_DOMAIN, GcsMemberRemovalService } from "./service";
import type { GcsMemberDataHandler } from "./types";

let w: GcsTestWorld;
let removal: GcsMemberRemovalService;
let reactions: GcsReactionService;
let attachments: GcsAttachmentService;
let root: GcsActor;
let events: GcsEvent[];
/** Autorii conținutului de test („test.item”), pentru reacții. */
const authors = new Map<string, string>();

function service(opts: { inlineLimit?: number; batchSize?: number } = {}) {
  const s = new GcsMemberRemovalService({
    db: w.db,
    bus: w.bus,
    acp: w.acp,
    settings: { get: async <T>() => 7 as T },
    jobs: null,
    ...opts,
  });
  s.register(reactionDataHandler({ db: w.db, reactions }));
  s.register(followDataHandler({ db: w.db }));
  s.register(notificationDataHandler({ db: w.db }));
  s.register(accountDataHandler({ db: w.db }));
  s.register(fileDataHandler({ db: w.db, attachments }));
  return s;
}

beforeEach(async () => {
  w = await createWorld();
  reactions = new GcsReactionService({ db: w.db, bus: w.bus, cache: w.cache, acp: w.acp });
  reactions.registerContent("test.item", { author: async (id) => authors.get(id) ?? null, canView: async () => true, tags: async () => [] });
  attachments = new GcsAttachmentService({
    db: w.db,
    store: new GcsLocalFileStore(path.join(os.tmpdir(), `gcs-removal-${process.pid}`)),
    permissions: w.permissions,
    rateLimiter: new GcsRedisRateLimiter(w.redis),
  });
  authors.clear();
  events = [];
  for (const name of ["user.deleting", "user.deleted", "user.merged", "user.merging"]) w.bus.on(name, async (e) => void events.push(e));
  removal = service();
  root = await w.actorFor(await w.createUser("Fondator", "root_admin"));
});

/** Un membru cu sesiune, parolă, Discord și 2FA. */
async function memberWithLogin(name: string, providers: string[] = ["credential", "discord"]) {
  const user = await w.createUser(name, "member");
  for (const providerId of providers) {
    await w.db.account.create({ data: { userId: user.id, providerId, accountId: `${providerId}-${user.id}`, password: providerId === "credential" ? "hash" : null } });
  }
  await w.db.session.create({ data: { userId: user.id, token: `tok-${user.id}`, expiresAt: new Date(Date.now() + 3600_000) } });
  await w.db.twoFactor.create({ data: { userId: user.id, secret: "s", backupCodes: "b" } });
  await w.db.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
  return user;
}

describe("regulile de siguranță", () => {
  test("cere dreptul `delete` pe fișa membrilor", async () => {
    const admin = await w.actorFor(await w.createUser("Admin", "admin"));
    const target = await w.createUser("Tinta", "member");
    await expect(removal.requestDelete(admin, target.id, { mode: "KEEP_CONTENT", keepMessages: false })).rejects.toMatchObject({ code: "forbidden" });
    await w.grantAdmin(["members.members"]);
    await removal.requestDelete(admin, target.id, { mode: "KEEP_CONTENT", keepMessages: false });
    expect(await w.db.user.findUnique({ where: { id: target.id } })).toBeNull();
  });

  test("nu te poți șterge pe tine și nu poți fi sursa unei uniri", async () => {
    const other = await w.createUser("Altul", "member");
    await expect(removal.requestDelete(root, root.userId!, { mode: "KEEP_CONTENT", keepMessages: false })).rejects.toMatchObject({ params: { reason: "removal_self" } });
    await expect(removal.requestMerge(root, root.userId!, other.id)).rejects.toMatchObject({ params: { reason: "removal_self" } });
  });

  test("un Root Admin e protejat de non-Root; ultimul Root Admin nu poate cere ștergerea", async () => {
    await w.grantAdmin(["members.members"]);
    const admin = await w.actorFor(await w.createUser("Admin", "admin"));
    const otherRoot = await w.createUser("Root2", "root_admin");
    const member = await w.createUser("Membru", "member");
    await expect(removal.requestDelete(admin, otherRoot.id, { mode: "KEEP_CONTENT", keepMessages: false })).rejects.toMatchObject({ params: { reason: "root_protected" } });
    await expect(removal.requestMerge(admin, member.id, otherRoot.id)).rejects.toMatchObject({ params: { reason: "root_protected" } });
    // Doi Root Admini: unul îl poate șterge pe celălalt.
    await removal.requestDelete(root, otherRoot.id, { mode: "KEEP_CONTENT", keepMessages: false });
    // A rămas unul singur: nu-și poate cere ștergerea.
    await expect(removal.requestSelf(root.userId!, null)).rejects.toMatchObject({ params: { reason: "last_root" } });
  });

  test("nu se unește un cont cu el însuși; o a doua operație pe același cont e refuzată", async () => {
    const a = await w.createUser("Aaa", "member");
    const b = await w.createUser("Bbb", "member");
    await expect(removal.requestMerge(root, a.id, a.id)).rejects.toMatchObject({ code: "validation" });
    const big = service({ inlineLimit: -1 });
    await big.requestDelete(root, a.id, { mode: "KEEP_CONTENT", keepMessages: false });
    await expect(big.requestDelete(root, a.id, { mode: "KEEP_CONTENT", keepMessages: false })).rejects.toMatchObject({ params: { reason: "removal_in_progress" } });
    // Ținta unei uniri nu poate fi în curs de ștergere.
    await expect(big.requestMerge(root, b.id, a.id)).rejects.toMatchObject({ params: { reason: "removal_in_progress" } });
  });
});

describe("ștergerea", () => {
  test("blochează contul pe loc, apoi șterge rândul; jurnalul are doar id-ul și numele", async () => {
    const user = await memberWithLogin("Victima");
    const big = service({ inlineLimit: -1 });
    const row = await big.requestDelete(root, user.id, { mode: "KEEP_CONTENT", keepMessages: false });
    expect(row.status).toBe("QUEUED");
    const blocked = await w.db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(blocked.email).toBe(`deleted-${row.id}${DELETED_EMAIL_DOMAIN}`);
    expect(blocked.twoFactorEnabled).toBe(false);
    expect(await w.db.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await w.db.account.count({ where: { userId: user.id } })).toBe(0);
    expect(await w.db.twoFactor.count({ where: { userId: user.id } })).toBe(0);

    await big.run(row.id);
    expect(await w.db.user.findUnique({ where: { id: user.id } })).toBeNull();
    const done = await w.db.memberRemoval.findUniqueOrThrow({ where: { id: row.id } });
    expect(done).toMatchObject({ status: "DONE", userName: "Victima" });
    expect(Object.keys(done.steps as object).sort()).toEqual([...big.stepKeys()].sort());
    expect(Object.values(done.steps as object).every((s: { done: boolean }) => s.done)).toBe(true);
    const audit = await w.db.auditLog.findMany({ where: { targetId: user.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(["user.delete.request", "user.delete.done"]);
    expect(JSON.stringify(audit)).not.toContain("@mail.com");
    expect(events.map((e) => e.name)).toEqual(["user.deleting", "user.deleted"]);
  });

  test("un cont mic se procesează imediat", async () => {
    const user = await w.createUser("Mic", "member");
    const row = await removal.requestDelete(root, user.id, { mode: "DELETE_CONTENT", keepMessages: false });
    expect(row.status).toBe("DONE");
    expect(await w.db.user.findUnique({ where: { id: user.id } })).toBeNull();
  });

  test("o rulare întreruptă se reia de unde a rămas; după 3 eșecuri devine FAILED, iar „Reia” o termină", async () => {
    const user = await w.createUser("Mare", "member");
    let left = 5;
    let failNext = true;
    const calls: number[] = [];
    const flaky: GcsMemberDataHandler = {
      key: "flaky",
      summary: async () => [{ key: "x", count: 5 }],
      erase: async () => {
        if (left === 3 && failNext) {
          failNext = false;
          throw new Error("cădere");
        }
        if (left === 0) return 0;
        left--;
        calls.push(left);
        return 1;
      },
      merge: async () => 0,
    };
    const s = service({ inlineLimit: -1 });
    s.register(flaky);
    const row = await s.requestDelete(root, user.id, { mode: "KEEP_CONTENT", keepMessages: false });
    await s.run(row.id);
    let state = await w.db.memberRemoval.findUniqueOrThrow({ where: { id: row.id } });
    expect(state).toMatchObject({ status: "QUEUED", attempts: 1, error: "cădere", currentStep: "flaky" });
    expect((state.steps as Record<string, { processed: number }>).flaky!.processed).toBe(2);
    await s.run(row.id);
    state = await w.db.memberRemoval.findUniqueOrThrow({ where: { id: row.id } });
    expect(state.status).toBe("DONE");
    expect((state.steps as Record<string, { processed: number }>).flaky!.processed).toBe(5);
    expect(calls).toEqual([4, 3, 2, 1, 0]);

    // Un handler care eșuează mereu: după 3 încercări rămâne FAILED; „Reia” o pune înapoi în coadă.
    const other = await w.createUser("Eșuat", "member");
    let broken = true;
    const s2 = service({ inlineLimit: -1 });
    s2.register({ key: "broken", summary: async () => [], erase: async () => (broken ? Promise.reject(new Error("mereu")) : 0), merge: async () => 0 });
    const r2 = await s2.requestDelete(root, other.id, { mode: "KEEP_CONTENT", keepMessages: false });
    for (let i = 0; i < 3; i++) await s2.run(r2.id);
    expect((await w.db.memberRemoval.findUniqueOrThrow({ where: { id: r2.id } })).status).toBe("FAILED");
    await s2.run(r2.id);
    expect((await w.db.memberRemoval.findUniqueOrThrow({ where: { id: r2.id } })).status).toBe("FAILED");
    broken = false;
    await s2.retry(root, r2.id);
    await s2.run(r2.id);
    expect((await w.db.memberRemoval.findUniqueOrThrow({ where: { id: r2.id } })).status).toBe("DONE");
  });

  test("două rulări simultane: doar una lucrează", async () => {
    const user = await w.createUser("Dublu", "member");
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const s = service({ inlineLimit: -1 });
    s.register({
      key: "slow",
      summary: async () => [],
      erase: async () => {
        calls++;
        await gate;
        return 0;
      },
      merge: async () => 0,
    });
    const row = await s.requestDelete(root, user.id, { mode: "KEEP_CONTENT", keepMessages: false });
    const first = s.run(row.id);
    await new Promise((r) => setTimeout(r, 100));
    await s.run(row.id);
    release();
    await first;
    expect(calls).toBe(1);
    expect((await w.db.memberRemoval.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("DONE");
  });
});

describe("cererea membrului", () => {
  test("perioada de răzgândire, anularea și sweep-ul", async () => {
    let now = new Date("2026-10-09T10:00:00Z");
    const s = new GcsMemberRemovalService({ db: w.db, bus: w.bus, acp: w.acp, settings: { get: async <T>() => 7 as T }, jobs: null, now: () => now });
    const user = await memberWithLogin("Plecat");
    const first = await s.requestSelf(user.id, "203.0.113.9");
    expect(first).toMatchObject({ status: "SCHEDULED", source: "SELF", mode: "KEEP_CONTENT", runAfter: new Date("2026-10-16T10:00:00Z") });
    await expect(s.requestSelf(user.id, null)).rejects.toMatchObject({ params: { reason: "removal_in_progress" } });
    expect((await s.pendingFor(user.id))?.id).toBe(first.id);
    await s.cancelSelf(user.id, null);
    expect(await s.pendingFor(user.id)).toBeNull();
    expect((await w.db.auditLog.findMany({ where: { targetId: user.id } })).map((a) => a.action)).toEqual(["user.delete.self_request", "user.delete.self_cancel"]);

    const second = await s.requestSelf(user.id, null);
    // Înainte de termen, sweep-ul nu face nimic; contul funcționează.
    expect(await s.sweep(now)).toEqual({ started: 0, requeued: 0 });
    expect(await w.db.session.count({ where: { userId: user.id } })).toBe(1);
    now = new Date("2026-10-16T10:00:01Z");
    expect((await s.sweep(now)).started).toBe(1);
    expect(await w.db.memberRemoval.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ status: "QUEUED" });
    expect(await w.db.session.count({ where: { userId: user.id } })).toBe(0);
    await s.run(second.id);
    expect(await w.db.user.findUnique({ where: { id: user.id } })).toBeNull();
  });

  test("staff-ul poate anula sau rula acum o cerere (drept `members.gdpr` edit)", async () => {
    const user = await w.createUser("Cerere", "member");
    const row = await removal.requestSelf(user.id, null);
    const admin = await w.actorFor(await w.createUser("Admin", "admin"));
    await expect(removal.cancel(admin, row.id)).rejects.toMatchObject({ code: "forbidden" });
    await w.grantAdmin(["members.gdpr"]);
    await removal.cancel(admin, row.id);
    expect((await w.db.memberRemoval.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("CANCELLED");
    const again = await removal.requestSelf(user.id, null);
    await removal.runNow(admin, again.id);
    await removal.run(again.id);
    expect(await w.db.user.findUnique({ where: { id: user.id } })).toBeNull();
  });

  test("o ștergere pornită de staff înlocuiește cererea membrului aflată în perioada de răzgândire", async () => {
    const user = await w.createUser("Graba", "member");
    const pending = await removal.requestSelf(user.id, null);
    const row = await removal.requestDelete(root, user.id, { mode: "KEEP_CONTENT", keepMessages: false });
    expect(row.status).toBe("DONE");
    expect(await w.db.memberRemoval.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ status: "CANCELLED", error: "superseded" });
  });

  test("sweep-ul repune în coadă o rulare căzută (fără heartbeat de 10 minute)", async () => {
    const user = await w.createUser("Cazut", "member");
    const s = service({ inlineLimit: -1 });
    const row = await s.requestDelete(root, user.id, { mode: "KEEP_CONTENT", keepMessages: false });
    await w.db.memberRemoval.update({ where: { id: row.id }, data: { status: "RUNNING", heartbeatAt: new Date(Date.now() - 11 * 60_000) } });
    expect((await s.sweep()).requeued).toBe(1);
    await s.run(row.id);
    expect((await w.db.memberRemoval.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("DONE");
  });
});

describe("unirea", () => {
  test("conturile de login: furnizorii pe care ținta nu-i are trec în țintă; restul se șterg", async () => {
    const source = await memberWithLogin("SteamDublu", ["steam", "discord"]);
    const target = await memberWithLogin("Principal", ["credential", "discord"]);
    const preview = await removal.mergePreview(root, source.id, target.id);
    expect(preview.logins).toEqual(expect.arrayContaining([{ providerId: "steam", action: "move" }, { providerId: "discord", action: "drop" }]));
    await removal.requestMerge(root, source.id, target.id);
    const accounts = await w.db.account.findMany({ where: { userId: target.id }, orderBy: { providerId: "asc" } });
    expect(accounts.map((a) => [a.providerId, a.accountId])).toEqual([
      ["credential", `credential-${target.id}`],
      ["discord", `discord-${target.id}`],
      ["steam", `steam-${source.id}`],
    ]);
    expect(await w.db.user.findUnique({ where: { id: source.id } })).toBeNull();
    expect(await w.db.session.count({ where: { userId: target.id } })).toBe(1);
    expect(events.map((e) => e.name)).toEqual(["user.merging", "user.merged"]);
    expect(events[1]!.payload).toMatchObject({ sourceId: source.id, targetId: target.id });
  });
});

describe("handler-ele nucleului", () => {
  async function react(userId: string, contentId: string, weight = 1) {
    const reaction = await w.db.reaction.upsert({ where: { key: `w${weight}` }, update: {}, create: { key: `w${weight}`, label: "x", symbol: "x", color: "#fff", weight } });
    await w.db.contentReaction.create({ data: { contentType: "test.item", contentId, userId, reactionId: reaction.id } });
    const author = authors.get(contentId);
    if (author) await w.db.user.update({ where: { id: author }, data: { reputation: { increment: weight } } });
  }
  const rep = async (id: string) => (await w.db.user.findUniqueOrThrow({ where: { id } })).reputation;

  test("reacțiile date se șterg, iar reputația autorilor scade", async () => {
    const leaving = await w.createUser("Pleaca", "member");
    const author = await w.createUser("Autor", "member");
    authors.set("1", author.id);
    authors.set("2", author.id);
    await react(leaving.id, "1", 2);
    await react(leaving.id, "2", 1);
    expect(await rep(author.id)).toBe(3);
    await removal.requestDelete(root, leaving.id, { mode: "KEEP_CONTENT", keepMessages: false });
    expect(await rep(author.id)).toBe(0);
  });

  test("unirea reacțiilor: fără reacții la propriul conținut, fără dubluri; reputația sursei trece la țintă", async () => {
    const source = await w.createUser("Sursa", "member");
    const target = await w.createUser("Tinta", "member");
    const other = await w.createUser("Altul", "member");
    authors.set("t1", target.id); // conținutul țintei
    authors.set("s1", source.id); // conținutul sursei
    authors.set("o1", other.id);
    authors.set("o2", other.id);
    await react(source.id, "t1", 1); // sursa → ținta: dispare (ținta -1)
    await react(target.id, "s1", 2); // ținta → sursa: dispare (sursa -2)
    await react(source.id, "o1", 1); // amândouă pe o1: rămâne doar a țintei (altul -1)
    await react(target.id, "o1", 1);
    await react(source.id, "o2", 1); // trece la țintă
    await react(other.id, "s1", 3); // reputația primită de sursă: trece la țintă
    expect([await rep(source.id), await rep(target.id), await rep(other.id)]).toEqual([5, 1, 3]);

    const s = service({ batchSize: 1 });
    await s.requestMerge(root, source.id, target.id);
    const rows = await w.db.contentReaction.findMany({ orderBy: [{ contentId: "asc" }, { userId: "asc" }], select: { contentId: true, userId: true } });
    expect(rows).toEqual(
      [
        { contentId: "o1", userId: target.id },
        { contentId: "o2", userId: target.id },
        { contentId: "s1", userId: other.id },
      ].sort((a, b) => a.contentId.localeCompare(b.contentId) || a.userId.localeCompare(b.userId)),
    );
    // Ținta: 1 (t1) − 1 (reacția sursei pe t1) + 3 (reputația rămasă a sursei, din s1) = 3. Altul: 3 − 1 (dublura pe o1) = 2.
    expect(await rep(target.id)).toBe(3);
    expect(await rep(other.id)).toBe(2);
  });

  test("urmăririle: la ștergere scade `followersCount`; la unire fără dubluri și fără a se urmări pe sine", async () => {
    const leaving = await w.createUser("Pleaca", "member");
    const star = await w.createUser("Vedeta", "member");
    await w.db.follow.createMany({ data: [{ userId: leaving.id, contentType: "user", contentId: star.id }, { userId: star.id, contentType: "user", contentId: leaving.id }] });
    await w.db.user.update({ where: { id: star.id }, data: { followersCount: 1 } });
    await removal.requestDelete(root, leaving.id, { mode: "KEEP_CONTENT", keepMessages: false });
    expect((await w.db.user.findUniqueOrThrow({ where: { id: star.id } })).followersCount).toBe(0);
    expect(await w.db.follow.count()).toBe(0);

    const source = await w.createUser("Sursa", "member");
    const target = await w.createUser("Tinta", "member");
    const fan = await w.createUser("Fan", "member");
    const fan2 = await w.createUser("Fan2", "member");
    await w.db.follow.createMany({
      data: [
        { userId: source.id, contentType: "user", contentId: target.id }, // sursa → ținta: dispare
        { userId: source.id, contentType: "topic", contentId: "7" }, // dublură cu a țintei
        { userId: target.id, contentType: "topic", contentId: "7" },
        { userId: source.id, contentType: "user", contentId: fan.id }, // trece la țintă
        { userId: fan.id, contentType: "user", contentId: source.id }, // fanul sursei urmărește acum ținta
        { userId: fan2.id, contentType: "user", contentId: source.id }, // dublură: fan2 urmărea deja ținta
        { userId: fan2.id, contentType: "user", contentId: target.id },
        { userId: target.id, contentType: "user", contentId: source.id }, // ținta → sursa: dispare
      ],
    });
    await removal.requestMerge(root, source.id, target.id);
    const follows = await w.db.follow.findMany({ select: { userId: true, contentType: true, contentId: true } });
    expect(follows).toHaveLength(4);
    expect(follows).toEqual(
      expect.arrayContaining([
        { userId: target.id, contentType: "topic", contentId: "7" },
        { userId: target.id, contentType: "user", contentId: fan.id },
        { userId: fan.id, contentType: "user", contentId: target.id },
        { userId: fan2.id, contentType: "user", contentId: target.id },
      ]),
    );
    expect((await w.db.user.findUniqueOrThrow({ where: { id: target.id } })).followersCount).toBe(2);
    expect((await w.db.user.findUniqueOrThrow({ where: { id: fan.id } })).followersCount).toBe(1);
  });

  test("notificările: la unire, o necitită din același grup ca a țintei se șterge", async () => {
    const source = await w.createUser("Sursa", "member");
    const target = await w.createUser("Tinta", "member");
    const n = (userId: string, groupKey: string, read = false) => ({ userId, type: "t", targetType: "x", targetId: "1", groupKey, data: {}, readAt: read ? new Date() : null });
    await w.db.notification.createMany({ data: [n(source.id, "g1"), n(target.id, "g1"), n(source.id, "g2"), n(source.id, "g1", true)] });
    await removal.requestMerge(root, source.id, target.id);
    const rows = await w.db.notification.findMany({ where: { userId: target.id }, select: { groupKey: true, readAt: true } });
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.readAt === null).map((r) => r.groupKey).sort()).toEqual(["g1", "g2"]);
  });

  test("bannurile pe email rămân fără cont; IP-urile din jurnal se golesc; la unire avertismentele și bannul trec la țintă", async () => {
    const spammer = await w.createUser("Spam", "member");
    await w.db.ban.create({ data: { type: "EMAIL", value: "spam@x.ro", userId: spammer.id, reason: "spam" } });
    await w.db.auditLog.create({ data: { actorId: spammer.id, action: "x", targetType: "x", targetId: "1", ip: "198.51.100.7" } });
    const preview = await removal.preview(root, spammer.id);
    expect(preview.notes).toEqual([expect.objectContaining({ key: "bans_kept", step: "account" })]);
    await removal.requestDelete(root, spammer.id, { mode: "KEEP_CONTENT", keepMessages: false });
    expect(await w.db.ban.findFirst({ where: { value: "spam@x.ro" } })).toMatchObject({ userId: null });
    expect(await w.db.auditLog.findFirst({ where: { actorId: spammer.id, action: "x" } })).toMatchObject({ ip: null });

    const source = await w.createUser("Sursa", "member");
    const target = await w.createUser("Tinta", "member");
    await w.db.warning.create({ data: { userId: source.id, points: 2, reason: "r" } });
    await w.db.ban.create({ data: { type: "ACCOUNT", value: source.id, userId: source.id, reason: "r" } });
    const notes = (await removal.mergePreview(root, source.id, target.id)).notes.map((n) => n.key);
    expect(notes).toContain("ban_moves");
    await removal.requestMerge(root, source.id, target.id);
    expect(await w.db.warning.count({ where: { userId: target.id } })).toBe(1);
    expect(await w.db.ban.findFirst({ where: { type: "ACCOUNT" } })).toMatchObject({ userId: target.id, value: target.id });
  });

  test("fișierele: cele nelegate și avatarul se șterg; cele legate de conținut rămân fără proprietar", async () => {
    const user = await w.createUser("Fisiere", "member");
    const file = (contentType: string | null, contentId: string | null) => ({ ownerId: user.id, storageKey: `k-${Math.random()}`, filename: "f", mime: "image/png", size: 1, contentType, contentId });
    await w.db.attachment.createMany({ data: [file(null, null), file(null, null), file("user.avatar", user.id), file("forums.post", "5")] });
    const big = service({ inlineLimit: -1, batchSize: 1 });
    const row = await big.requestDelete(root, user.id, { mode: "KEEP_CONTENT", keepMessages: false });
    await big.run(row.id);
    const left = await w.db.attachment.findMany();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ contentType: "forums.post", ownerId: null });
    expect((await w.db.memberRemoval.findUniqueOrThrow({ where: { id: row.id } })).steps).toMatchObject({ files: { done: true, processed: 4 } });
  });
});
