import { GcsNotificationService } from "@gcs/core";
import { beforeEach, describe, expect, it } from "vitest";
import { createBridgeWorld, type GcsBridgeWorld } from "../../../test/bridgeWorld";
import { doc } from "../../../test/world";
import { registerBridgeNotifications } from "./notify";

let w: GcsBridgeWorld;
let notifications: GcsNotificationService;
beforeEach(async () => {
  w = await createBridgeWorld();
  notifications = new GcsNotificationService({ db: w.db, bus: w.bus, cache: w.cache, registry: w.registry });
  registerBridgeNotifications({ db: w.db, bus: w.bus, notifications, tickets: w.bridge.tickets, actors: w.actors });
});

/** Membrul are identitatea Steam banată (global, de pe site). */
async function bannedMember() {
  const player = await w.db.gamePlayer.create({ data: { kind: "STEAM", value: "76561197960287930", trust: "HIGH", userId: w.member.userId } });
  const { id } = await w.bridge.sanctions.create(w.root, { type: "BAN", scope: "GLOBAL", serverId: null, target: { playerId: player.id }, reason: "wallhack", minutes: 0 });
  return { player, sanctionId: id };
}

describe("contestațiile și reclamațiile (§14)", () => {
  it("contestația: doar cel sancționat, o singură deschisă pe sancțiune; acceptarea poate ridica banul în același pas", async () => {
    const { sanctionId } = await bannedMember();
    const other = await w.actorFor(await w.createUser("Ana", "member"));
    await expect(w.bridge.tickets.create(other, { kind: "APPEAL", sanctionId, title: "Nu sunt eu", content: doc("Contest banul.") })).rejects.toMatchObject({ fields: { sanctionId: "invalid" } });
    const { id } = await w.bridge.tickets.create(w.member, { kind: "APPEAL", sanctionId, title: "Contest banul", content: doc("Am fost banat pe nedrept.") });
    await expect(w.bridge.tickets.create(w.member, { kind: "APPEAL", sanctionId, title: "Din nou", content: doc("Încă o dată.") })).rejects.toMatchObject({ fields: { sanctionId: "appeal_open" } });
    // Staff-ul (root) a primit notificarea `servers.ticket_new`.
    expect(await w.db.notification.count({ where: { userId: w.root.userId!, type: "servers.ticket_new" } })).toBe(1);

    expect(await w.bridge.tickets.get(other, id)).toBeNull();
    await w.bridge.tickets.reply(w.root, id, { content: doc("Notă internă: verific demo-ul."), internal: true });
    await w.bridge.tickets.reply(w.root, id, { content: doc("Analizăm.") });
    const seen = (await w.bridge.tickets.get(w.member, id))!;
    expect(seen.messages.map((m) => m.contentHtml)).toEqual(["<p>Analizăm.</p>"]);
    expect(seen.transitions).toEqual(["CLOSED"]);
    await expect(w.bridge.tickets.reply(w.member, id, { content: doc("x"), internal: true })).rejects.toMatchObject({ code: "forbidden" });

    await w.bridge.tickets.setStatus(w.root, id, "REVIEW");
    await w.bridge.tickets.setStatus(w.root, id, "ACCEPTED", { lift: true, reason: "demo verificat" });
    const sanction = await w.db.gameSanction.findUniqueOrThrow({ where: { id: sanctionId } });
    expect(sanction).toMatchObject({ unbannedByName: "Fondator", unbanReason: "demo verificat" });
    const view = (await w.bridge.tickets.get(w.root, id))!;
    expect(view).toMatchObject({ status: "ACCEPTED", sanction: { lifted: true }, canHandle: true });
    expect(view.messages.map((m) => m.kind)).toEqual(["MESSAGE", "MESSAGE", "STATUS", "STATUS"]);
    expect(await w.db.notification.count({ where: { userId: w.member.userId!, type: "servers.ticket_update" } })).toBeGreaterThan(0);
    await expect(w.bridge.tickets.setStatus(w.root, id, "OPEN")).rejects.toMatchObject({ fields: { status: "invalid_transition" } });
    await w.bridge.tickets.setStatus(w.member, id, "CLOSED");
    expect((await w.bridge.tickets.get(w.member, id))!.closedAt).not.toBeNull();
  });

  it("reclamația de cheater: o văd adminii serverului (cu `d`); reclamația de admin doar staff-ul; nimeni nu tratează un tichet despre el", async () => {
    const server = await w.bridgeServer();
    const admin = await w.actorFor(await w.createUser("AdminServer", "member"));
    const { id: entry } = await w.bridge.admins.save(w.root, null, { subject: "USER", userId: admin.userId, serverId: server.id, presetId: null, flags: "bcd", immunity: null, allowNonSteam: false, note: "", expiresAt: null });
    const cheater = await w.bridge.tickets.create(w.member, { kind: "CHEATER", serverId: server.id, targetName: "Suspect", title: "Wallhack evident", content: doc("Demo atașat."), evidence: ["https://video.exemplu.ro/demo"] });
    const report = await w.bridge.tickets.create(w.member, { kind: "ADMIN", serverId: server.id, targetAdminId: entry, title: "Abuz de ban", content: doc("M-a banat fără motiv.") });
    expect(await w.bridge.tickets.get(admin, cheater.id)).toMatchObject({ canHandle: true, evidence: [{ url: "https://video.exemplu.ro/demo" }] });
    expect(await w.bridge.tickets.get(admin, report.id)).toBeNull();
    expect((await w.bridge.tickets.list(admin, { scope: "handle" })).items.map((t) => t.id)).toEqual([cheater.id]);
    expect((await w.bridge.tickets.list(w.root, { scope: "handle" })).total).toBe(2);
    await w.bridge.tickets.assign(w.root, cheater.id, admin.userId);
    await expect(w.bridge.tickets.assign(w.root, report.id, admin.userId)).rejects.toMatchObject({ fields: { assigneeId: "invalid" } });
    expect(await w.db.auditLog.count({ where: { action: { in: ["servers.ticket.create", "servers.ticket.assign"] } } })).toBe(3);
    // Răspunsul autorului ajunge la responsabil.
    await w.bridge.tickets.reply(w.member, cheater.id, { content: doc("Am mai văzut-o azi.") });
    expect(await w.db.notification.count({ where: { userId: admin.userId!, type: "servers.ticket_update" } })).toBeGreaterThan(0);
  });

  it("limitele: titlul 3–120, max 3 deschise pe fel, 5 pe oră, dovezi doar https", async () => {
    const server = await w.bridgeServer();
    const make = (title = "Un cheater") => w.bridge.tickets.create(w.member, { kind: "CHEATER", serverId: server.id, targetName: "X", title, content: doc("Detalii.") });
    await expect(make("ab")).rejects.toMatchObject({ fields: { title: "too_short" } });
    await expect(w.bridge.tickets.create(w.member, { kind: "CHEATER", serverId: server.id, targetName: "X", title: "Titlu", content: doc("x"), evidence: ["javascript:alert(1)"] })).rejects.toMatchObject({ fields: { evidence: "invalid_url" } });
    for (let i = 0; i < 3; i++) await make();
    await expect(make()).rejects.toMatchObject({ fields: { kind: "too_many_open" } });
    await expect(w.bridge.tickets.create(w.guest, { kind: "CHEATER", serverId: server.id, targetName: "X", title: "Titlu", content: doc("x") })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("mențiunile din tichet și din răspunsurile publice (nu din notele interne) pleacă spre notificări, după id", async () => {
    const server = await w.bridgeServer();
    const seen: Record<string, unknown>[] = [];
    w.bus.on("mentions.created", async (e) => void seen.push(e.payload));
    const content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "uitați-vă " }, { type: "mention", attrs: { id: w.root.userId, label: "Fondator", kind: "user" } }] }],
    };
    const { id } = await w.bridge.tickets.create(w.member, { kind: "CHEATER", serverId: server.id, targetName: "Suspect", title: "Wallhack", content });
    expect(seen).toEqual([expect.objectContaining({ targetType: "servers.ticket", targetId: String(id), userIds: [w.root.userId], type: "forums.mention" })]);
    expect((await w.db.gameTicket.findUniqueOrThrow({ where: { id } })).contentHtml).toContain(`data-user-id="${w.root.userId}"`);
    await w.bridge.tickets.reply(w.root, id, { content, internal: true });
    expect(seen).toHaveLength(1);
    await w.bridge.tickets.reply(w.root, id, { content });
    expect(seen).toHaveLength(2);
  });
});
