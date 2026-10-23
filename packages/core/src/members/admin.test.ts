import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { verifyPassword } from "../auth/passwords";
import { GcsConflict, GcsForbidden, GcsValidationError } from "../errors";
import type { GcsActor } from "../permissions/types";
import { csvCell, GcsMemberAdmin, parseCsv } from "./admin";

let w: GcsTestWorld;
let admin: GcsMemberAdmin;
let root: GcsActor;

beforeEach(async () => {
  w = await createWorld();
  admin = new GcsMemberAdmin({ db: w.db, bus: w.bus, acp: w.acp, bans: w.bans });
  root = await w.actorFor(await w.createUser("Root", "root_admin"));
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

describe("CSV", () => {
  test("celulele cu separatori sau formule sunt protejate; parsarea înțelege ghilimelele și „;”", () => {
    expect(csvCell('Ana, "AK"')).toBe('"Ana, ""AK"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(parseCsv('name,email\n"Ana, Maria",a@x.ro\r\n\nBob,b@x.ro')).toEqual([["name", "email"], ["Ana, Maria", "a@x.ro"], ["Bob", "b@x.ro"]]);
    expect(parseCsv("name;email\nAna;a@x.ro")).toEqual([["name", "email"], ["Ana", "a@x.ro"]]);
  });
});

describe("GcsMemberAdmin", () => {
  test("creează un membru cu parolă în grupul ales; numele / emailul luat → GcsValidationError", async () => {
    const created = await admin.create(root, { name: "Nou", email: "Nou@Example.com", password: "parola-buna-1", groupId: w.groups.vip_gold! });
    const user = await w.db.user.findUniqueOrThrow({ where: { id: created.id }, include: { accounts: true } });
    expect(user).toMatchObject({ email: "nou@example.com", primaryGroupId: w.groups.vip_gold, emailVerified: true });
    expect(user.accounts).toHaveLength(1);
    expect(user.accounts[0]).toMatchObject({ providerId: "credential", accountId: created.id });
    expect(await verifyPassword(user.accounts[0]!.password!, "parola-buna-1")).toBe(true);
    await expect(admin.create(root, { name: "nou", email: "alt@example.com", password: "parola-buna-1", groupId: w.groups.member! })).rejects.toMatchObject({ fields: { name: "username_taken" } });
    await expect(admin.create(root, { name: "Scurt", email: "s@example.com", password: "123", groupId: w.groups.member! })).rejects.toBeInstanceOf(GcsValidationError);
  });

  test("doar un Root Admin creează un Root Admin", async () => {
    await w.grantAdmin(["members.members"]);
    const a = await w.actorFor(await w.createUser("Admin", "admin"));
    await expect(admin.create(a, { name: "Hacker", email: "h@example.com", password: "parola-buna-1", groupId: w.groups.root_admin! })).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("importul CSV creează rândurile valide și raportează liniile greșite", async () => {
    await w.createUser("Exista", "member");
    const csv = ["name,email,password,group", "Unu,unu@example.com,parola-buna-1,", "Doi,doi@example.com,parola-buna-1,vip_gold", "exista,x@example.com,parola-buna-1,", "Trei,trei@example.com,parola-buna-1,grup-inexistent"].join("\n");
    const result = await admin.importCsv(root, csv);
    expect(result).toEqual({ created: 2, errors: [{ line: 4, code: "username_taken" }, { line: 5, code: "group_unknown" }] });
    expect((await w.db.user.findFirstOrThrow({ where: { name: "Doi" } })).primaryGroupId).toBe(w.groups.vip_gold);
    await expect(admin.importCsv(root, "nume,mail\nA,b")).rejects.toMatchObject({ fields: { file: "csv_header" } });
  });

  test("exportul CSV are antetul și grupurile secundare; intră în jurnal", async () => {
    await w.createUser("Ana", "member", ["vip_gold", "vip_silver"]);
    const csv = await admin.exportCsv(root, { name: "Ana" });
    const [header, line] = parseCsv(csv);
    expect(header![0]).toBe("id");
    expect(line![1]).toBe("Ana");
    expect(line![4]!.split("|").sort()).toEqual(["VIP Gold", "VIP Silver"].sort());
    expect(await w.db.auditLog.count({ where: { action: "member.export_csv" } })).toBe(1);
  });

  test("validarea confirmă emailul doar celor nevalidați", async () => {
    const a = await w.createUser("A", "member");
    const b = await w.createUser("B", "member");
    await w.db.user.update({ where: { id: b.id }, data: { emailVerified: true } });
    expect(await admin.validate(root, [a.id, b.id])).toBe(1);
    expect((await w.db.user.findUniqueOrThrow({ where: { id: a.id } })).emailVerified).toBe(true);
  });

  test("spammer: marcat + ban permanent; demarcat păstrează banul; Root Admin protejat", async () => {
    const spam = await w.createUser("Spam", "member");
    await admin.setSpammer(root, spam.id, true);
    expect((await w.db.user.findUniqueOrThrow({ where: { id: spam.id } })).isSpammer).toBe(true);
    expect(await w.db.ban.count({ where: { userId: spam.id, type: "ACCOUNT", expiresAt: null } })).toBe(1);
    await admin.setSpammer(root, spam.id, true);
    expect(await w.db.ban.count({ where: { userId: spam.id } })).toBe(1);
    await admin.setSpammer(root, spam.id, false);
    expect((await w.db.user.findUniqueOrThrow({ where: { id: spam.id } })).isSpammer).toBe(false);
    expect(await w.db.ban.count({ where: { userId: spam.id, liftedAt: null } })).toBe(1);

    await w.grantAdmin(["members.members"]);
    const a = await w.actorFor(await w.createUser("Admin", "admin"));
    await expect(admin.setSpammer(a, root.userId!, true)).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("deblocarea 2FA și dezactivarea 2FA (doar Root Admin)", async () => {
    const ana = await w.createUser("Ana", "member");
    await w.db.user.update({ where: { id: ana.id }, data: { twoFactorEnabled: true } });
    await w.db.twoFactor.create({ data: { userId: ana.id, secret: "s", backupCodes: "b", failedVerificationCount: 5, lockedUntil: new Date(Date.now() + 600_000) } });
    expect(await admin.unlock(root, ana.id)).toBe(true);
    expect(await w.db.twoFactor.findFirstOrThrow({ where: { userId: ana.id } })).toMatchObject({ lockedUntil: null, failedVerificationCount: 0 });
    expect(await admin.unlock(root, ana.id)).toBe(false);

    await w.grantAdmin(["members.members"]);
    const a = await w.actorFor(await w.createUser("Admin", "admin"));
    await expect(admin.disableTwoFactor(a, ana.id)).rejects.toMatchObject({ params: { reason: "root_only" } });
    await admin.disableTwoFactor(root, ana.id);
    expect(await w.db.twoFactor.count({ where: { userId: ana.id } })).toBe(0);
    expect((await w.db.user.findUniqueOrThrow({ where: { id: ana.id } })).twoFactorEnabled).toBe(false);
  });

  test("resetarea forțată a parolei: închide sesiunile; rămâne cerută până se schimbă parola", async () => {
    const ana = await w.createUser("Ana", "member");
    await expect(admin.requestPasswordReset(root, ana.id)).rejects.toBeInstanceOf(GcsConflict);
    const account = await w.db.account.create({ data: { userId: ana.id, accountId: ana.id, providerId: "credential", password: "x" } });
    await w.db.session.create({ data: { token: "t", userId: ana.id, expiresAt: new Date(Date.now() + 3_600_000) } });
    await admin.requestPasswordReset(root, ana.id, new Date(Date.now() + 1000));
    expect(await w.db.session.count({ where: { userId: ana.id } })).toBe(0);
    expect(await admin.passwordResetPending(ana.id)).toBe(true);
    await w.db.account.update({ where: { id: account.id }, data: { password: "y", updatedAt: new Date(Date.now() + 5000) } });
    expect(await admin.passwordResetPending(ana.id)).toBe(false);
    expect((await w.db.user.findUniqueOrThrow({ where: { id: ana.id } })).passwordResetRequestedAt).toBeNull();
  });

  test("fără drept ACP → GcsForbidden", async () => {
    const m = await w.actorFor(await w.createUser("Membru", "member"));
    await expect(admin.validate(m, [m.userId!])).rejects.toBeInstanceOf(GcsForbidden);
  });
});
