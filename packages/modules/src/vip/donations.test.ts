import { GcsConflict, GcsForbidden, type GcsActor } from "@gcs/core";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createProfileWorld, type GcsProfileWorld } from "../../test/profileWorld";
import { GcsProfileExtras } from "../profile/extras";
import { registerDonationNotifications } from "./donationNotify";
import { DONATIONS_ACP_SECTION, DONATION_GOALS_ACP_SECTION, GcsDonationService, type GcsDonationInput } from "./donations";

let w: GcsProfileWorld;
let donations: GcsDonationService;
let admin: GcsActor;
let ana: GcsActor;
let bogdan: GcsActor;
let now: Date;
const publish = vi.fn(async () => {});
const thankYou = vi.fn(async () => {});

/** O donație din ACP: confirmată, în RON, pentru membrul dat (după nume). */
const input = (patch: Partial<GcsDonationInput> = {}): GcsDonationInput => ({
  member: "",
  donorName: "",
  amount: 10,
  currency: "RON",
  donatedAt: "",
  method: "PayPal",
  note: "",
  anonymous: false,
  status: "CONFIRMED",
  ...patch,
});

const types = async (userId: string | null) => (await w.db.notification.findMany({ where: { userId: userId! }, orderBy: { id: "asc" } })).map((n) => n.type);

beforeEach(async () => {
  w = await createProfileWorld();
  await w.grantAdmin([DONATIONS_ACP_SECTION, DONATION_GOALS_ACP_SECTION]);
  admin = await w.actorFor(await w.createUser("Casier", "admin"));
  ana = await w.actorFor(await w.createUser("Ana", "member"));
  bogdan = await w.actorFor(await w.createUser("Bogdan", "member"));
  now = new Date("2026-10-17T10:00:00Z");
  publish.mockClear();
  thankYou.mockClear();
  await w.settings.set("donations.currency", "RON", w.root);
  donations = new GcsDonationService({ db: w.db, bus: w.bus, settings: w.settings, acp: w.acp, realtime: { publish }, thankYou, clock: () => now });
  registerDonationNotifications({ db: w.db, bus: w.bus, notifications: w.notifications, acp: w.acp, actors: w.actors });
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

describe("donațiile din ACP", () => {
  test("adăugarea: membrul după nume sau un nume fără cont; suma în subunități; validarea; doar cu dreptul ACP", async () => {
    const row = await donations.record(admin, input({ member: "ana", amount: 25.5, currency: "ron", note: "  pentru   servere ", donatedAt: "2026-10-05" }));
    expect(row).toMatchObject({ userId: ana.userId, amount: 2550, currency: "RON", note: "pentru servere", status: "CONFIRMED", source: "manual", createdById: admin.userId });
    expect(row.donatedAt.toISOString().slice(0, 10)).toBe("2026-10-05");
    const guestRow = await donations.record(admin, input({ donorName: "Un prieten", amount: 5 }));
    expect(guestRow).toMatchObject({ userId: null, donorName: "Un prieten" });
    await expect(donations.record(admin, input({ member: "nimeni" }))).rejects.toMatchObject({ fields: { member: "member_not_found" } });
    await expect(donations.record(admin, input({ amount: 0, currency: "RONX", donatedAt: "2027-01-01" }))).rejects.toMatchObject({ fields: { amount: "invalid_range", currency: "invalid", donatedAt: "invalid_date" } });
    await expect(donations.record(ana, input())).rejects.toBeInstanceOf(GcsForbidden);
    expect(await w.db.auditLog.count({ where: { action: "donation.add" } })).toBe(2);
    // Orice schimbare anunță widget-urile (camera tuturor), fără date: fiecare își cere din nou progresul.
    expect(publish).toHaveBeenCalledWith("presence", "donations:update", {});
  });

  test("editarea, ștergerea, lista cu filtre și exportul CSV", async () => {
    const a = await donations.record(admin, input({ member: "Ana", amount: 40, method: "Revolut", note: '=SUM(1), "x"' }));
    await donations.record(admin, input({ donorName: "Prieten", amount: 15, status: "PENDING" }));
    const edited = await donations.update(admin, a.id, input({ member: "Ana", amount: 45, method: "Revolut", note: '=SUM(1), "x"', anonymous: true }));
    expect(edited).toMatchObject({ amount: 4500, anonymous: true });
    expect((await donations.adminList({ status: "PENDING" })).total).toBe(1);
    expect((await donations.adminList({ q: "ana" })).rows.map((r) => r.id)).toEqual([a.id]);
    expect((await donations.adminList({ method: "revolut" })).rows).toHaveLength(1);
    const csv = await donations.exportCsv(admin, {});
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("id,date,member,donor_name,amount,currency,method,status,anonymous,reference,note");
    expect(lines).toHaveLength(3);
    expect(csv).toContain(`${a.id},2026-10-17,Ana,,45.00,RON,Revolut,CONFIRMED,yes,,`);
    // Formulele scrise în celule nu se execută în foaia de calcul.
    expect(csv).toContain(`"'=SUM(1), ""x"""`);
    await donations.remove(admin, a.id);
    expect((await donations.adminList({})).total).toBe(1);
  });
});

describe("„Am donat” → confirmarea echipei → notificarea", () => {
  test("membrul trimite, echipa e anunțată, confirmă (o singură dată) și donatorul primește notificarea", async () => {
    const pending = await donations.submit(ana, { amount: 50, currency: "RON", method: "Revolut", reference: "TX-1234", note: "", anonymous: false });
    expect(pending).toMatchObject({ status: "PENDING", source: "member", userId: ana.userId, reference: "TX-1234" });
    // Echipa cu dreptul pe donații (adminul și Root Admin) e anunțată; donatorul nu.
    expect(await types(admin.userId)).toEqual(["donations.submitted"]);
    expect(await types(w.root.userId)).toEqual(["donations.submitted"]);
    expect(await types(ana.userId)).toEqual([]);
    // În așteptare: nu intră în progres.
    expect((await donations.top("month", 5)).map((t) => t.total)).toEqual([]);

    await expect(donations.confirm(bogdan, pending.id)).rejects.toBeInstanceOf(GcsForbidden);
    const ok = await donations.confirm(admin, pending.id, { notify: true });
    expect(ok).toMatchObject({ status: "CONFIRMED", reviewedById: admin.userId });
    await expect(donations.confirm(admin, pending.id)).rejects.toBeInstanceOf(GcsConflict);
    expect(await types(ana.userId)).toEqual(["donations.confirmed"]);
    const note = await w.db.notification.findFirstOrThrow({ where: { userId: ana.userId! } });
    expect(note.data).toMatchObject({ title: "50 RON", href: "/donatii" });
    // Cârligul mesajului de mulțumire (botul comunității, când există).
    expect(thankYou).toHaveBeenCalledWith(expect.objectContaining({ id: pending.id, userId: ana.userId }));
    expect((await donations.top("month", 5)).map((t) => t.total)).toEqual([5000]);
  });

  test("respingerea cu motiv; referința e obligatorie; limita de cereri în așteptare; oprirea din setări", async () => {
    await expect(donations.submit(ana, { amount: 10, currency: "RON", method: "", reference: " ", note: "", anonymous: false })).rejects.toMatchObject({ fields: { reference: "required" } });
    const p = await donations.submit(ana, { amount: 10, currency: "RON", method: "", reference: "abc-1", note: "", anonymous: true });
    const rejected = await donations.reject(admin, p.id, "Nu am găsit plata");
    expect(rejected).toMatchObject({ status: "REJECTED", rejectReason: "Nu am găsit plata" });
    expect(await types(ana.userId)).toEqual(["donations.rejected"]);
    await expect(donations.reject(admin, p.id, "")).rejects.toBeInstanceOf(GcsConflict);
    for (let i = 0; i < 3; i++) await donations.submit(ana, { amount: 1, currency: "RON", method: "", reference: `ref-${i}`, note: "", anonymous: false });
    await expect(donations.submit(ana, { amount: 1, currency: "RON", method: "", reference: "ref-x", note: "", anonymous: false })).rejects.toMatchObject({ params: { reason: "donation_pending_limit" } });
    await w.settings.set("donations.member_submit", false, w.root);
    await expect(donations.submit(bogdan, { amount: 1, currency: "RON", method: "", reference: "ref-y", note: "", anonymous: false })).rejects.toBeInstanceOf(GcsForbidden);
    await expect(donations.submit(w.guest, { amount: 1, currency: "RON", method: "", reference: "ref-z", note: "", anonymous: false })).rejects.toBeInstanceOf(GcsForbidden);
    expect((await donations.mine(ana.userId!)).map((d) => d.status)).toEqual(["PENDING", "PENDING", "PENDING", "REJECTED"]);
  });

  test("un procesator de plăți (mai târziu): aceeași plată adusă de două ori rămâne o singură donație", async () => {
    const first = await donations.recordFromProvider({ source: "demo-pay", externalId: "pay_1", userId: ana.userId, amount: 1200, currency: "RON" });
    const again = await donations.recordFromProvider({ source: "demo-pay", externalId: "pay_1", userId: ana.userId, amount: 1200, currency: "RON" });
    expect(again.id).toBe(first.id);
    expect(await w.db.memberDonation.count({ where: { source: "demo-pay" } })).toBe(1);
    expect(first.status).toBe("CONFIRMED");
  });
});

describe("obiectivele", () => {
  async function monthlyGoal(patch: Record<string, unknown> = {}) {
    return donations.saveGoal(admin, null, { title: "Plata serverelor", target: 1000, currency: "RON", period: "MONTHLY", startsOn: "2026-09-01", endsOn: "", autoRenew: true, groupIds: [], enabled: true, ...patch });
  }

  test("progresul = donațiile confirmate din perioadă, în moneda obiectivului; donatorii distincți; ultimul donator", async () => {
    const goal = await monthlyGoal();
    await donations.record(admin, input({ member: "Ana", amount: 300, donatedAt: "2026-10-02" }));
    await donations.record(admin, input({ member: "Ana", amount: 40, donatedAt: "2026-10-03" }));
    await donations.record(admin, input({ member: "Bogdan", amount: 250, donatedAt: "2026-10-10" }));
    await donations.record(admin, input({ donorName: "Prieten", amount: 50, donatedAt: "2026-10-16" }));
    await donations.record(admin, input({ member: "Ana", amount: 200, donatedAt: "2026-09-30" }));
    await donations.record(admin, input({ member: "Ana", amount: 100, currency: "EUR", donatedAt: "2026-10-11" }));
    await donations.record(admin, input({ member: "Bogdan", amount: 80, status: "PENDING", donatedAt: "2026-10-12" }));
    const view = await donations.goalView(w.guest, goal.id);
    expect(view).toMatchObject({ id: goal.id, title: "Plata serverelor", raised: 64000, target: 100000, currency: "RON", percent: 64, donors: 3, period: { startDay: "2026-10-01", endDay: "2026-10-31", state: "active" } });
    expect(view!.last).toMatchObject({ donor: { kind: "name", name: "Prieten" }, amount: 5000 });
    // Fără id: primul obiectiv activ vizibil.
    expect((await donations.goalView(w.guest, null))?.id).toBe(goal.id);
  });

  test("reînnoirea lunară: luna nouă pornește de la zero; fără reînnoire, obiectivul se încheie cu totalul lui", async () => {
    const renew = await monthlyGoal();
    const once = await monthlyGoal({ title: "Doar octombrie", startsOn: "2026-10-01", autoRenew: false });
    await donations.record(admin, input({ member: "Ana", amount: 300, donatedAt: "2026-10-02" }));
    now = new Date("2026-11-02T10:00:00Z");
    expect(await donations.goalView(w.guest, renew.id)).toMatchObject({ raised: 0, donors: 0, last: null, period: { startDay: "2026-11-01", state: "active" } });
    await donations.record(admin, input({ member: "Bogdan", amount: 20 }));
    expect((await donations.goalView(w.guest, renew.id))?.raised).toBe(2000);
    expect(await donations.goalView(w.guest, once.id)).toMatchObject({ raised: 30000, period: { startDay: "2026-10-01", state: "ended" } });
    // Obiectivul implicit al widget-ului e cel activ, nu cel încheiat.
    expect((await donations.goalView(w.guest, null))?.id).toBe(renew.id);
  });

  test("vizibil doar grupurilor alese; validarea; ștergerea", async () => {
    const vipOnly = await monthlyGoal({ groupIds: [w.groups.vip_gold!] });
    expect(await donations.goalView(w.guest, vipOnly.id)).toBeNull();
    expect(await donations.goalView(ana, null)).toBeNull();
    await w.db.userGroup.create({ data: { userId: ana.userId!, groupId: w.groups.vip_gold! } });
    expect((await donations.goalView(await w.actorFor({ id: ana.userId! }), vipOnly.id))?.id).toBe(vipOnly.id);
    await expect(monthlyGoal({ title: " ", target: 0, currency: "x", period: "CUSTOM", startsOn: "2026-10-10", endsOn: "2026-10-01" })).rejects.toMatchObject({
      fields: { title: "required", target: "invalid_range", currency: "invalid", endsOn: "invalid_date" },
    });
    await expect(donations.saveGoal(ana, null, { title: "x", target: 1, currency: "RON", period: "MONTHLY", startsOn: "2026-10-01", endsOn: "", autoRenew: true, groupIds: [], enabled: true })).rejects.toBeInstanceOf(GcsForbidden);
    await donations.deleteGoal(admin, vipOnly.id);
    expect(await donations.goals()).toEqual([]);
  });
});

describe("donatorii publici", () => {
  test("ultimele donații și topul pe lună / an / tot: anonimii apar „Anonim” în ultimele, dar nu în top; doar moneda principală", async () => {
    await donations.record(admin, input({ member: "Ana", amount: 30, donatedAt: "2026-10-02" }));
    await donations.record(admin, input({ member: "Ana", amount: 30, donatedAt: "2026-03-02" }));
    await donations.record(admin, input({ member: "Ana", amount: 30, donatedAt: "2025-12-20" }));
    await donations.record(admin, input({ member: "Bogdan", amount: 70, donatedAt: "2026-10-05" }));
    await donations.record(admin, input({ member: "Bogdan", amount: 500, donatedAt: "2026-10-06", anonymous: true }));
    await donations.record(admin, input({ donorName: "Prieten", amount: 45, donatedAt: "2026-02-01" }));
    await donations.record(admin, input({ member: "Ana", amount: 999, currency: "EUR", donatedAt: "2026-10-07" }));
    await donations.record(admin, input({ member: "Bogdan", amount: 999, status: "PENDING", donatedAt: "2026-10-08" }));

    const latest = await donations.latest(10);
    // Toate monedele, doar cele confirmate, cele mai noi primele.
    expect(latest.map((d) => (d.donor.kind === "member" ? d.donor.user.name : d.donor.kind === "name" ? d.donor.name : "Anonim"))).toEqual(["Ana", "Anonim", "Bogdan", "Ana", "Ana", "Prieten", "Ana"]);
    expect(latest[0]).toMatchObject({ amount: 99900, currency: "EUR" });
    // Donația anonimă nu dezvăluie membrul.
    expect(JSON.stringify(latest.find((d) => d.donor.kind === "anonymous"))).not.toContain(bogdan.userId!);

    const names = (rows: Awaited<ReturnType<GcsDonationService["top"]>>) => rows.map((r) => [r.donor.kind === "member" ? r.donor.user.name : r.donor.kind === "name" ? r.donor.name : "?", r.total]);
    expect(names(await donations.top("month", 10))).toEqual([["Bogdan", 7000], ["Ana", 3000]]);
    expect(names(await donations.top("year", 10))).toEqual([["Bogdan", 7000], ["Ana", 6000], ["Prieten", 4500]]);
    expect(names(await donations.top("all", 10))).toEqual([["Ana", 9000], ["Bogdan", 7000], ["Prieten", 4500]]);
    expect((await donations.top("all", 10))[0]).toMatchObject({ rank: 1, count: 3, since: expect.stringMatching(/^2025-12-20/) });
    expect(await donations.top("all", 1)).toHaveLength(1);
  });

  test("insigna „Sponsor”: pragul și perioada din setări, doar donațiile confirmate, publice, în moneda principală", async () => {
    const extras = new GcsProfileExtras({ db: w.db, cache: w.cache, queries: w.profileQueries, sponsor: (id) => donations.sponsor(id) });
    await w.settings.set("profile.sponsor_min_amount", 50, w.root);
    await donations.record(admin, input({ member: "Ana", amount: 30, donatedAt: "2026-09-20" }));
    await donations.record(admin, input({ member: "Ana", amount: 25, donatedAt: "2026-10-02" }));
    await donations.record(admin, input({ member: "Ana", amount: 100, currency: "EUR" }));
    await donations.record(admin, input({ member: "Ana", amount: 100, status: "PENDING" }));
    await donations.record(admin, input({ member: "Bogdan", amount: 100, anonymous: true }));
    expect(await donations.sponsor(ana.userId!)).toEqual({ total: 5500, sponsor: true });
    expect((await extras.achievements(w.guest, ana.userId!))?.sponsor).toBe(true);
    expect((await donations.sponsor(bogdan.userId!)).sponsor).toBe(false);
    await w.settings.set("donations.sponsor_period", "month", w.root);
    expect(await donations.sponsor(ana.userId!)).toEqual({ total: 2500, sponsor: false });
    await w.settings.set("donations.sponsor_period", "all", w.root);
    await w.settings.set("profile.sponsor_min_amount", 0, w.root);
    expect((await donations.sponsor(ana.userId!)).sponsor).toBe(false);
  });
});
