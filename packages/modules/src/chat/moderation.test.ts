import { GcsForbidden, GcsRateLimited, GcsValidationError, type GcsActor, type GcsRealtime } from "@gcs/core";
import { jsonPath } from "@gcs/db";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { GcsChatService } from "./chat";
import { GcsChatExtensions } from "./extensions";
import { defaultChannelPermissions } from "./index";
import { chatMemberData } from "./memberData";
import { GcsChatModeration } from "./moderation";
import { GcsChatQueries } from "./queries";
import { CHAT_MOD_RIGHTS, GcsChatRights, parseAccessCommand } from "./rights";

let w: GcsProfileWorld;
let chat: GcsChatService;
let queries: GcsChatQueries;
let mod: GcsChatModeration;
let sent: { room: string; event: string; data: unknown }[];

beforeEach(async () => {
  w = await createProfileWorld();
  sent = [];
  // Ce pleacă live (camerele `chat:*` și `user:*`), fără Redis.
  const realtime = { publish: async (room: string, event: string, data: unknown) => void sent.push({ room, event, data }) } as unknown as GcsRealtime;
  const extensions = new GcsChatExtensions();
  const rights = new GcsChatRights({ db: w.db, permissions: w.permissions });
  chat = new GcsChatService({ db: w.db, bus: w.bus, permissions: w.permissions, settings: w.settings, rateLimiter: w.rateLimiter, realtime, acp: w.acp, attachments: w.attachments, extensions, rights });
  queries = new GcsChatQueries({ db: w.db, permissions: w.permissions, extensions, rights });
  mod = new GcsChatModeration({ db: w.db, permissions: w.permissions, settings: w.settings, realtime, acp: w.acp, chat, warnings: w.warnings, notifications: w.notifications, reports: w.reports });
  await w.settings.set("chat.flood_seconds", 0, w.root);
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

async function member(name: string, group = "member"): Promise<GcsActor> {
  return w.actorFor(await w.createUser(name, group));
}
const noFlood = (a: GcsActor) => w.kv.del(`gcs:rl:chat:${a.userId}`);
const events = (event: string) => sent.filter((s) => s.event === event);

describe("comanda /acces", () => {
  test("argumentele în orice ordine: membrul, drepturile (aliasuri), durata, camera; /revoca; textul obișnuit nu e comandă", () => {
    expect(parseAccessCommand("/acces @Kaze mute,kick 7d #general")).toEqual({ command: "acces", name: "Kaze", rights: ["mute", "kick"], ms: 7 * 86_400_000, room: "general", errors: [] });
    expect(parseAccessCommand("/acces #general 12h @Kaze avertisment,ascunde")).toMatchObject({ name: "Kaze", rights: ["warn", "hide"], ms: 12 * 3_600_000, room: "general" });
    expect(parseAccessCommand("/acces @Kaze toate")).toMatchObject({ rights: [...CHAT_MOD_RIGHTS], ms: null, room: null });
    expect(parseAccessCommand("/acces")).toEqual({ command: "acces", name: null, rights: null, ms: null, room: null, errors: [] });
    expect(parseAccessCommand("/revoca @Kaze")).toEqual({ command: "revoca", name: "Kaze", errors: [] });
    expect(parseAccessCommand("/acces @Kaze zbor 3x")?.errors).toEqual(["zbor", "3x"]);
    expect(parseAccessCommand("salut /acces")).toBeNull();
    expect(parseAccessCommand("/roll 6")).toBeNull();
  });
});

describe("drepturile", () => {
  test("implicit: Root are tot, moderatorul pe cele obișnuite, membrul nimic; accesul dat se adaugă pe camerele lui și expiră", async () => {
    expect(await mod.rights.rights(w.root, "general")).toEqual([...CHAT_MOD_RIGHTS]);
    expect(await mod.rights.rights(w.moderator, "general")).toEqual(["pin", "hide", "delete_any", "warn", "mute", "kick", "slow_user"]);
    const a = await member("Ana");
    expect(await mod.rights.rights(a, "general")).toEqual([]);
    await w.db.chatChannel.create({ data: { key: "offtopic", name: "Off-topic" } });
    await w.db.chatModeratorGrant.create({ data: { userId: a.userId!, rights: ["mute", "kick"], rooms: ["general"] } });
    expect(await mod.rights.rights(a, "general")).toEqual(["mute", "kick"]);
    expect(await mod.rights.rights(a, "offtopic")).toEqual([]);
    // Pe tot chat-ul (ex. banul), accesul cu camere nu se aplică.
    expect(await mod.rights.has(a, "mute", null)).toBe(false);
    await w.db.chatModeratorGrant.update({ where: { userId: a.userId! }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await mod.rights.rights(a, "general")).toEqual([]);
  });

  test("meniul: drepturile camerei, motivele din ACP, „Ban pe site…” doar cu dreptul pe membri, `/acces` doar pentru admini", async () => {
    const m = await mod.menu(w.moderator, "general");
    expect(m).toMatchObject({ siteBan: false, canGrant: false, reasons: ["Spam", "Flood", "Limbaj vulgar", "Jigniri", "Reclamă"] });
    expect(await mod.menu(w.root, "general")).toMatchObject({ siteBan: true, canGrant: true });
    expect((await mod.menu(await member("Ana"), "general")).rights).toEqual([]);
  });
});

describe("acțiunile pe mesaje", () => {
  test("editarea oricărui mesaj (fără limită de timp) cere `chat.edit_any`; e în jurnal", async () => {
    const a = await member("Ana");
    const m = await chat.send(a, "general", "gresit");
    await expect(chat.edit(w.moderator, m.id, "corectat")).rejects.toBeInstanceOf(GcsForbidden);
    const admin = await member("Adi", "admin");
    const edited = await chat.edit(admin, m.id, "corectat", Date.now() + 3600_000);
    expect(edited.body).toBe("corectat");
    expect(await w.db.chatModLog.findFirst({ where: { action: "edit", messageId: m.id } })).toMatchObject({ actorId: admin.userId, targetId: a.userId });
    // Staff-ul își editează propriile mesaje fără fereastra de 5 minute.
    const own = await chat.send(admin, "general", "anunt");
    await expect(chat.edit(admin, own.id, "anunț", Date.now() + 3600_000)).resolves.toMatchObject({ body: "anunț" });
  });

  test("ascunderea: membrii nu-l mai văd, staff-ul îl vede cu „ascuns de”; live; arătat din nou revine", async () => {
    const a = await member("Ana");
    const b = await member("Bogdan");
    const m = await chat.send(a, "general", "reclamă la alt server");
    await expect(mod.hide(b, m.id, true)).rejects.toBeInstanceOf(GcsForbidden);
    await mod.hide(w.moderator, m.id, true);
    expect((await queries.recent(b, "general")).map((x) => x.id)).not.toContain(m.id);
    const seen = (await queries.recent(w.moderator, "general")).find((x) => x.id === m.id);
    expect(seen?.hidden).toMatchObject({ by: { name: "NeoX" } });
    expect(events("hidden").at(-1)?.data).toMatchObject({ id: m.id, hidden: true, by: { name: "NeoX" } });
    await mod.hide(w.moderator, m.id, false);
    expect((await queries.recent(b, "general")).map((x) => x.id)).toContain(m.id);
    expect(events("hidden").at(-1)?.data).toMatchObject({ id: m.id, hidden: false, message: { id: m.id } });
  });

  test("ștergerea mesajelor unui membru: ultima oră / toate; cere `chat.purge_user`", async () => {
    const a = await member("Ana");
    const old = await chat.send(a, "general", "vechi");
    await w.db.chatMessage.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 2 * 3600_000) } });
    await noFlood(a);
    await chat.send(a, "general", "nou 1");
    await noFlood(a);
    await chat.send(a, "general", "nou 2");
    await expect(mod.purge(w.moderator, a.userId!, "general", "1h")).rejects.toBeInstanceOf(GcsForbidden);
    const smod = await member("Sorin", "super_moderator");
    expect(await mod.purge(smod, a.userId!, "general", "1h")).toEqual({ count: 2 });
    expect(events("purged").at(-1)?.data).toMatchObject({ channel: "general" });
    expect(await mod.purge(smod, a.userId!, "general", "all")).toEqual({ count: 1 });
    expect(await w.db.chatMessage.count({ where: { authorId: a.userId!, deletedAt: null } })).toBe(0);
  });

  test("avertismentul: sistemul de avertismente al site-ului, cu mesajul ca dovadă; membrul îl primește ca notificare", async () => {
    const a = await member("Ana");
    const m = await chat.send(a, "general", "limbaj urât");
    await mod.warn(w.moderator, a.userId!, { messageId: m.id, reason: "Limbaj vulgar", announce: false });
    const warning = await w.db.warning.findFirstOrThrow({ where: { userId: a.userId! } });
    expect(warning).toMatchObject({ points: 1, reason: "Limbaj vulgar", issuedById: w.moderator.userId, evidence: { type: "chat.message", id: m.id, channel: "general", body: "limbaj urât" } });
    expect(await w.db.chatModLog.findFirst({ where: { action: "warn" } })).toMatchObject({ messageId: m.id, reason: "Limbaj vulgar" });
    await expect(mod.warn(w.moderator, a.userId!, { messageId: m.id, reason: "" })).rejects.toBeInstanceOf(GcsValidationError);
  });
});

describe("sancțiunile", () => {
  test("mute 15 minute: linia de sistem, notificarea, live la membru; câmpul e blocat; ridicat din jurnal", async () => {
    const a = await member("Ana");
    await mod.mute(w.moderator, a.userId!, { channelKey: "general", minutes: 15, reason: "spam" });
    const line = events("message").at(-1)?.data as { system?: unknown; author?: { name: string } };
    expect(line.system).toMatchObject({ kind: "mute", minutes: 15, reason: "spam", target: { name: "Ana" } });
    expect(line.author?.name).toBe("NeoX");
    expect(sent.find((s) => s.room === `user:${a.userId}` && s.event === "chat:sanction")?.data).toMatchObject({ kind: "mute", active: true, reason: "spam" });
    expect(await w.db.notification.count({ where: { userId: a.userId!, type: "chat.sanction" } })).toBe(1);
    expect((await mod.viewerState(a, "general")).mute).toMatchObject({ reason: "spam" });
    await expect(chat.send(a, "general", "hei")).rejects.toMatchObject({ params: { reason: "muted" } });
    // Linia de sistem e în cameră, cu membrul completat, și nu se poate edita.
    const listed = (await queries.recent(a, "general")).find((x) => x.system);
    expect(listed?.system?.target?.name).toBe("Ana");
    await expect(chat.edit(w.root, listed!.id, "x")).rejects.toMatchObject({ params: { reason: "system_line" } });
    const log = await w.db.chatModLog.findFirstOrThrow({ where: { action: "mute" } });
    expect((await mod.log(w.root)).rows.find((r) => r.id === log.id)?.undoable).toBe(true);
    await mod.undo(w.root, log.id);
    expect((await mod.viewerState(a, "general")).mute).toBeNull();
    expect((await mod.log(w.root)).rows.find((r) => r.id === log.id)).toMatchObject({ undoable: false });
  });

  test("protecția: nu pe sine, nu pe Root, nu pe un rang mai mare, nu pe alt staff de același rang", async () => {
    const other = await member("Mod2", "moderator");
    const admin = await member("Adi", "admin");
    await expect(mod.mute(w.moderator, w.moderator.userId!, { channelKey: "general", minutes: 5, reason: "" })).rejects.toBeInstanceOf(GcsValidationError);
    await expect(mod.mute(w.moderator, w.root.userId!, { channelKey: "general", minutes: 5, reason: "" })).rejects.toMatchObject({ params: { reason: "root_protected" } });
    await expect(mod.mute(w.moderator, admin.userId!, { channelKey: "general", minutes: 5, reason: "" })).rejects.toMatchObject({ params: { reason: "target_outranks" } });
    await expect(mod.mute(w.moderator, other.userId!, { channelKey: "general", minutes: 5, reason: "" })).rejects.toMatchObject({ params: { reason: "target_is_staff" } });
    await expect(mod.mute(admin, other.userId!, { channelKey: "general", minutes: 5, reason: "", announce: false })).resolves.toBeDefined();
  });

  test("kick din cameră: iese live, nu mai citește și nu mai scrie (și la API / reconectare); ridicat → revine", async () => {
    const a = await member("Ana");
    await w.db.chatChannel.create({ data: { key: "offtopic", name: "Off-topic" } });
    await w.db.containerPermission.createMany({ data: defaultChannelPermissions(new Map(Object.entries(w.groups)), "offtopic") });
    await w.permissions.bumpVersion();
    const { id } = await mod.kick(w.moderator, a.userId!, { channelKey: "general", minutes: 30, reason: "flood" });
    expect(sent.find((s) => s.room === `user:${a.userId}` && s.event === "chat:sanction")?.data).toMatchObject({ kind: "kick", channel: "general", active: true });
    expect(await queries.canRead(a, "general")).toBe(false);
    await expect(queries.recent(a, "general")).rejects.toMatchObject({ params: { reason: "chat_kicked" } });
    await expect(chat.send(a, "general", "revin")).rejects.toMatchObject({ params: { reason: "chat_kicked" } });
    // Doar camera aceea.
    expect(await queries.canRead(a, "offtopic")).toBe(true);
    expect((await mod.viewerState(a, "general")).block).toMatchObject({ kind: "kick", channel: "general", reason: "flood" });
    await mod.lift(w.moderator, `sanction:${id}`);
    expect(await queries.canRead(a, "general")).toBe(true);
  });

  test("ban din chat: toate camerele, temporar sau permanent; cere `chat.ban` (super moderator), nu moderator", async () => {
    const a = await member("Ana");
    await expect(mod.ban(w.moderator, a.userId!, { channelKey: "general", minutes: null, reason: "x" })).rejects.toBeInstanceOf(GcsForbidden);
    const smod = await member("Sorin", "super_moderator");
    await mod.ban(smod, a.userId!, { channelKey: "general", minutes: null, reason: "reclame repetate" });
    await expect(chat.send(a, "general", "hei")).rejects.toMatchObject({ params: { reason: "chat_banned" } });
    expect((await mod.viewerState(a, "general")).block).toMatchObject({ kind: "ban", channel: null, until: null });
    expect((await mod.activeSanctions(w.root)).map((s) => s.kind)).toEqual(["ban"]);
  });

  test("slow mode personal: al doilea mesaj prea repede e refuzat; expirarea (jobul) îl ridică", async () => {
    const a = await member("Ana");
    await mod.slowUser(w.moderator, a.userId!, { channelKey: "general", seconds: 60, minutes: 10, reason: "flood" });
    await chat.send(a, "general", "unu");
    await noFlood(a);
    await expect(chat.send(a, "general", "doi")).rejects.toBeInstanceOf(GcsRateLimited);
    await w.db.chatSanction.updateMany({ data: { until: new Date(Date.now() - 1000) } });
    expect(await mod.expire()).toMatchObject({ sanctions: 1 });
    expect(await mod.rights.slow(a.userId!)).toBeNull();
  });

  test("fișa de moderare: avertismentele, sancțiunile active și jurnalul membrului; doar pentru cine moderează", async () => {
    const a = await member("Ana");
    await mod.warn(w.moderator, a.userId!, { channelKey: "general", reason: "spam" });
    await mod.mute(w.moderator, a.userId!, { channelKey: "general", minutes: 5, reason: "spam", announce: false });
    const card = await mod.card(w.moderator, a.userId!, "general");
    expect(card).toMatchObject({ user: { name: "Ana" }, activePoints: 1 });
    expect(card.warnings).toHaveLength(1);
    expect(card.sanctions.map((s) => s.kind)).toEqual(["mute"]);
    expect(card.log.map((l) => l.action)).toEqual(["mute", "warn"]);
    await expect(mod.card(await member("Bogdan"), a.userId!, "general")).rejects.toBeInstanceOf(GcsForbidden);
  });
});

describe("accesul de moderator în chat", () => {
  test("/acces @nume drepturi durată #cameră → rezultat doar pentru autor, linia publică, notificarea, live; meniul îl arată; /revoca", async () => {
    const kaze = await member("Kaze");
    const res = await chat.send(w.root, "general", "/acces @Kaze mute,kick 7d #general");
    expect(res.id).toBe(0);
    expect(res.ephemeral).toMatchObject({ kind: "granted", grant: { user: { name: "Kaze" }, rights: ["mute", "kick"], rooms: ["general"] } });
    // Nimic salvat ca mesaj; linia de sistem publică, da.
    expect(await w.db.chatMessage.count({ where: { body: { startsWith: "/acces" } } })).toBe(0);
    expect((events("message").at(-1)?.data as { system?: unknown }).system).toMatchObject({ kind: "grant", target: { name: "Kaze" }, rights: ["mute", "kick"] });
    expect(sent.find((s) => s.room === `user:${kaze.userId}` && s.event === "chat:rights")).toBeDefined();
    expect(await w.db.notification.count({ where: { userId: kaze.userId!, type: "chat.access" } })).toBe(1);
    expect((await mod.menu(kaze, "general")).rights).toEqual(["mute", "kick"]);
    const list = await chat.send(w.root, "general", "/acces");
    expect(list.ephemeral).toMatchObject({ kind: "list", grants: [{ user: { name: "Kaze" } }] });
    const gone = await chat.send(w.root, "general", "/revoca @Kaze");
    expect(gone.ephemeral).toMatchObject({ kind: "revoked", user: { name: "Kaze" } });
    expect((await mod.menu(kaze, "general")).rights).toEqual([]);
  });

  test("reguli: doar cu `chat.grant_access`; nu dai un drept pe care nu-l ai; nu pe Root sau pe un rang mai mare; erori de sintaxă", async () => {
    const kaze = await member("Kaze");
    await expect(chat.send(w.moderator, "general", "/acces @Kaze")).rejects.toMatchObject({ params: { permission: "chat.grant_access" } });
    const admin = await member("Adi", "admin");
    // Adminul nu are dreptul individual scos: îl luăm, ca să vedem regula.
    await w.permissions.setUserPermission(w.root, admin.userId!, "chat.ban", false);
    await expect(mod.grant(admin, { userId: kaze.userId!, rights: ["ban"], rooms: [], expiresAt: null })).rejects.toMatchObject({ params: { reason: "right_not_held" } });
    await expect(mod.grant(admin, { userId: w.root.userId!, rights: ["mute"], rooms: [], expiresAt: null })).rejects.toMatchObject({ params: { reason: "root_protected" } });
    await expect(chat.send(admin, "general", "/acces @Kaze zbor")).rejects.toBeInstanceOf(GcsValidationError);
    await expect(chat.send(admin, "general", "/acces @Nimeni")).rejects.toMatchObject({ fields: { command: "member_not_found" } });
    await w.settings.set("chat.announce_grants", false, w.root);
    const before = events("message").length;
    await mod.grant(admin, { userId: kaze.userId!, rights: ["mute"], rooms: [], expiresAt: new Date(Date.now() + 3600_000), announceIn: "general" });
    expect(events("message").length).toBe(before);
  });

  test("expirarea: jobul șterge accesul, notifică membrul și îi actualizează meniul live", async () => {
    const kaze = await member("Kaze");
    await mod.grant(w.root, { userId: kaze.userId!, rights: ["mute"], rooms: [], expiresAt: new Date(Date.now() + 60_000) });
    await w.db.chatModeratorGrant.update({ where: { userId: kaze.userId! }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await mod.expire()).toMatchObject({ grants: 1 });
    expect(await w.db.chatModeratorGrant.count()).toBe(0);
    expect(await w.db.notification.count({ where: { userId: kaze.userId!, type: "chat.access" } })).toBe(2);
    expect(sent.filter((s) => s.room === `user:${kaze.userId}` && s.event === "chat:rights")).toHaveLength(2);
  });

  test("unirea conturilor: sancțiunile, jurnalul, liniile de sistem și accesul trec la țintă", async () => {
    const src = await member("Sursa");
    const dst = await member("Tinta");
    await mod.mute(w.moderator, src.userId!, { channelKey: "general", minutes: 5, reason: "x" });
    await mod.kick(w.moderator, src.userId!, { channelKey: "general", minutes: 5, reason: "y" });
    await mod.grant(w.root, { userId: src.userId!, rights: ["mute"], rooms: [], expiresAt: null, announceIn: "general" });
    const data = chatMemberData({ db: w.db });
    while ((await data.merge({ sourceId: src.userId!, targetId: dst.userId!, batchSize: 100, cursor: { value: null } })) > 0);
    expect(await w.db.chatSanction.count({ where: { userId: dst.userId! } })).toBe(1);
    expect(await w.db.chatModLog.count({ where: { targetId: src.userId! } })).toBe(0);
    expect(await w.db.chatModeratorGrant.findUnique({ where: { userId: dst.userId! } })).not.toBeNull();
    const lines = await w.db.chatMessage.findMany({ where: { meta: { path: jsonPath("system", "targetId"), equals: dst.userId! } } });
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });
});
