import Redis from "ioredis";
import { SignJWT } from "jose";
import { afterAll, describe, expect, test } from "vitest";
import { inject } from "vitest";
import { testRedis } from "../../test/redis";
import { GcsRedisRealtimeLog, type GcsRealtimeLog } from "./log";
import { GcsRealtime, parseRealtimeMessage, REALTIME_CHANNEL } from "./publish";
import { signRealtimeToken, verifyRealtimeToken } from "./token";

const SECRET = "s".repeat(32);
let sub: Redis | undefined;

afterAll(() => {
  sub?.disconnect();
  testRedis().disconnect();
});

describe("tokenul realtime", () => {
  test("un token semnat se verifică, pentru membru și pentru vizitator", async () => {
    const member = await signRealtimeToken({ userId: "u1", guestId: "g1" }, SECRET);
    expect(await verifyRealtimeToken(member, SECRET)).toEqual({ userId: "u1", guestId: "g1" });
    const guest = await signRealtimeToken({ userId: null, guestId: "g2" }, SECRET);
    expect(await verifyRealtimeToken(guest, SECRET)).toEqual({ userId: null, guestId: "g2" });
  });

  test("expirat, falsificat sau cu altă audiență → refuzat", async () => {
    const now = Date.now();
    const token = await signRealtimeToken({ userId: "u1", guestId: "g1" }, SECRET, 300, now);
    expect(await verifyRealtimeToken(token, SECRET, now + 301_000)).toBeNull();
    expect(await verifyRealtimeToken(token, "x".repeat(32), now)).toBeNull();
    expect(await verifyRealtimeToken(`${token.slice(0, -2)}xx`, SECRET, now)).toBeNull();
    expect(await verifyRealtimeToken("nu-e-jwt", SECRET, now)).toBeNull();

    const other = await new SignJWT({ gid: "g1" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u1")
      .setAudience("altceva")
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(`gcs-realtime:${SECRET}`));
    expect(await verifyRealtimeToken(other, SECRET)).toBeNull();
  });
});

describe("GcsRealtime.publish", () => {
  test("mesajul ajunge la un abonat al canalului gcs:rt", async () => {
    sub = new Redis(inject("redisUrl"), { db: Number(process.env.VITEST_POOL_ID ?? "1") });
    await sub.subscribe(REALTIME_CHANNEL);
    const received = new Promise<string>((resolve) => sub!.on("message", (_ch, msg) => resolve(msg)));
    await new GcsRealtime(new GcsRedisRealtimeLog(testRedis())).publish("topic:5", "post:new", { id: 9 });
    expect(parseRealtimeMessage(await received)).toEqual({ room: "topic:5", event: "post:new", data: { id: 9 } });
  });

  test("o eroare Redis e înghițită", async () => {
    const broken = { append: async () => Promise.reject(new Error("down")) } as unknown as GcsRealtimeLog;
    await expect(new GcsRealtime(broken).publish("x", "y", null)).resolves.toBeUndefined();
  });

  test("parseRealtimeMessage refuză mesajele fără formă", () => {
    expect(parseRealtimeMessage("{")).toBeNull();
    expect(parseRealtimeMessage(JSON.stringify({ room: 1 }))).toBeNull();
  });
});
