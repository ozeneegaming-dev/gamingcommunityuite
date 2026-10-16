import { createECDH, randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsPushService, PUSH_KEYS_SETTING, PUSH_MAX_DEVICES, type GcsPushSender } from "./push";
import type { GcsPushRequest } from "./webpush";

let w: GcsTestWorld;
let sent: GcsPushRequest[];
let status: (url: string) => number;
let push: GcsPushService;

const SECRET = "push-test-secret-0123456789abcdef";

beforeEach(async () => {
  w = await createWorld();
  sent = [];
  status = () => 201;
  const sender: GcsPushSender = async (req) => {
    sent.push(req);
    return { status: status(req.url) };
  };
  push = new GcsPushService({ db: w.db, sender, secret: SECRET });
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

function subscription(n: number) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { endpoint: `https://fcm.example.com/send/device-${n}`, p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url"), userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130" };
}

describe("GcsPushService", () => {
  test("cheile VAPID: create o singură dată, privata criptată în bază (nu în clar)", async () => {
    expect(await push.publicKey()).toBeNull();
    expect(await push.ensureKeys()).toBe(true);
    expect(await push.ensureKeys()).toBe(false);
    const row = await w.db.setting.findUniqueOrThrow({ where: { key: PUSH_KEYS_SETTING } });
    const value = row.value as { publicKey: string; privateKey: string };
    expect(Buffer.from(value.publicKey, "base64url")).toHaveLength(65);
    expect(value.privateKey).toMatch(/^v1\./);
    expect(value.privateKey).not.toContain('"d"');
    expect(await new GcsPushService({ db: w.db }).publicKey()).toBe(value.publicKey);
  });

  test("abonarea: validată, același browser = același rând, alt cont preia browserul, cel mult N dispozitive", async () => {
    const u = await w.createUser("Ana", "member");
    const v = await w.createUser("Bogdan", "member");
    const s1 = subscription(1);
    const { id } = await push.subscribe(u.id, s1);
    expect((await push.subscribe(u.id, s1)).id).toBe(id);
    expect(await push.devices(u.id)).toMatchObject([{ id, host: "fcm.example.com", userAgent: s1.userAgent, lastUsedAt: null }]);
    await push.subscribe(v.id, s1);
    expect(await push.devices(u.id)).toEqual([]);
    expect(await push.devices(v.id)).toHaveLength(1);

    await expect(push.subscribe(u.id, { ...subscription(2), endpoint: "https://127.0.0.1/x" })).rejects.toThrow();
    await expect(push.subscribe(u.id, { ...subscription(3), p256dh: "abc" })).rejects.toThrow();
    for (let i = 10; i < 10 + PUSH_MAX_DEVICES + 2; i++) await push.subscribe(u.id, subscription(i));
    expect(await push.devices(u.id)).toHaveLength(PUSH_MAX_DEVICES);

    const [first] = await push.devices(u.id);
    expect(await push.unsubscribe(v.id, { id: first!.id })).toBe(false);
    expect(await push.unsubscribe(u.id, { id: first!.id })).toBe(true);
    expect(await push.devices(u.id)).toHaveLength(PUSH_MAX_DEVICES - 1);
  });

  test("trimiterea: pe toate dispozitivele; 410 șterge abonamentul, alte erori numără eșecurile", async () => {
    await push.ensureKeys();
    const u = await w.createUser("Ana", "member");
    for (const n of [1, 2, 3]) await push.subscribe(u.id, subscription(n));
    status = (url) => (url.endsWith("device-2") ? 410 : url.endsWith("device-3") ? 500 : 201);
    const result = await push.sendToUser(u.id, { title: "Site", body: "Ana ți-a scris", url: "/notifications/1?via=push", tag: "abc" }, { subject: "mailto:admin@example.com", urgency: "high" });
    expect(result).toEqual({ sent: 1, removed: 1 });
    expect(sent).toHaveLength(3);
    expect(sent[0]!.headers).toMatchObject({ urgency: "high", topic: "abc", "content-encoding": "aes128gcm" });
    const rows = await w.db.pushSubscription.findMany({ where: { userId: u.id }, orderBy: { endpoint: "asc" } });
    expect(rows.map((r) => [r.endpoint.slice(-8), r.failures, r.lastUsedAt !== null])).toEqual([
      ["device-1", 0, true],
      ["device-3", 1, false],
    ]);
  });

  test("fără chei sau fără dispozitive nu se trimite nimic; cheile criptate cu alt secret nu se folosesc", async () => {
    const u = await w.createUser("Ana", "member");
    expect(await push.sendToUser(u.id, { title: "x", body: "y", url: "/" }, { subject: "mailto:a@b.ro" })).toEqual({ sent: 0, removed: 0 });
    await push.subscribe(u.id, subscription(1));
    expect(await push.sendToUser(u.id, { title: "x", body: "y", url: "/" }, { subject: "mailto:a@b.ro" })).toEqual({ sent: 0, removed: 0 });
    await push.ensureKeys();
    const other = new GcsPushService({ db: w.db, sender: async () => ({ status: 201 }), secret: "alt-secret-0123456789abcdefghij" });
    expect(await other.sendToUser(u.id, { title: "x", body: "y", url: "/" }, { subject: "mailto:a@b.ro" })).toEqual({ sent: 0, removed: 0 });
    expect(sent).toHaveLength(0);
  });
});
