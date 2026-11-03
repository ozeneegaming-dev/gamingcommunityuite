import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createRemovalWorld, type GcsRemovalWorld } from "../../test/removalWorld";
import { GcsWebhookService, WEBHOOK_JOB } from "./webhooks";

let w: GcsRemovalWorld;
let calls: { url: string; init: RequestInit }[];
let status: number;
let enqueued: { name: string; data: Record<string, unknown> }[];
let hooks: GcsWebhookService;

beforeAll(async () => {
  w = await createRemovalWorld();
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  await w.reset();
  calls = [];
  enqueued = [];
  status = 204;
  hooks = new GcsWebhookService({
    db: w.s.db,
    kv: w.s.kv,
    jobs: { enqueue: async (name, data = {}) => void enqueued.push({ name, data }) },
    acp: w.s.acp,
    settings: w.s.settings,
    baseUrl: async () => "https://site.test",
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status });
    }) as unknown as typeof fetch,
    // Rezolvarea DNS a testului: „intern.local” e o adresă privată.
    resolveUrl: async (raw) => {
      const url = new URL(raw);
      if (url.hostname === "intern.local") throw Object.assign(new Error("x"), { name: "GcsValidationError" });
      return url;
    },
  });
});

describe("webhook-urile", () => {
  test("JSON semnat: corpul, antetele și semnătura HMAC; jurnalul livrărilor", async () => {
    const root = await w.user("RootHook", "root_admin");
    const { id } = await hooks.save(root, null, { name: "Serverul meu", url: "https://hooks.example.com/gcs", format: "json", events: ["topic.created", "necunoscut"], enabled: true });
    const row = await w.s.db.webhookEndpoint.findUniqueOrThrow({ where: { id } });
    expect(row.events).toEqual(["topic.created"]);

    const d = await hooks.deliver(id, "topic.created", { topicId: 7 }, Date.parse("2026-11-03T10:00:00Z"));
    expect(d).toMatchObject({ event: "topic.created", status: 204 });
    const sent = calls[0]!;
    const body = String(sent.init.body);
    expect(JSON.parse(body)).toMatchObject({ event: "topic.created", at: "2026-11-03T10:00:00.000Z", data: { topicId: 7 }, site: { url: "https://site.test" } });
    const headers = sent.init.headers as Record<string, string>;
    expect(headers["X-GCS-Event"]).toBe("topic.created");
    expect(headers["X-GCS-Signature"]).toBe(`sha256=${createHmac("sha256", row.secret).update(body).digest("hex")}`);
    expect(sent.init.redirect).toBe("manual");

    status = 500;
    await expect(hooks.deliver(id, "topic.created", { topicId: 8 }, Date.now())).rejects.toThrow("HTTP 500");
    const log = await hooks.log(id);
    expect(log.map((x) => [x.status, x.error ?? null])).toEqual([
      [500, "HTTP 500"],
      [204, null],
    ]);
  });

  test("Discord: mesajul cu titlul topicului și linkul; doar adrese Discord pentru formatul Discord", async () => {
    const root = await w.user("RootDiscord", "root_admin");
    const forum = await w.forum();
    const t = await w.topic(root, forum, "Turneu de vineri");
    await expect(hooks.save(root, null, { name: "Fals", url: "https://exemplu.ro/hook", format: "discord", events: ["topic.created"], enabled: true })).rejects.toMatchObject({ fields: { url: "invalid_url" } });
    const { id } = await hooks.save(root, null, { name: "Canal Discord", url: "https://discord.com/api/webhooks/1/abc", format: "discord", events: ["topic.created"], enabled: true });
    await hooks.deliver(id, "topic.created", { topicId: t.topicId }, Date.now());
    const msg = JSON.parse(String(calls[0]!.init.body)) as { content: string; allowed_mentions: unknown };
    expect(msg.content).toContain("Topic nou: **Turneu de vineri**");
    expect(msg.content).toContain(`https://site.test/topic/${t.topicId}-`);
    expect(msg.allowed_mentions).toEqual({ parse: [] });
  });

  test("evenimentele pun livrări în coadă doar pentru endpointurile pornite și abonate; rotirea secretului; ștergerea", async () => {
    const root = await w.user("RootQueue", "root_admin");
    const a = await hooks.save(root, null, { name: "Abonat", url: "https://a.example.com", format: "json", events: ["user.registered"], enabled: true });
    await hooks.save(root, null, { name: "Alt eveniment", url: "https://b.example.com", format: "json", events: ["topic.created"], enabled: true });
    await hooks.save(root, null, { name: "Oprit", url: "https://c.example.com", format: "json", events: ["user.registered"], enabled: false });
    hooks.listen(w.s.bus);
    await w.s.bus.emit({ name: "user.registered", payload: { userId: "u1", extra: { nested: true } }, tags: [] });
    await new Promise((r) => setTimeout(r, 50));
    expect(enqueued.filter((e) => e.name === WEBHOOK_JOB).map((e) => [e.data.id, e.data.event, e.data.payload])).toEqual([[a.id, "user.registered", { userId: "u1" }]]);

    const before = (await w.s.db.webhookEndpoint.findUniqueOrThrow({ where: { id: a.id } })).secret;
    await hooks.rotateSecret(root, a.id);
    expect((await w.s.db.webhookEndpoint.findUniqueOrThrow({ where: { id: a.id } })).secret).not.toBe(before);
    await expect(hooks.save(root, null, { name: "Intern", url: "https://intern.local/x", format: "json", events: ["user.registered"], enabled: true })).rejects.toThrow();
    await hooks.remove(root, a.id);
    await expect(hooks.list(await w.user("FaraDreptHook"))).rejects.toThrow();
  });
});
