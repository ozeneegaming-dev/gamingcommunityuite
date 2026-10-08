import path from "node:path";
import type { GcsFetchedFile, GcsRealtime, GcsRealtimeMessage } from "@gcs/core";
import { GcsMockServer, type MockRequest, type MockResponse } from "../../../servers-plugins/mock/gcs-mock-server.mjs";
import { GcsBridge } from "../src/servers/bridge";
import type { GcsBridgeHttpResponse } from "../src/servers/bridge/api";
import { MAP_IMAGE, SANCTION_EVIDENCE } from "../src/servers/bridge/config";
import { parseAllowNets } from "../src/servers/net";
import { createServerWorld } from "./serverWorld";

/** IP-ul „serverului de joc” din teste (protocolul nu verifică IP-ul, doar limita eșecurilor pe IP). */
export const GAME_SERVER_IP = "198.51.100.200";

/**
 * Un site de test cu puntea serverelor de joc: lumea Serverelor (ceasul controlabil, serviciile), puntea legată de
 * aceleași servicii, publicările live colectate, descărcarea falsă a imaginilor hărților și serverul de joc fals (§18),
 * al cărui transport apelează direct `bridge.api.handle`.
 */
export async function createBridgeWorld() {
  const w = await createServerWorld();
  const live: GcsRealtimeMessage[] = [];
  const realtime = {
    publish: async (room: string, event: string, data: unknown) => {
      live.push({ room, event, data });
    },
  } as unknown as GcsRealtime;
  /** Răspunsurile descărcării imaginilor hărților, pe adresă (lipsă = eroare de rețea). */
  const remote = new Map<string, GcsFetchedFile | Error>();
  const fetched: string[] = [];
  /** Adresa site-ului și folderul release-ului pluginurilor (schimbabile în teste). */
  const site = { url: "https://comunitate.gcs.test", releaseDir: path.resolve(__dirname, "../../../servers-plugins/release") };
  const bridge = new GcsBridge({
    db: w.db,
    redis: w.redis,
    bus: w.bus,
    settings: w.settings,
    permissions: w.permissions,
    acp: w.acp,
    apps: w.apps,
    attachments: w.attachments,
    rateLimiter: w.rateLimiter,
    realtime,
    render: (content) => w.posting.render(content),
    canViewServer: (actor, id) => w.serverQueries.canView(actor, id),
    visibleServers: (actor) => w.serverQueries.visibleIds(actor),
    // Interogarea falsă a lumii (răspunsurile pe `host:port`) și excepția 127.0.0.1, ca la poller.
    query: w.query,
    allow: () => parseAllowNets("127.0.0.1/32"),
    createServer: (actor, input) => w.servers.save(actor, null, { ...input, queryPort: null, description: "", forumId: null, groups: [], adminIds: [], enabled: true }),
    siteUrl: async () => site.url,
    pluginReleaseDir: () => site.releaseDir,
    now: () => w.clock.now,
    fetchMapImage: async (url) => {
      fetched.push(url);
      const answer = remote.get(url);
      if (!answer) throw new Error("network");
      if (answer instanceof Error) throw answer;
      return answer;
    },
  });
  bridge.listen(w.bus);
  w.servers.playerStats.use(bridge.stats);
  w.attachments.registerAccess(MAP_IMAGE, async () => true);
  w.attachments.registerAccess(SANCTION_EVIDENCE, (actor, id) => bridge.sanctions.canView(actor, Number(id)));

  /** Transportul serverului fals: cererea ajunge direct la API (fără HTTP). */
  async function transport(req: MockRequest): Promise<MockResponse> {
    const lower = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v]));
    const res: GcsBridgeHttpResponse = await bridge.api.handle({ method: req.method, path: req.path, header: (name) => lower[name.toLowerCase()] ?? null, body: req.body, ip: GAME_SERVER_IP });
    return { status: res.status, headers: res.headers, body: res.body };
  }

  /** Un server de joc cu punte (CS2 implicit), cu o cheie API; întoarce id-ul și cheia (o singură dată, ca în ACP). */
  async function bridgeServer(opts: { game?: "cs2" | "cs16"; identityMode?: "steam" | "mixed"; nameIds?: boolean; isMix?: boolean } = {}) {
    const { id } = await w.addServer({ game: opts.game ?? "cs2" });
    await bridge.saveConfig(w.root, id, { identityMode: opts.identityMode ?? "mixed", nameIds: opts.nameIds ?? false, isMix: opts.isMix ?? false });
    const key = await bridge.keys.create(w.root, id, { label: "test" });
    return { id, token: key.token, keyRowId: key.id, keyId: key.keyId };
  }

  /** Serverul de joc fals, pe ceasul lumii; fără cheie (`null`) se înrolează (specul plugin-v2 §5). */
  function mock(token: string | null, game: "cs2" | "cs16" = "cs2", runId?: string) {
    return new GcsMockServer({ ...(token ? { token } : {}), transport, game, clock: () => w.clock.now, ...(runId ? { runId } : {}) });
  }

  return { ...w, bridge, live, remote, fetched, transport, bridgeServer, mock, site };
}

export type GcsBridgeWorld = Awaited<ReturnType<typeof createBridgeWorld>>;
