import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRealtimeClient, type GcsRealtimeEnv, type GcsRealtimeState } from "./transports";

type Call = { url: string; init?: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Un `fetch` fals: tokenul cu transporturile date și răspunsurile la polling, în ordine. */
function fakeFetch(opts: { transports: string[]; polls?: unknown[] }) {
  const calls: Call[] = [];
  const polls = [...(opts.polls ?? [])];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, ...(init ? { init } : {}) });
    if (url.startsWith("/api/realtime/token")) return jsonResponse({ token: "t", url: "", transports: opts.transports, pollMs: 2000 });
    if (url.startsWith("/api/realtime/poll")) {
      const next = polls.shift();
      if (next === undefined) return jsonResponse({ cursor: "9", rooms: [], events: [], reset: false });
      if (next === "fail") throw new Error("offline");
      return jsonResponse(next);
    }
    if (url.startsWith("/api/realtime/send")) return new Response(null, { status: 204 });
    return new Response(null, { status: 404 });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

/** Un `EventSource` fals, controlat din test. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  close() {
    this.closed = true;
  }

  fire(type: string, data: unknown, lastEventId = "") {
    const e = { data: JSON.stringify(data), lastEventId } as MessageEvent;
    if (type === "message") this.onmessage?.(e);
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
}

function envWith(fetchFn: typeof fetch, extra: Partial<GcsRealtimeEnv> = {}): Partial<GcsRealtimeEnv> {
  return {
    fetch: fetchFn,
    EventSource: undefined,
    io: async () => {
      throw new Error("fără socket.io în teste");
    },
    forced: () => null,
    ...extra,
  };
}

const flush = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("transporturile live ale clientului", () => {
  test("polling: pornește de la cursorul serverului, primește mesajele camerelor, confirmă intrarea", async () => {
    const { fetch, calls } = fakeFetch({
      transports: ["poll"],
      polls: [
        { cursor: "5", rooms: [], events: [], reset: false },
        { cursor: "6", rooms: ["topic:1"], events: [], reset: false },
        { cursor: "7", rooms: ["topic:1"], events: [{ event: "post:new", data: { id: 3 } }], reset: false },
      ],
    });
    const events: [string, unknown][] = [];
    const states: GcsRealtimeState[] = [];
    const rooms: string[] = [];
    const client = createRealtimeClient({ rooms: () => rooms, dispatch: (e, d) => void events.push([e, d]), onState: (s) => void states.push(s), env: envWith(fetch) });
    await flush();
    expect(states.at(-1)).toEqual({ connected: true, transport: "poll" });
    rooms.push("topic:1");
    const joined = client.join("topic:1");
    await flush();
    await expect(joined).resolves.toBe(true);
    const joinCall = calls.filter((c) => c.url.startsWith("/api/realtime/poll"))[1]!;
    expect(joinCall.url).toContain("since=5");
    expect(joinCall.url).toContain("join=1");
    expect(joinCall.url).toContain("rooms=topic%3A1");
    await flush(2000);
    expect(events).toEqual([["post:new", { id: 3 }]]);
    client.close();
  });

  test("polling: după o pană reia de la cursor (`resync` doar dacă serverul a pierdut mesaje); mesajele clientului merg prin /send", async () => {
    const { fetch, calls } = fakeFetch({
      transports: ["poll"],
      polls: [{ cursor: "1", rooms: [], events: [], reset: false }, "fail", { cursor: "4", rooms: [], events: [{ event: "pm", data: 1 }], reset: false }, { cursor: "9", rooms: [], events: [], reset: true }],
    });
    const events: string[] = [];
    const states: GcsRealtimeState[] = [];
    const client = createRealtimeClient({ rooms: () => [], dispatch: (e) => void events.push(e), onState: (s) => void states.push(s), env: envWith(fetch) });
    await flush();
    await flush(2000);
    expect(states.at(-1)).toEqual({ connected: false, transport: "poll" });
    await flush(6000);
    expect(states.at(-1)).toEqual({ connected: true, transport: "poll" });
    expect(calls.filter((c) => c.url.startsWith("/api/realtime/poll")).at(-1)!.url).toContain("since=1");
    expect(events).toEqual(["pm"]);
    await flush(2000);
    expect(events).toEqual(["pm", "resync"]);
    client.emit("typing", 42);
    await flush();
    const send = calls.find((c) => c.url === "/api/realtime/send")!;
    expect(JSON.parse(String(send.init!.body))).toMatchObject({ event: "typing", data: 42 });
    client.close();
  });

  test("ordinea de rezervă: websocket nu pornește, SSE lipsește → polling", async () => {
    const { fetch } = fakeFetch({ transports: ["websocket", "sse", "poll"] });
    const states: GcsRealtimeState[] = [];
    const client = createRealtimeClient({ rooms: () => [], dispatch: () => {}, onState: (s) => void states.push(s), env: envWith(fetch) });
    await flush();
    expect(states.at(-1)).toEqual({ connected: true, transport: "poll" });
    client.close();
  });

  test("SSE: `hello` conectează și confirmă camerele; mesajele ajung; după o eroare se redeschide de la cursor", async () => {
    const { fetch } = fakeFetch({ transports: ["sse", "poll"] });
    const events: [string, unknown][] = [];
    const states: GcsRealtimeState[] = [];
    const rooms = ["chat:general"];
    const client = createRealtimeClient({
      rooms: () => rooms,
      dispatch: (e, d) => void events.push([e, d]),
      onState: (s) => void states.push(s),
      env: envWith(fetch, { EventSource: FakeEventSource as unknown as typeof EventSource }),
    });
    await flush();
    const first = FakeEventSource.instances[0]!;
    expect(first.url).toContain("rooms=chat%3Ageneral");
    first.fire("hello", { cursor: "10", rooms: ["chat:general"] });
    expect(states.at(-1)).toEqual({ connected: true, transport: "sse" });
    first.fire("message", { event: "message", data: { body: "salut" } }, "11");
    expect(events).toEqual([["message", { body: "salut" }]]);

    first.onerror!();
    expect(states.at(-1)).toEqual({ connected: false, transport: "sse" });
    await flush(1000);
    const second = FakeEventSource.instances[1]!;
    expect(second.url).toContain("since=11");
    second.fire("hello", { cursor: "11", rooms: ["chat:general"] });
    // Reluarea de la cursor nu cere reîncărcarea componentelor; `resync` vine doar de la server.
    expect(events.map((e) => e[0])).toEqual(["message"]);
    second.fire("resync", {});
    expect(events.map((e) => e[0])).toEqual(["message", "resync"]);

    // O cameră nouă redeschide fluxul o singură dată, iar `join` primește răspunsul din `hello`.
    rooms.push("topic:2");
    const joined = client.join("topic:2");
    await flush(60);
    const third = FakeEventSource.instances[2]!;
    expect(third.url).toContain("topic%3A2");
    third.fire("hello", { cursor: "11", rooms: ["chat:general"] });
    await expect(joined).resolves.toBe(false);
    client.close();
    expect(third.closed).toBe(true);
  });

  test("SSE care nu răspunde în 8 s → polling", async () => {
    const { fetch } = fakeFetch({ transports: ["sse", "poll"] });
    const states: GcsRealtimeState[] = [];
    const client = createRealtimeClient({
      rooms: () => [],
      dispatch: () => {},
      onState: (s) => void states.push(s),
      env: envWith(fetch, { EventSource: FakeEventSource as unknown as typeof EventSource }),
    });
    await flush(8000);
    await flush();
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
    expect(states.at(-1)).toEqual({ connected: true, transport: "poll" });
    client.close();
  });
});
