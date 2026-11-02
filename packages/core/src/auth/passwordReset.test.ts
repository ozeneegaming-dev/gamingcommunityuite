import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsForbidden, GcsNotFound, GcsRateLimited, GcsValidationError } from "../errors";
import { GcsLoginLockout } from "./lockout";
import { hashPassword, verifyPassword } from "./passwords";
import { GcsPasswordResetService, PASSWORD_RESET_ACCOUNT_LIMIT, PASSWORD_RESET_IP_LIMIT, type GcsPasswordResetMail } from "./passwordReset";
import { GcsRateLimiter } from "./rateLimit";

let w: GcsTestWorld;
let values: Record<string, unknown> = {};
let ipLimit = true;
const DEFAULTS: Record<string, unknown> = {
  "auth.password_reset_enabled": true,
  "auth.password_reset_minutes": 30,
  "auth.password_reset_revoke_sessions": true,
  "email.smtp_host": "smtp.example.com",
  "email.from": "noreply@example.com",
  "security.password_min_length": 8,
  "security.password_require_mix": true,
  "security.login_max_attempts": 3,
  "security.login_lock_minutes": 15,
};
const settings = { get: async <T,>(key: string): Promise<T> => (key in values ? values[key] : DEFAULTS[key]) as T };
let lockout: GcsLoginLockout;
let service: GcsPasswordResetService;

const OLD = "parola-veche-1";
const NEW = "parola-noua-2";
const IP = "203.0.113.20";

beforeEach(async () => {
  w = await createWorld();
  values = {};
  ipLimit = true;
  lockout = new GcsLoginLockout({ db: w.db, kv: w.kv, settings });
  service = new GcsPasswordResetService({
    db: w.db,
    settings,
    rateLimiter: new GcsRateLimiter(w.kv),
    lockout,
    baseUrl: async () => "https://forum.example.com/",
    ipLimit: () => ipLimit,
  });
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

/** Un membru cu parolă (contul `credential`), ca la înregistrarea cu email. */
async function member(name: string, opts: { email?: string; password?: string | null } = {}) {
  const user = await w.createUser(name, "member");
  const email = opts.email ?? `${name.toLowerCase()}@mail.com`;
  await w.db.user.update({ where: { id: user.id }, data: { email, locale: "en", timezone: "Europe/Bucharest" } });
  if (opts.password !== null) {
    await w.db.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: await hashPassword(opts.password ?? OLD) } });
  }
  return { ...user, email };
}

function linkOf(mail: GcsPasswordResetMail | null): { token: string; mail: Extract<GcsPasswordResetMail, { kind: "link" }> } {
  expect(mail?.kind).toBe("link");
  const link = (mail as Extract<GcsPasswordResetMail, { kind: "link" }>).link;
  const url = new URL(link);
  expect(url.origin + url.pathname).toBe("https://forum.example.com/reset-password");
  return { token: url.searchParams.get("token")!, mail: mail as Extract<GcsPasswordResetMail, { kind: "link" }> };
}

async function passwordOf(userId: string): Promise<string> {
  return (await w.db.account.findFirstOrThrow({ where: { userId, providerId: "credential" } })).password!;
}

describe("GcsPasswordResetService: disponibilitatea", () => {
  test("pornită și cu emailul configurat → available; oprită din ACP → disabled; fără SMTP → no_email", async () => {
    await expect(service.availability()).resolves.toBe("available");
    values = { "email.smtp_host": "" };
    await expect(service.availability()).resolves.toBe("no_email");
    values = { "auth.password_reset_enabled": false };
    await expect(service.availability()).resolves.toBe("disabled");
  });

  test("cât timp nu e disponibilă, cererea și resetarea sunt refuzate (GcsForbidden), iar linkurile nu mai merg", async () => {
    const m = await member("Ana");
    const { token } = linkOf(await service.request({ identifier: m.email, ip: IP }));
    values = { "auth.password_reset_enabled": false };
    await expect(service.request({ identifier: m.email, ip: IP })).rejects.toBeInstanceOf(GcsForbidden);
    await expect(service.check(token)).resolves.toBe(false);
    await expect(service.reset({ token, password: NEW, ip: IP })).rejects.toBeInstanceOf(GcsForbidden);
    values = { "email.from": "" };
    await expect(service.reset({ token, password: NEW, ip: IP })).rejects.toBeInstanceOf(GcsForbidden);
    values = {};
    await expect(service.check(token)).resolves.toBe(true);
  });
});

describe("GcsPasswordResetService: cererea", () => {
  test("după email (fără majuscule) sau după nume (fără diacritice): linkul în limba membrului, valabil cât spune setarea", async () => {
    values = { "auth.password_reset_minutes": 45 };
    const m = await member("Ștefan", { email: "stefan@mail.com" });
    const before = Date.now();
    const byEmail = linkOf(await service.request({ identifier: "  Stefan@MAIL.com ", ip: IP }));
    expect(byEmail.mail).toMatchObject({ minutes: 45, to: { id: m.id, name: "Ștefan", email: "stefan@mail.com", locale: "en", timezone: "Europe/Bucharest" } });
    const row = await w.db.verification.findFirstOrThrow({ where: { value: m.id } });
    expect(row.expiresAt.getTime() - before).toBeGreaterThanOrEqual(45 * 60_000 - 2000);
    expect(row.expiresAt.getTime() - before).toBeLessThanOrEqual(45 * 60_000 + 2000);

    const byName = linkOf(await service.request({ identifier: "stefan", ip: IP }));
    expect(byName.mail.to.id).toBe(m.id);
  });

  test("în baza de date stă doar hash-ul tokenului, niciodată tokenul", async () => {
    const m = await member("Bogdan");
    const { token } = linkOf(await service.request({ identifier: m.email, ip: IP }));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await w.db.verification.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.identifier).toBe(`password-reset:${createHash("sha256").update(token).digest("hex")}`);
    expect(rows[0]!.value).toBe(m.id);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  test("fără enumerare: un email sau un nume necunoscut nu scrie nimic și nu aruncă (același răspuns pentru apelant)", async () => {
    await member("Cezar");
    await expect(service.request({ identifier: "nimeni@mail.com", ip: IP })).resolves.toBeNull();
    await expect(service.request({ identifier: "Nimeni", ip: IP })).resolves.toBeNull();
    await expect(service.request({ identifier: "   ", ip: IP })).resolves.toBeNull();
    expect(await w.db.verification.count()).toBe(0);
  });

  test("conturile fără adresă reală (Steam `.invalid`) și contul-bot nu primesc nimic", async () => {
    const steam = await member("Steamer", { email: "76561190000000001@steam.invalid", password: null });
    await w.db.account.create({ data: { userId: steam.id, accountId: "76561190000000001", providerId: "steam" } });
    await expect(service.request({ identifier: "Steamer", ip: IP })).resolves.toBeNull();
    const bot = await member("Botul", { email: "bot@mail.com" });
    await w.db.user.update({ where: { id: bot.id }, data: { isBot: true } });
    await expect(service.request({ identifier: "bot@mail.com", ip: IP })).resolves.toBeNull();
    expect(await w.db.verification.count()).toBe(0);
  });

  test("un cont doar cu Discord / Google (fără parolă) primește explicația, fără link", async () => {
    const m = await member("Social", { password: null });
    await w.db.account.create({ data: { userId: m.id, accountId: "d-1", providerId: "discord" } });
    await w.db.account.create({ data: { userId: m.id, accountId: "g-1", providerId: "google" } });
    const mail = await service.request({ identifier: m.email, ip: IP });
    expect(mail).toEqual({ kind: "social", to: expect.objectContaining({ id: m.id }), providers: ["discord", "google"], loginLink: "https://forum.example.com/login" });
    expect(await w.db.verification.count()).toBe(0);
  });

  test("o cerere nouă anulează linkul trimis înainte", async () => {
    const m = await member("Dana");
    const first = linkOf(await service.request({ identifier: m.email, ip: IP }));
    const second = linkOf(await service.request({ identifier: m.email, ip: IP }));
    await expect(service.check(first.token)).resolves.toBe(false);
    await expect(service.check(second.token)).resolves.toBe(true);
    expect(await w.db.verification.count({ where: { value: m.id } })).toBe(1);
    await expect(service.reset({ token: first.token, password: NEW, ip: IP })).rejects.toBeInstanceOf(GcsNotFound);
  });

  test("limita pe cont: după 3 cereri în 15 minute, următoarele nu mai trimit nimic (și nu spun asta)", async () => {
    const m = await member("Emil");
    let last = "";
    for (let i = 0; i < PASSWORD_RESET_ACCOUNT_LIMIT.max; i++) last = linkOf(await service.request({ identifier: m.email, ip: `198.51.100.${i + 1}` })).token;
    await expect(service.request({ identifier: m.email, ip: "198.51.100.99" })).resolves.toBeNull();
    // Linkul ultimei cereri admise rămâne valabil.
    await expect(service.check(last)).resolves.toBe(true);
  });

  test("limita pe IP numără orice cerere (și pe conturi inexistente) → GcsRateLimited, la fel pentru orice date", async () => {
    const m = await member("Flavia");
    for (let i = 0; i < PASSWORD_RESET_IP_LIMIT.max; i++) await service.request({ identifier: `necunoscut${i}@mail.com`, ip: IP });
    const known = await service.request({ identifier: m.email, ip: IP }).catch((e: unknown) => e);
    const unknown = await service.request({ identifier: "altcineva@mail.com", ip: IP }).catch((e: unknown) => e);
    expect(known).toBeInstanceOf(GcsRateLimited);
    expect(unknown).toBeInstanceOf(GcsRateLimited);
    // Alt IP merge; limita pe IP se oprește odată cu rate limit-ul.
    linkOf(await service.request({ identifier: m.email, ip: "203.0.113.21" }));
    ipLimit = false;
    linkOf(await service.request({ identifier: m.email, ip: IP }));
  });
});

describe("GcsPasswordResetService: resetarea", () => {
  test("parola nouă respectă politica; o încălcare nu consumă linkul, apoi parola se schimbă", async () => {
    const m = await member("Gelu");
    const { token } = linkOf(await service.request({ identifier: m.email, ip: IP }));
    const short = await service.reset({ token, password: "abc12", ip: IP }).catch((e: unknown) => e);
    expect(short).toBeInstanceOf(GcsValidationError);
    expect((short as GcsValidationError).fields).toEqual({ password: "password_too_short" });
    const mix = await service.reset({ token, password: "doarliteremulte", ip: IP }).catch((e: unknown) => e);
    expect((mix as GcsValidationError).fields).toEqual({ password: "password_needs_mix" });
    values = { "security.password_min_length": 16 };
    const longer = await service.reset({ token, password: NEW, ip: IP }).catch((e: unknown) => e);
    expect((longer as GcsValidationError).fields).toEqual({ password: "password_too_short" });
    values = {};
    await expect(service.check(token)).resolves.toBe(true);

    const result = await service.reset({ token, password: NEW, ip: IP });
    expect(result.userId).toBe(m.id);
    await expect(verifyPassword(await passwordOf(m.id), NEW)).resolves.toBe(true);
    await expect(verifyPassword(await passwordOf(m.id), OLD)).resolves.toBe(false);
  });

  test("linkul merge o singură dată", async () => {
    const m = await member("Horia");
    const { token } = linkOf(await service.request({ identifier: m.email, ip: IP }));
    await service.reset({ token, password: NEW, ip: IP });
    await expect(service.check(token)).resolves.toBe(false);
    await expect(service.reset({ token, password: "alta-parola-3", ip: IP })).rejects.toBeInstanceOf(GcsNotFound);
    await expect(verifyPassword(await passwordOf(m.id), NEW)).resolves.toBe(true);
    expect(await w.db.verification.count()).toBe(0);
  });

  test("linkul expiră după minutele din setare", async () => {
    values = { "auth.password_reset_minutes": 10 };
    const m = await member("Ilie");
    const { token } = linkOf(await service.request({ identifier: m.email, ip: IP }));
    const later = new Date(Date.now() + 10 * 60_000 + 5000);
    await expect(service.check(token, new Date(Date.now() + 9 * 60_000))).resolves.toBe(true);
    await expect(service.check(token, later)).resolves.toBe(false);
    await expect(service.reset({ token, password: NEW, ip: IP }, later)).rejects.toBeInstanceOf(GcsNotFound);
    await expect(verifyPassword(await passwordOf(m.id), OLD)).resolves.toBe(true);
  });

  test("tokenuri greșite sau inventate → GcsNotFound", async () => {
    for (const token of ["", "scurt", "x".repeat(43), "a/b+c=".repeat(8)]) {
      await expect(service.reset({ token, password: NEW, ip: IP })).rejects.toBeInstanceOf(GcsNotFound);
      await expect(service.check(token)).resolves.toBe(false);
    }
  });

  test("închide sesiunile membrului (păstrează doar sesiunea lui din browserul curent), uită dispozitivele de încredere, scrie în jurnal", async () => {
    const m = await member("Ion");
    const other = await member("Vecin");
    const exp = new Date(Date.now() + 3_600_000);
    const keep = await w.db.session.create({ data: { token: "s-keep", userId: m.id, expiresAt: exp } });
    await w.db.session.create({ data: { token: "s-2", userId: m.id, expiresAt: exp } });
    await w.db.session.create({ data: { token: "s-3", userId: m.id, expiresAt: exp } });
    const foreign = await w.db.session.create({ data: { token: "s-other", userId: other.id, expiresAt: exp } });
    await w.db.verification.create({ data: { identifier: "trust-device-abc", value: m.id, expiresAt: exp } });
    await w.db.verification.create({ data: { identifier: "trust-device-def", value: other.id, expiresAt: exp } });
    await w.db.user.update({ where: { id: m.id }, data: { twoFactorEnabled: true, passwordResetRequestedAt: new Date(Date.now() - 60_000) } });

    const { token } = linkOf(await service.request({ identifier: m.email, ip: IP }));
    const result = await service.reset({ token, password: NEW, ip: IP, session: { id: keep.id, userId: m.id } });
    expect(result.revokedSessions).toBe(2);
    expect((await w.db.session.findMany({ where: { userId: m.id } })).map((s) => s.id)).toEqual([keep.id]);
    expect(await w.db.session.findUnique({ where: { id: foreign.id } })).not.toBeNull();
    expect(await w.db.verification.findMany({ where: { identifier: { startsWith: "trust-device-" } }, select: { value: true } })).toEqual([{ value: other.id }]);

    // 2FA rămâne activ; resetarea cerută de staff e îndeplinită.
    const user = await w.db.user.findUniqueOrThrow({ where: { id: m.id } });
    expect(user.twoFactorEnabled).toBe(true);
    expect(user.passwordResetRequestedAt).toBeNull();
    const audit = await w.db.auditLog.findMany({ where: { action: "auth.password_reset" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: m.id, targetType: "user", targetId: m.id, ip: IP, after: { via: "email", sessionsRevoked: 2 } });

    expect(result.mail).toMatchObject({ kind: "changed", to: { id: m.id, email: m.email }, ip: IP, sessionsRevoked: true, forgotLink: "https://forum.example.com/forgot-password" });
  });

  test("sesiunea unui alt membru din browser nu e păstrată; cu setarea oprită, sesiunile rămân", async () => {
    const m = await member("Jean");
    const other = await member("Altul");
    const exp = new Date(Date.now() + 3_600_000);
    await w.db.session.create({ data: { token: "j-1", userId: m.id, expiresAt: exp } });
    const foreign = await w.db.session.create({ data: { token: "o-1", userId: other.id, expiresAt: exp } });
    const first = linkOf(await service.request({ identifier: m.email, ip: IP }));
    await service.reset({ token: first.token, password: NEW, ip: IP, session: { id: foreign.id, userId: other.id } });
    expect(await w.db.session.count({ where: { userId: m.id } })).toBe(0);

    values = { "auth.password_reset_revoke_sessions": false };
    await w.db.session.create({ data: { token: "j-2", userId: m.id, expiresAt: exp } });
    await w.db.verification.create({ data: { identifier: "trust-device-jean", value: m.id, expiresAt: exp } });
    const second = linkOf(await service.request({ identifier: m.email, ip: IP }));
    const result = await service.reset({ token: second.token, password: "a-treia-parola-4", ip: IP });
    expect(result.revokedSessions).toBe(0);
    expect(await w.db.session.count({ where: { userId: m.id } })).toBe(1);
    expect(await w.db.verification.count({ where: { identifier: "trust-device-jean" } })).toBe(1);
    expect(result.mail).toMatchObject({ kind: "changed", sessionsRevoked: false });
  });

  test("uită blocarea după parole greșite a contului", async () => {
    const m = await member("Kira");
    for (let i = 0; i < 3; i++) await lockout.recordFailure({ userId: m.id, ip: null });
    await expect(lockout.status({ userId: m.id, ip: null })).resolves.toMatchObject({ scope: "account" });
    const { token } = linkOf(await service.request({ identifier: m.email, ip: IP }));
    await service.reset({ token, password: NEW, ip: IP });
    expect(await lockout.status({ userId: m.id, ip: null })).toBeNull();
  });

  test("două trimiteri simultane ale aceluiași link: una singură schimbă parola", async () => {
    const m = await member("Liviu");
    const { token } = linkOf(await service.request({ identifier: m.email, ip: IP }));
    const results = await Promise.allSettled([service.reset({ token, password: NEW, ip: IP }), service.reset({ token, password: "alta-parola-9", ip: IP })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(GcsNotFound);
    expect(await w.db.auditLog.count({ where: { action: "auth.password_reset" } })).toBe(1);
  });
});
