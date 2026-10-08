import { GcsForbidden, GcsNotFound, GcsValidationError } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createClanWorld, type GcsClanWorld } from "../../test/clanWorld";

let w: GcsClanWorld;

beforeEach(async () => {
  w = await createClanWorld();
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

/** Rolurile membrilor unui clan, după nume. */
async function roles(clanId: number) {
  const rows = await w.db.clanMember.findMany({ where: { clanId }, include: { user: { select: { name: true } } } });
  return Object.fromEntries(rows.map((r) => [r.user.name, r.role]));
}

const conflict = (reason: string) => expect.objectContaining({ code: "conflict", params: expect.objectContaining({ reason }) });

describe("crearea și aprobarea", () => {
  test("doar VIP-urile și staff-ul creează (`clans.create`); un membru obișnuit și vizitatorul sunt refuzați", async () => {
    const vip = await w.user("Vip", "vip_bronze");
    const mod = await w.user("Moderatorul", "moderator");
    await expect(w.clans.create(w.member, w.input())).rejects.toBeInstanceOf(GcsForbidden);
    await expect(w.clans.create(w.guest, w.input())).rejects.toBeInstanceOf(GcsForbidden);
    await expect(w.clans.create(vip, w.input())).resolves.toMatchObject({ status: "PENDING" });
    await expect(w.clans.create(mod, w.input())).resolves.toMatchObject({ status: "PENDING" });
    // Grupul membrilor primește dreptul din ACP: acum poate.
    await w.groupService.setSetting(w.groups.member!, "clans.create", true, w.root);
    await expect(w.clans.create(w.member, w.input())).resolves.toMatchObject({ status: "PENDING" });
  });

  test("cu aprobare: în așteptare, fondatorul e lider și vede pagina; ceilalți nu; staff-ul aprobă → activ, cu notificare", async () => {
    const founder = await w.user("Fondatorul", "vip_gold");
    const { id } = await w.clans.create(founder, w.input({ tag: "RLX", name: "Red Lynx" }));
    expect(await roles(id)).toEqual({ Fondatorul: "LEADER" });
    expect(await w.clanQueries.details(founder, id)).toMatchObject({ status: "PENDING", tag: "RLX" });
    expect(await w.clanQueries.details(w.member, id)).toBeNull();
    expect(await w.clanQueries.details(w.guest, id)).toBeNull();
    expect((await w.clanQueries.directory(w.member, {})).clans).toEqual([]);

    await expect(w.clans.approve(w.member, id)).rejects.toBeInstanceOf(GcsForbidden);
    await w.clans.approve(w.root, id);
    expect(await w.clanQueries.details(w.member, id)).toMatchObject({ status: "ACTIVE", name: "Red Lynx" });
    expect((await w.clanQueries.directory(w.guest, {})).clans.map((c) => c.tag)).toEqual(["RLX"]);
    const [note] = await w.notifications.list(founder.userId!);
    expect(note).toMatchObject({ type: "clans.review", data: { kind: "approved", title: "[RLX] Red Lynx", href: `/clans/${id}-red-lynx` } });
    const audit = await w.db.auditLog.findMany({ where: { targetType: "clan", targetId: String(id) }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(["clans.create", "clans.approve"]);
  });

  test("respingerea șterge clanul și anunță fondatorul cu motivul; tagul se poate folosi din nou", async () => {
    const founder = await w.user("Respins", "vip_gold");
    const { id } = await w.clans.create(founder, w.input({ tag: "BAD", name: "Clan respins" }));
    await w.clans.reject(w.root, id, "Numele încalcă regulile.");
    expect(await w.db.clan.count()).toBe(0);
    const [note] = await w.notifications.list(founder.userId!);
    expect(note).toMatchObject({ type: "clans.review", data: { kind: "rejected", title: "Clan respins", reason: "Numele încalcă regulile." } });
    await expect(w.clans.create(founder, w.input({ tag: "bad", name: "Clan respins" }))).resolves.toMatchObject({ status: "PENDING" });
  });

  test("fără aprobare, clanul e activ direct", async () => {
    await w.option("clans.require_approval", false);
    const vip = await w.user("Direct", "vip_silver");
    const created = await w.clans.create(vip, w.input());
    expect(created.status).toBe("ACTIVE");
  });

  test("tagul după opțiuni: lungimea, caracterele, unicitatea fără majuscule și diacritice; numele unic", async () => {
    const vip = await w.user("Taguri", "vip_gold");
    const err = async (patch: Parameters<GcsClanWorld["input"]>[0]) =>
      w.clans.create(vip, w.input(patch)).then(
        () => null,
        (e: unknown) => (e instanceof GcsValidationError ? e.fields : e),
      );
    expect(await err({ tag: "X" })).toEqual({ tag: "too_short" });
    expect(await err({ tag: "TOOLONG" })).toEqual({ tag: "too_long" });
    expect(await err({ tag: "R-X" })).toEqual({ tag: "invalid_chars" });
    expect(await err({ tag: "ȘTF" })).toEqual({ tag: "invalid_chars" });
    await w.option("clans.tag_charset", "alnum_symbols");
    await w.option("clans.max_per_member", 5);
    expect(await err({ tag: "R-X" })).toBeNull();
    await w.option("clans.tag_charset", "unicode");
    expect(await err({ tag: "ȘTF", name: "Ștefănești" })).toBeNull();
    // `STF` e același tag cu `ȘTF`; numele la fel, fără diacritice.
    expect(await err({ tag: "stf" })).toEqual({ tag: "clan_tag_taken" });
    expect(await err({ tag: "NEW", name: "stefanesti" })).toEqual({ name: "clan_name_taken" });
    expect(await err({ tag: "AB", name: "ab" })).toEqual({ name: "too_short" });
  });

  test("câmpurile obligatorii, culorile și linkurile (doar https, pe domeniile lor)", async () => {
    const vip = await w.user("Campuri", "vip_gold");
    await w.option("clans.required_fields", ["description", "logo"]);
    await expect(w.clans.create(vip, w.input({ description: "" }))).rejects.toMatchObject({ fields: { description: "required", logo: "required" } });
    await w.option("clans.required_fields", []);
    await expect(w.clans.create(vip, w.input({ color: "red" }))).rejects.toMatchObject({ fields: { color: "invalid_color" } });
    await expect(
      w.clans.create(vip, w.input({ links: { discord: "https://evil.example/invite/x", steam: "http://steamcommunity.com/groups/gcs", website: "javascript:alert(1)" } })),
    ).rejects.toMatchObject({ fields: { "links.discord": "invalid_url", "links.steam": "invalid_url", "links.website": "invalid_url" } });
    const ok = await w.clans.create(
      vip,
      w.input({ description: "", links: { discord: "https://discord.gg/gcs-clan", steam: "https://steamcommunity.com/groups/gcsclan", website: "https://clan.example.com/" } }),
    );
    const clan = await w.db.clan.findUniqueOrThrow({ where: { id: ok.id } });
    expect(clan.links).toEqual({ discord: "https://discord.gg/gcs-clan", steam: "https://steamcommunity.com/groups/gcsclan", website: "https://clan.example.com/" });
    expect(clan.descriptionHtml).toBe("");
  });

  test("descrierea trece prin renderer-ul editorului (sanitizată, fără formatări nepermise)", async () => {
    const vip = await w.user("Descriere", "vip_gold");
    const video = { type: "doc", content: [{ type: "video", attrs: { provider: "youtube", id: "abc" } }] };
    await expect(w.clans.create(vip, w.input({ description: video }))).rejects.toBeInstanceOf(GcsValidationError);
    const { id } = await w.clans.create(vip, w.input({ description: { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Despre noi" }] }] } }));
    expect((await w.db.clan.findUniqueOrThrow({ where: { id } })).descriptionHtml).toContain("Despre noi");
  });
});

describe("intrarea în clan", () => {
  test("cu cerere: liderul acceptă → membru, notificat; refuzul închide cererea și e anunțat", async () => {
    const { id, leader } = await w.activeClan({ joinMode: "REQUEST" });
    const ana = await w.user("Ana");
    const bob = await w.user("Bob");
    await w.clans.request(ana, id, "Joc CS2 de 5 ani.");
    await w.clans.request(bob, id, "");
    await expect(w.clans.request(ana, id, "din nou")).rejects.toEqual(conflict("clan_pending_exists"));
    // Liderul primește notificarea cererilor (adunate).
    const [leaderNote] = await w.notifications.list(leader.userId!);
    expect(leaderNote).toMatchObject({ type: "clans.request", count: 2, data: { href: expect.stringMatching(/\/manage\?tab=requests$/) } });

    const requests = await w.db.clanRequest.findMany({ where: { clanId: id }, orderBy: { id: "asc" } });
    await expect(w.clans.decideRequest(ana, requests[1]!.id, true)).rejects.toBeInstanceOf(GcsForbidden);
    await w.clans.decideRequest(leader, requests[0]!.id, true);
    await w.clans.decideRequest(leader, requests[1]!.id, false);
    expect(await roles(id)).toMatchObject({ Ana: "MEMBER" });
    expect((await roles(id)).Bob).toBeUndefined();
    expect((await w.notifications.list(ana.userId!))[0]).toMatchObject({ type: "clans.membership", data: { kind: "accepted" } });
    expect((await w.notifications.list(bob.userId!))[0]).toMatchObject({ type: "clans.membership", data: { kind: "rejected" } });
    expect((await w.db.clan.findUniqueOrThrow({ where: { id } })).membersCount).toBe(2);
    // O decizie a doua pe aceeași cerere nu mai trece.
    await expect(w.clans.decideRequest(leader, requests[0]!.id, true)).rejects.toEqual(conflict("clan_request_closed"));
  });

  test("intrarea liberă (OPEN) și refuzul intrării directe la celelalte moduri", async () => {
    const open = await w.activeClan({ joinMode: "OPEN" });
    const closed = await w.activeClan({ joinMode: "INVITE" });
    const ana = await w.user("Ana");
    await w.clans.join(ana, open.id);
    expect(await roles(open.id)).toMatchObject({ Ana: "MEMBER" });
    await w.option("clans.max_per_member", 3);
    await expect(w.clans.join(ana, closed.id)).rejects.toEqual(conflict("clan_closed"));
    await expect(w.clans.request(ana, closed.id, "")).rejects.toEqual(conflict("clan_closed"));
  });

  test("invitația: invitatul e anunțat, o acceptă (intră) sau o refuză; un candidat cu cerere intră direct", async () => {
    const { id, leader } = await w.activeClan({ joinMode: "INVITE" });
    const ana = await w.user("Ana");
    const bob = await w.user("Bob");
    await w.clans.invite(leader, id, "ana");
    await w.clans.invite(leader, id, "Bob");
    await expect(w.clans.invite(leader, id, "Nimeni")).rejects.toMatchObject({ fields: { user: "unknown_user" } });
    await expect(w.clans.invite(ana, id, "Bob")).rejects.toBeInstanceOf(GcsForbidden);
    expect((await w.notifications.list(ana.userId!))[0]).toMatchObject({ type: "clans.invite" });
    expect((await w.clanQueries.details(ana, id))!.viewer.invite).not.toBeNull();
    await w.clans.answerInvite(ana, id, true);
    await w.clans.answerInvite(bob, id, false);
    expect(await roles(id)).toMatchObject({ Ana: "MEMBER" });
    expect((await roles(id)).Bob).toBeUndefined();
    await expect(w.clans.answerInvite(bob, id, true)).rejects.toBeInstanceOf(GcsNotFound);

    const req = await w.activeClan({ joinMode: "REQUEST" });
    const cid = await w.user("Cid");
    await w.clans.request(cid, req.id, "");
    await expect(w.clans.invite(req.leader, req.id, "Cid")).resolves.toEqual({ joined: true });
    expect(await roles(req.id)).toMatchObject({ Cid: "MEMBER" });
  });

  test("un singur clan pe membru (implicit); cu `max_per_member` 2, al doilea merge", async () => {
    const a = await w.activeClan({ joinMode: "OPEN" });
    const b = await w.activeClan({ joinMode: "OPEN" });
    const ana = await w.user("Ana");
    await w.clans.join(ana, a.id);
    await expect(w.clans.join(ana, b.id)).rejects.toEqual(conflict("clan_max_clans"));
    // Și un lider nu poate crea al doilea clan.
    await expect(w.clans.create(a.leader, w.input())).rejects.toEqual(conflict("clan_max_clans"));
    await w.option("clans.max_per_member", 2);
    await w.clans.join(ana, b.id);
    expect((await w.clanQueries.memberClans(ana.userId!)).clans).toHaveLength(2);
  });

  test("pauza după ieșire și după excludere", async () => {
    const a = await w.activeClan({ joinMode: "OPEN" });
    const b = await w.activeClan({ joinMode: "OPEN" });
    const ana = await w.user("Ana");
    await w.clans.join(ana, a.id);
    await w.clans.leave(ana, a.id);
    await expect(w.clans.join(ana, b.id)).rejects.toEqual(conflict("clan_cooldown"));
    await w.option("clans.leave_cooldown_hours", 0);
    await w.clans.join(ana, b.id);
    await w.option("clans.leave_cooldown_hours", 24);
    await w.clans.kick(b.leader, b.id, ana.userId!);
    await expect(w.clans.join(ana, a.id)).rejects.toEqual(conflict("clan_cooldown"));
  });

  test("limita de membri: după grupul liderului, apoi limita pusă de staff; două intrări simultane nu o depășesc", async () => {
    const { id, leader } = await w.activeClan({ joinMode: "OPEN" }, "vip_bronze");
    await w.groupService.setSetting(w.groups.vip_bronze!, "clans.max_members", 2, w.root);
    expect(await w.clans.memberLimit({ id, memberLimit: null })).toBe(2);
    const [ana, bob] = [await w.user("Ana"), await w.user("Bob")];
    const results = await Promise.allSettled([w.clans.join(ana, id), w.clans.join(bob, id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: conflict("clan_full") });
    expect((await w.db.clan.findUniqueOrThrow({ where: { id } })).membersCount).toBe(2);
    await w.clans.setMemberLimit(w.root, id, 5);
    const cid = await w.user("Cid");
    await w.clans.join(cid, id);
    expect((await w.clanQueries.details(leader, id))!.memberLimit).toBe(5);
  });

  test("cine nu are `clans.join` nu intră și nu poate fi invitat", async () => {
    const { id, leader } = await w.activeClan({ joinMode: "OPEN" });
    await w.groupService.setSetting(w.groups.member!, "clans.join", false, w.root);
    const ana = await w.user("Ana");
    await expect(w.clans.join(ana, id)).rejects.toBeInstanceOf(GcsForbidden);
    await expect(w.clans.invite(leader, id, "Ana")).rejects.toEqual(conflict("clan_cannot_join"));
    expect((await w.clanQueries.details(ana, id))!.viewer).toMatchObject({ canJoin: false, blocked: "no_permission" });
  });
});

describe("rolurile, ieșirea, transferul", () => {
  test("liderul numește un ofițer; ofițerul are doar drepturile date de lider (și permise de staff)", async () => {
    const { id, leader } = await w.activeClan({ joinMode: "OPEN" });
    await w.option("clans.leave_cooldown_hours", 0);
    const [ana, bob, cid] = [await w.user("Ana"), await w.user("Bob"), await w.user("Cid")];
    for (const a of [ana, bob, cid]) await w.clans.join(a, id);
    await expect(w.clans.setRole(ana, id, bob.userId!, "OFFICER")).rejects.toBeInstanceOf(GcsForbidden);
    await w.clans.setRole(leader, id, ana.userId!, "OFFICER");
    expect((await w.notifications.list(ana.userId!))[0]).toMatchObject({ type: "clans.membership", data: { kind: "promoted" } });
    // Drepturile implicite ale ofițerilor: invitații și cereri, nu excluderi.
    await expect(w.clans.kick(ana, id, bob.userId!)).rejects.toBeInstanceOf(GcsForbidden);
    const clan = await w.db.clan.findUniqueOrThrow({ where: { id } });
    await w.clans.update(leader, id, { ...w.input({ tag: clan.tag, name: clan.name, joinMode: "OPEN" }), officerRights: ["members", "invite"] });
    await w.clans.kick(ana, id, bob.userId!);
    // Un ofițer nu scoate alt ofițer și nu schimbă tagul.
    await w.clans.setRole(leader, id, cid.userId!, "OFFICER");
    await expect(w.clans.kick(ana, id, cid.userId!)).rejects.toBeInstanceOf(GcsForbidden);
    await expect(w.clans.update(ana, id, w.input({ tag: "NEW", name: clan.name }))).rejects.toBeInstanceOf(GcsForbidden);
    // Staff-ul scoate dreptul `members` din opțiuni: dispare și din clan.
    await w.clanAdmin.saveOptions(w.root, { "clans.officer_rights": ["invite", "requests", "edit", "forum", "events"] });
    expect((await w.db.clan.findUniqueOrThrow({ where: { id } })).officerRights).toEqual(["invite"]);
    await w.clans.setRole(leader, id, ana.userId!, "MEMBER");
    expect(await roles(id)).toMatchObject({ Ana: "MEMBER", Cid: "OFFICER" });
    expect((await w.notifications.list(bob.userId!))[0]).toMatchObject({ data: { kind: "kicked" } });
  });

  test("liderul nu iese înainte de transfer; transferul: noul lider, vechiul devine ofițer, un singur lider", async () => {
    const { id, leader } = await w.activeClan({ joinMode: "OPEN" });
    const ana = await w.user("Ana");
    await w.clans.join(ana, id);
    await expect(w.clans.leave(leader, id)).rejects.toEqual(conflict("clan_leader_must_transfer"));
    await expect(w.clans.transfer(ana, id, ana.userId!)).rejects.toBeInstanceOf(GcsForbidden);
    await w.clans.transfer(leader, id, ana.userId!);
    const r = await w.db.clanMember.findMany({ where: { clanId: id } });
    expect(r.filter((m) => m.role === "LEADER").map((m) => m.userId)).toEqual([ana.userId]);
    expect(r.find((m) => m.userId === leader.userId)!.role).toBe("OFFICER");
    expect((await w.notifications.list(ana.userId!))[0]).toMatchObject({ data: { kind: "leader" } });
    // Indexul unic parțial: un al doilea lider e refuzat de bază.
    await expect(w.db.clanMember.update({ where: { clanId_userId: { clanId: id, userId: leader.userId! } }, data: { role: "LEADER" } })).rejects.toMatchObject({ code: "P2002" });
    await w.clans.leave(leader, id);
    expect((await w.db.clanMember.findMany({ where: { clanId: id } })).map((m) => m.userId)).toEqual([ana.userId]);
  });
});

describe("staff-ul: blocarea, arhivarea, desființarea", () => {
  test("un clan blocat nu primește membri, iar liderul nu-l mai editează; staff-ul îl deblochează", async () => {
    const { id, leader } = await w.activeClan({ joinMode: "OPEN" });
    const clan = await w.db.clan.findUniqueOrThrow({ where: { id } });
    await expect(w.clans.setLocked(leader, id, true)).rejects.toBeInstanceOf(GcsForbidden);
    await w.clans.setLocked(w.root, id, true, "Verificare");
    const ana = await w.user("Ana");
    await expect(w.clans.join(ana, id)).rejects.toEqual(conflict("clan_closed"));
    await expect(w.clans.update(leader, id, w.input({ tag: clan.tag, name: clan.name }))).rejects.toBeInstanceOf(GcsForbidden);
    expect(await w.clanQueries.details(ana, id)).toMatchObject({ locked: true, lockReason: "Verificare" });
    await w.clans.setLocked(w.root, id, false);
    await w.clans.join(ana, id);
  });

  test("staff-ul pe site (`clans.moderate`) editează, transferă și desființează orice clan; un moderator simplu nu", async () => {
    const { id } = await w.activeClan({ joinMode: "OPEN" });
    const ana = await w.user("Ana");
    await w.clans.join(ana, id);
    const smod = await w.user("Supermod", "super_moderator");
    const mod = await w.user("Mod", "moderator");
    const clan = await w.db.clan.findUniqueOrThrow({ where: { id } });
    await expect(w.clans.update(mod, id, w.input({ tag: clan.tag, name: clan.name }))).rejects.toBeInstanceOf(GcsForbidden);
    await w.clans.update(smod, id, w.input({ tag: "SM", name: "Redenumit de staff" }));
    await w.clans.transfer(smod, id, ana.userId!);
    await w.clans.disband(smod, id, "");
    expect(await w.db.clan.count({ where: { id } })).toBe(0);
  });

  test("desființarea de către lider cere tagul; membrii sunt anunțați; jurnalul păstrează datele", async () => {
    const { id, leader } = await w.activeClan({ joinMode: "OPEN", tag: "DSB" });
    const ana = await w.user("Ana");
    await w.clans.join(ana, id);
    await expect(w.clans.disband(ana, id, "DSB")).rejects.toBeInstanceOf(GcsForbidden);
    await expect(w.clans.disband(leader, id, "XYZ")).rejects.toMatchObject({ fields: { confirm: "mismatch" } });
    await w.clans.disband(leader, id, "dsb");
    expect(await w.db.clanMember.count()).toBe(0);
    expect((await w.notifications.list(ana.userId!))[0]).toMatchObject({ type: "clans.membership", data: { kind: "disbanded", title: expect.stringContaining("[DSB]") } });
    const entry = await w.db.auditLog.findFirstOrThrow({ where: { action: "clans.disband" } });
    expect(entry.before).toMatchObject({ tag: "DSB", members: expect.arrayContaining([expect.objectContaining({ userId: ana.userId })]) });
  });

  test("arhivarea (staff, apoi automat după inactivitate) și reactivarea de către lider", async () => {
    const { id, leader } = await w.activeClan({ joinMode: "OPEN" });
    await w.clans.archive(w.root, id);
    const ana = await w.user("Ana");
    await expect(w.clans.join(ana, id)).rejects.toEqual(conflict("clan_closed"));
    expect((await w.clanQueries.directory(ana, {})).clans).toHaveLength(0);
    expect((await w.clanQueries.directory(ana, { archived: true })).clans).toHaveLength(1);
    await w.clans.reactivate(leader, id);
    expect((await w.db.clan.findUniqueOrThrow({ where: { id } })).status).toBe("ACTIVE");

    // Automat: niciun membru activ și nicio activitate a clanului de 30 de zile.
    await w.option("clans.archive_inactive_days", 30);
    const old = new Date(Date.now() - 40 * 86_400_000);
    await w.db.clan.update({ where: { id }, data: { lastActivityAt: old } });
    await w.db.user.update({ where: { id: leader.userId! }, data: { lastActiveAt: old } });
    expect(await w.clans.daily()).toMatchObject({ archived: 1 });
    expect((await w.db.clan.findUniqueOrThrow({ where: { id } })).status).toBe("ARCHIVED");
  });

  test("cererile și invitațiile expirate se închid; o cerere expirată nu blochează una nouă", async () => {
    const { id, leader } = await w.activeClan({ joinMode: "REQUEST" });
    const ana = await w.user("Ana");
    await w.clans.request(ana, id, "");
    await w.db.clanRequest.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const requests = await w.db.clanRequest.findMany();
    await expect(w.clans.decideRequest(leader, requests[0]!.id, true)).rejects.toEqual(conflict("clan_request_closed"));
    await w.clans.request(ana, id, "a doua oară");
    expect(await w.clans.daily()).toMatchObject({ expired: 0 });
    expect(await w.db.clanRequest.findMany({ where: { status: "EXPIRED" } })).toHaveLength(1);
  });
});

describe("clasamentul și turneele", () => {
  test("scorul după formula cu ponderi; locurile doar pentru clanurile active", async () => {
    await w.option("clans.max_per_member", 3);
    const a = await w.activeClan({ joinMode: "OPEN" });
    const b = await w.activeClan({ joinMode: "OPEN" });
    const c = await w.activeClan({ joinMode: "OPEN" });
    for (const name of ["Ana", "Bob"]) await w.clans.join(await w.user(name), b.id);
    await w.db.user.update({ where: { id: a.leader.userId! }, data: { reputation: 100 } });
    await w.clans.archive(w.root, c.id);
    await w.clans.recompute(w.root);
    const rows = await w.db.clan.findMany({ orderBy: { id: "asc" } });
    // A: reputația 100 + 1 membru × 5 = 105 (niciun membru activ: `lastActiveAt` gol); B: 3 membri × 5 = 15; C arhivat, fără loc.
    expect(rows.map((r) => r.rank)).toEqual([1, 2, null]);
    expect(rows.slice(0, 2).map((r) => r.score)).toEqual([105, 15]);
    await w.clanAdmin.saveOptions(w.root, { "clans.weight_reputation": 0, "clans.weight_members": 50 });
    expect((await w.db.clan.findMany({ orderBy: { id: "asc" } })).map((r) => r.rank)).toEqual([2, 1, null]);
  });

  test("lista pentru evenimente: liderul, ofițerii cu `events` și staff-ul; ceilalți nu", async () => {
    const { id, leader } = await w.activeClan({ joinMode: "OPEN" });
    const ana = await w.user("Ana");
    await w.clans.join(ana, id);
    await expect(w.clans.eventRoster(ana, id)).rejects.toBeInstanceOf(GcsForbidden);
    expect(await w.clans.canRegisterForEvents(ana, id)).toBe(false);
    const roster = await w.clans.eventRoster(leader, id);
    expect(roster.members.map((m) => m.role)).toEqual(["LEADER", "MEMBER"]);
    expect(await w.clans.canRegisterForEvents(w.root, id)).toBe(true);
  });
});

describe("aplicația dezactivată", () => {
  test("serviciul și citirile răspund ca și cum clanurile nu există", async () => {
    const { id } = await w.activeClan({ joinMode: "OPEN" });
    await w.apps.setEnabled(w.root, "clans", false);
    const ana = await w.user("Ana");
    await expect(w.clans.join(ana, id)).rejects.toBeInstanceOf(GcsNotFound);
    expect(await w.clanQueries.details(ana, id)).toBeNull();
    await expect(w.clanQueries.directory(ana, {})).rejects.toBeInstanceOf(GcsForbidden);
    expect((await w.clanQueries.tagsFor([ana.userId!], "postbit")).size).toBe(0);
    await w.apps.setEnabled(w.root, "clans", true);
    await w.clans.join(ana, id);
  });
});

