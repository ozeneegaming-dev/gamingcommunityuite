import { clearIpRangeCache, legacyPasswordHash, POW_HEADER, seedDefaults, solvePow } from "@gcs/core";
import { truncateAll } from "@gcs/db/test/helpers";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { getAuth } from "./auth";
import { resetServices, services } from "./services";

// Serviciile se iau la fiecare test: alte teste (ex. instalarea din CLI) le pot recrea.
const db = new Proxy({} as ReturnType<typeof services>["db"], { get: (_, p) => Reflect.get(services().db, p) });
const kv = new Proxy({} as ReturnType<typeof services>["kv"], { get: (_, p) => Reflect.get(services().kv, p) });
const registry = new Proxy({} as ReturnType<typeof services>["registry"], { get: (_, p) => Reflect.get(services().registry, p) });
const BASE = "http://localhost:3000/api/auth";

beforeEach(async () => {
  await truncateAll(db);
  await kv.flushAll();
  // Intervalele IP banate stau într-un cache din proces: un test anterior (203.0.113.0/24) nu trebuie să rămână activ.
  clearIpRangeCache(services().db);
  await seedDefaults(db, registry);
  // Captcha-ul proof-of-work are testele lui (mai jos); restul înregistrărilor merg fără el.
  await db.setting.upsert({ where: { key: "antispam.captcha" }, create: { key: "antispam.captcha", value: "none" }, update: { value: "none" } });
});

afterAll(async () => {
  await resetServices();
});

async function call(path: string, body: unknown, ip = "203.0.113.10", extra: Record<string, string> = {}): Promise<Response> {
  const auth = await getAuth();
  return auth.handler(
    new Request(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": ip, ...extra },
      body: JSON.stringify(body),
    }),
  );
}

const signUp = (name: string, email: string, password = "parola-sigura-123") =>
  call("/sign-up/email", { name, email, password });

/** O setare scrisă ca din ACP (validată, cu invalidarea cache-ului). */
const ACP_ACTOR = { userId: null, groupIds: [], primaryGroupId: 0, isBanned: false, ip: "test" };
const setAcpSetting = (key: string, value: unknown) => services().settings.set(key, value, ACP_ACTOR);
const LEGAL_DOC = { doc: { type: "doc", content: [] }, html: "<p>Termenii</p>", updatedAt: "2026-11-01T10:00:00.000Z" };

describe("Better Auth (integrare)", () => {
  test("înregistrarea cu email creează userul în new_member, cu email lowercase și hash Argon2id", async () => {
    const res = await signUp("Ștefan", "Stefan@Mail.com");
    expect(res.status).toBe(200);

    const user = await db.user.findUniqueOrThrow({ where: { email: "stefan@mail.com" }, include: { primaryGroup: true } });
    expect(user).toMatchObject({ name: "Ștefan", nameNormalized: "stefan" });
    expect(user.primaryGroup.key).toBe("new_member");
    const account = await db.account.findFirstOrThrow({ where: { userId: user.id, providerId: "credential" } });
    expect(account.password?.startsWith("$argon2id$")).toBe(true);
  });

  test("Review Focus #1: „ştefan” după „Ștefan” → username_taken", async () => {
    await signUp("Ștefan", "a@mail.com");
    const res = await signUp("ştefan", "b@mail.com");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "USERNAME_TAKEN" });
    expect(await db.user.count({ where: { isBot: false } })).toBe(1);
  });

  test("Review Focus #1: Bling@Mail.com și bling@mail.com sunt același cont", async () => {
    await signUp("Bling", "bling@mail.com");
    const res = await signUp("Bling2", "Bling@Mail.com");
    expect(res.ok).toBe(false);
    expect(await db.user.count({ where: { isBot: false } })).toBe(1);

    const signIn = await call("/sign-in/email", { email: "BLING@mail.com", password: "parola-sigura-123" });
    expect(signIn.status).toBe(200);
  });

  test("login-ul dă un cookie de sesiune httpOnly, iar actorul e userul cu grupurile lui", async () => {
    await signUp("Krypt", "krypt@mail.com");
    const res = await call("/sign-in/email", { email: "krypt@mail.com", password: "parola-sigura-123" });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/gcs\.session_token=/);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");

    const auth = await getAuth();
    const session = await auth.api.getSession({ headers: new Headers({ cookie: cookie.split(";")[0]! }) });
    expect(session?.user.email).toBe("krypt@mail.com");

    const actor = await services().actors.getActor({ sessionToken: session!.session.token, ip: "203.0.113.10" });
    const newMember = await db.group.findUniqueOrThrow({ where: { key: "new_member" } });
    expect(actor).toMatchObject({ userId: session!.user.id, primaryGroupId: newMember.id, isBanned: false });
  });

  test("rate limit: a 6-a încercare de login de pe același IP în 15 minute → 429", async () => {
    // Doar rate limit-ul: blocarea după parole greșite (ACP → Setări → Securitate) are testul ei.
    await setAcpSetting("security.login_max_attempts", 0);
    await signUp("Tinta", "tinta@mail.com");
    for (let i = 0; i < 5; i++) {
      const res = await call("/sign-in/email", { email: "tinta@mail.com", password: "gresita-123" }, "198.51.100.7");
      expect(res.status).toBe(401);
    }
    const blocked = await call("/sign-in/email", { email: "tinta@mail.com", password: "parola-sigura-123" }, "198.51.100.7");
    expect(blocked.status).toBe(429);

    const otherIp = await call("/sign-in/email", { email: "tinta@mail.com", password: "parola-sigura-123" }, "198.51.100.8");
    expect(otherIp.status).toBe(200);
  });

  test("un membru importat intră cu parola veche (hash marcat), care se rescrie apoi în Argon2id", async () => {
    await signUp("Importat", "importat@mail.com");
    const user = await db.user.findUniqueOrThrow({ where: { email: "importat@mail.com" } });
    const { createHash } = await import("node:crypto");
    const sha = (s: string) => createHash("sha256").update(s).digest("hex");
    const legacy = legacyPasswordHash({ scheme: "sha256s", salt: "sare", hash: sha(sha("parola-veche-9") + "sare") });
    await db.account.updateMany({ where: { userId: user.id, providerId: "credential" }, data: { password: legacy } });

    expect((await call("/sign-in/email", { email: "importat@mail.com", password: "gresita-123" }, "198.51.100.30")).status).toBe(401);
    expect((await db.account.findFirstOrThrow({ where: { userId: user.id } })).password).toBe(legacy);
    expect((await call("/sign-in/email", { email: "importat@mail.com", password: "parola-veche-9" }, "198.51.100.30")).status).toBe(200);
    const account = await db.account.findFirstOrThrow({ where: { userId: user.id } });
    expect(account.password?.startsWith("$argon2id$")).toBe(true);
    expect((await call("/sign-in/email", { email: "importat@mail.com", password: "parola-veche-9" }, "198.51.100.31")).status).toBe(200);
  });

  test("anti-spam: înregistrarea închisă din ACP e refuzată pe server; IP-ul înregistrării se salvează", async () => {
    const ok = await call("/sign-up/email", { name: "Primul", email: "primul@mail.com", password: "parola-sigura-123" }, "198.51.100.40");
    expect(ok.status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { email: "primul@mail.com" } })).registrationIp).toBe("198.51.100.40");
    await db.setting.upsert({ where: { key: "auth.registration_open" }, create: { key: "auth.registration_open", value: false }, update: { value: false } });
    await kv.flushAll();
    const closed = await signUp("Alt", "alt@mail.com");
    expect(closed.status).toBe(403);
    expect(await closed.json()).toMatchObject({ code: "REGISTRATION_CLOSED" });
    expect(await db.user.count({ where: { email: "alt@mail.com" } })).toBe(0);
  });

  test("anti-spam: un domeniu de email sau un interval IP banat nu se poate înregistra; un cont banat nu se poate autentifica", async () => {
    await db.ban.create({ data: { type: "EMAIL", value: "@mail-spam.ro", reason: "spam" } });
    const byDomain = await signUp("Spam", "cineva@mail-spam.ro");
    expect(byDomain.status).toBe(403);
    expect(await byDomain.json()).toMatchObject({ code: "BANNED" });

    await db.ban.create({ data: { type: "IP", value: "203.0.113.0/24", reason: "boți" } });
    clearIpRangeCache(services().db);
    const byRange = await call("/sign-up/email", { name: "Bot", email: "bot@mail.com", password: "parola-sigura-123" }, "203.0.113.200");
    expect(byRange.status).toBe(403);

    expect((await call("/sign-up/email", { name: "Cinstit", email: "cinstit@mail.com", password: "parola-sigura-123" }, "198.51.100.42")).status).toBe(200);
    const user = await db.user.findUniqueOrThrow({ where: { email: "cinstit@mail.com" } });
    await db.ban.create({ data: { type: "ACCOUNT", value: user.id, userId: user.id, reason: "reclame" } });
    // Sesiunea de la înregistrare rămâne (o șterge doar banul dat prin serviciu); autentificarea nu mai creează alta.
    const before = await db.session.count({ where: { userId: user.id } });
    const signIn = await call("/sign-in/email", { email: "cinstit@mail.com", password: "parola-sigura-123" }, "198.51.100.41");
    expect(signIn.status).toBe(403);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(before);
  });

  test("anti-spam: captcha-ul proof-of-work și întrebarea opresc înregistrarea cu email până la răspunsul corect", async () => {
    const setSetting = (key: string, value: unknown) =>
      db.setting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } }).then(() => kv.flushAll());
    await setSetting("antispam.captcha", "pow");
    await setSetting("antispam.pow_difficulty", 8);
    const body = { name: "Captcha", email: "captcha@mail.com", password: "parola-sigura-123" };
    const missing = await call("/sign-up/email", body, "198.51.100.50");
    expect(missing.status).toBe(403);
    expect(await missing.json()).toMatchObject({ code: "CAPTCHA_FAILED" });
    const token = solvePow(await services().antispam.powChallenge());
    expect((await call("/sign-up/email", body, "198.51.100.50", { [POW_HEADER]: token })).status).toBe(200);
    // Aceeași soluție nu merge de două ori.
    expect((await call("/sign-up/email", { ...body, name: "Captcha2", email: "captcha2@mail.com" }, "198.51.100.50", { [POW_HEADER]: token })).status).toBe(403);

    await setSetting("antispam.captcha", "none");
    const q = await db.registrationQuestion.create({ data: { question: "Ce joc?", answers: ["Counter-Strike 2"] } });
    const qa = { name: "Intrebare", email: "intrebare@mail.com", password: "parola-sigura-123" };
    const wrong = await call("/sign-up/email", qa, "198.51.100.51", { "x-gcs-qa-id": String(q.id), "x-gcs-qa-answer": encodeURIComponent("minecraft") });
    expect(await wrong.json()).toMatchObject({ code: "QA_FAILED" });
    const ok = await call("/sign-up/email", qa, "198.51.100.51", { "x-gcs-qa-id": String(q.id), "x-gcs-qa-answer": encodeURIComponent("counter-strike 2") });
    expect(ok.status).toBe(200);
    expect(await db.spamLog.count({ where: { kind: { in: ["captcha_failed", "qa_failed"] } } })).toBe(3);
  });
  test("blocarea după parole greșite: a N-a parolă greșită blochează contul de pe orice IP; o parolă corectă nu trece până la deblocare", async () => {
    await setAcpSetting("security.login_max_attempts", 3);
    await setAcpSetting("security.login_lock_minutes", 20);
    await signUp("Blocat", "blocat@mail.com");
    // IP-uri diferite: rate limit-ul pe IP nu se amestecă.
    for (let i = 0; i < 3; i++) expect((await call("/sign-in/email", { email: "blocat@mail.com", password: "gresita-123" }, `198.51.100.${60 + i}`)).status).toBe(401);
    const user = await db.user.findUniqueOrThrow({ where: { email: "blocat@mail.com" } });
    const sessions = await db.session.count({ where: { userId: user.id } });
    const locked = await call("/sign-in/email", { email: "blocat@mail.com", password: "parola-sigura-123" }, "198.51.100.70");
    expect(locked.status).toBe(403);
    const body = (await locked.json()) as { code: string; message: string };
    expect(body.code).toBe("ACCOUNT_LOCKED");
    expect(Number(body.message)).toBeGreaterThanOrEqual(19);
    // Parola corectă nu a deschis nicio sesiune.
    expect(await db.session.count({ where: { userId: user.id } })).toBe(sessions);
    expect(await db.auditLog.count({ where: { action: "auth.login_locked", targetId: user.id } })).toBe(1);

    // Deblocarea din ACP (pagina membrului) → parola corectă trece din nou.
    await services().loginLockout.unlock(ACP_ACTOR, user.id);
    expect((await call("/sign-in/email", { email: "blocat@mail.com", password: "parola-sigura-123" }, "198.51.100.71")).status).toBe(200);
  });

  test("blocarea: o parolă corectă înainte de prag uită încercările greșite", async () => {
    await setAcpSetting("security.login_max_attempts", 3);
    await signUp("Uituc", "uituc@mail.com");
    for (let i = 0; i < 2; i++) await call("/sign-in/email", { email: "uituc@mail.com", password: "gresita-123" }, `198.51.100.${80 + i}`);
    expect((await call("/sign-in/email", { email: "uituc@mail.com", password: "parola-sigura-123" }, "198.51.100.82")).status).toBe(200);
    for (let i = 0; i < 2; i++) await call("/sign-in/email", { email: "uituc@mail.com", password: "gresita-123" }, `198.51.100.${83 + i}`);
    expect((await call("/sign-in/email", { email: "uituc@mail.com", password: "parola-sigura-123" }, "198.51.100.85")).status).toBe(200);
  });

  test("politica parolelor: refuzată pe server la înregistrare (lungimea din ACP, litere și cifre)", async () => {
    const mix = await signUp("Litere", "litere@mail.com", "parolafaracifre");
    expect(mix.status).toBe(400);
    expect(await mix.json()).toMatchObject({ code: "PASSWORD_NEEDS_MIX" });
    await setAcpSetting("security.password_min_length", 12);
    const short = await signUp("Scurt", "scurt@mail.com", "parola-123");
    expect(short.status).toBe(400);
    expect(await short.json()).toMatchObject({ code: "PASSWORD_TOO_SHORT" });
    expect((await signUp("Lung", "lung@mail.com", "parola-sigura-123")).status).toBe(200);
    await setAcpSetting("security.password_require_mix", false);
    expect((await signUp("FaraCifre", "faracifre@mail.com", "parolafaracifre")).status).toBe(200);
    expect(await db.user.count({ where: { isBot: false } })).toBe(2);
  });

  test("politica parolelor: și la schimbarea parolei", async () => {
    await signUp("Schimb", "schimb@mail.com");
    const signIn = await call("/sign-in/email", { email: "schimb@mail.com", password: "parola-sigura-123" }, "198.51.100.90");
    const cookie = signIn.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const weak = await call("/change-password", { currentPassword: "parola-sigura-123", newPassword: "doarlitere" }, "198.51.100.90", { cookie });
    expect(weak.status).toBe(400);
    expect(await weak.json()).toMatchObject({ code: "PASSWORD_NEEDS_MIX" });
    expect((await call("/change-password", { currentPassword: "parola-sigura-123", newPassword: "parola-noua-456" }, "198.51.100.90", { cookie })).status).toBe(200);
  });

  test("termenii: cu o pagină de termeni, înregistrarea fără acceptare e refuzată; acceptarea se salvează la membru", async () => {
    // Fără termeni publicați, nimic nu se cere.
    expect((await signUp("Liber", "liber@mail.com")).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { email: "liber@mail.com" } })).termsAcceptedAt).toBeNull();

    await setAcpSetting("legal.terms_content", LEGAL_DOC);
    await setAcpSetting("legal.terms_mode", "page");
    const refused = await signUp("Grabit", "grabit@mail.com");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "TERMS_REQUIRED" });
    expect(await db.user.count({ where: { email: "grabit@mail.com" } })).toBe(0);

    const before = Date.now();
    const ok = await call("/sign-up/email", { name: "Atent", email: "atent@mail.com", password: "parola-sigura-123" }, "203.0.113.10", { "x-gcs-terms": "1" });
    expect(ok.status).toBe(200);
    const accepted = (await db.user.findUniqueOrThrow({ where: { email: "atent@mail.com" } })).termsAcceptedAt;
    expect(accepted?.getTime()).toBeGreaterThanOrEqual(before - 1000);

    // Acceptarea poate fi făcută opțională din ACP.
    await setAcpSetting("legal.require_terms_on_register", false);
    expect((await signUp("Optional", "optional@mail.com")).status).toBe(200);
  });

  test("2FA: codul pe email e refuzat cât timp recuperarea e doar cu codurile de rezervă; 2FA nu se activează doar cu emailul", async () => {
    const otp = await call("/two-factor/send-otp", {}, "198.51.100.95");
    expect(otp.status).toBe(403);
    expect(await otp.json()).toMatchObject({ code: "OTP_DISABLED" });
    await signUp("Doi", "doi@mail.com");
    const signIn = await call("/sign-in/email", { email: "doi@mail.com", password: "parola-sigura-123" }, "198.51.100.96");
    const cookie = signIn.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const enable = await call("/two-factor/enable", { password: "parola-sigura-123", method: "otp" }, "198.51.100.96", { cookie });
    expect(enable.status).toBe(403);
    expect((await db.user.findUniqueOrThrow({ where: { email: "doi@mail.com" } })).twoFactorEnabled).toBe(false);
  });
});
