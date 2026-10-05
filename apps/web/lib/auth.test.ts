import { seedDefaults } from "@gcs/core";
import { truncateAll } from "@gcs/db/test/helpers";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { getAuth } from "./auth";
import { resetServices, services } from "./services";

// Serviciile se iau la fiecare test: alte teste (ex. instalarea din CLI) le pot recrea.
const db = new Proxy({} as ReturnType<typeof services>["db"], { get: (_, p) => Reflect.get(services().db, p) });
const redis = new Proxy({} as ReturnType<typeof services>["redis"], { get: (_, p) => Reflect.get(services().redis, p) });
const registry = new Proxy({} as ReturnType<typeof services>["registry"], { get: (_, p) => Reflect.get(services().registry, p) });
const BASE = "http://localhost:3000/api/auth";

beforeEach(async () => {
  await truncateAll(db);
  await redis.flushdb();
  await seedDefaults(db, registry);
});

afterAll(async () => {
  await resetServices();
});

async function call(path: string, body: unknown, ip = "203.0.113.10"): Promise<Response> {
  const auth = await getAuth();
  return auth.handler(
    new Request(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": ip },
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
    expect(await db.user.count()).toBe(1);
  });

  test("Review Focus #1: Bling@Mail.com și bling@mail.com sunt același cont", async () => {
    await signUp("Bling", "bling@mail.com");
    const res = await signUp("Bling2", "Bling@Mail.com");
    expect(res.ok).toBe(false);
    expect(await db.user.count()).toBe(1);

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
});
