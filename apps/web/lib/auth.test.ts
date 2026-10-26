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
});
