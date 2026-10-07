import { GcsAppService, type GcsRealtime, type GcsRealtimeMessage } from "@gcs/core";
import { parseAllowNets } from "../src/servers/net";
import { GcsServerPoller, type GcsServerQueryFn } from "../src/servers/poller";
import { GcsServerQueries } from "../src/servers/queries";
import type { GcsServerTarget } from "../src/servers/query";
import { GcsServerService, SERVER_BANNER, type GcsServerInput } from "../src/servers/service";
import { GcsServerStatusStore } from "../src/servers/store";
import type { GcsServerStatus } from "../src/servers/types";
import { createForumWorld } from "./world";

/** Un status online, de completat în teste. */
export function onlineStatus(patch: Partial<GcsServerStatus> = {}): GcsServerStatus {
  return { online: true, name: "GCS", map: "de_dust2", players: 10, maxPlayers: 32, bots: 0, ping: 20, version: "1.0", playerList: [], updatedAt: new Date().toISOString(), error: null, ...patch };
}

export function offlineStatus(): GcsServerStatus {
  return { online: false, name: null, map: null, players: 0, maxPlayers: 0, bots: 0, ping: null, version: null, playerList: null, updatedAt: new Date().toISOString(), error: "timeout" };
}

/**
 * Un site de test cu aplicația Servere: lumea forumului (forumuri, Root Admin, membru, vizitator), statusul în Redis,
 * un ceas controlabil, interogarea falsă (răspunsurile se dau pe `host:port`) și publicările live colectate.
 */
export async function createServerWorld() {
  const w = await createForumWorld();
  const clock = { now: Date.now() };
  const now = () => clock.now;
  const apps = new GcsAppService({ db: w.db, cache: w.cache, bus: w.bus, registry: w.registry, acp: w.acp });
  const store = new GcsServerStatusStore(w.redis);
  const published: GcsRealtimeMessage[] = [];
  const realtime = {
    publish: async (room: string, event: string, data: unknown) => {
      published.push({ room, event, data });
    },
  } as unknown as GcsRealtime;
  const answers = new Map<string, GcsServerStatus>();
  const calls: GcsServerTarget[] = [];
  const query: GcsServerQueryFn = async (target) => {
    calls.push(target);
    const answer = answers.get(`${target.host}:${target.queryPort ?? target.port}`);
    return answer ? { ...answer, updatedAt: new Date(clock.now).toISOString() } : { ...offlineStatus(), updatedAt: new Date(clock.now).toISOString() };
  };
  const allow = () => parseAllowNets("127.0.0.1/32");
  const servers = new GcsServerService({ db: w.db, bus: w.bus, acp: w.acp, attachments: w.attachments, rateLimiter: w.rateLimiter, store, query, allow });
  const serverQueries = new GcsServerQueries({ db: w.db, cache: w.cache, permissions: w.permissions, settings: w.settings, apps, store, now });
  const poller = new GcsServerPoller({ db: w.db, store, realtime, cache: w.cache, settings: w.settings, apps, query, now, allow });
  w.attachments.registerAccess(SERVER_BANNER, (actor, id) => serverQueries.canView(actor, Number(id)));

  let counter = 0;
  /** Un server valid (Root Admin), cu câmpurile schimbate de `patch`. */
  async function addServer(patch: Partial<GcsServerInput> = {}) {
    counter++;
    const input: GcsServerInput = {
      game: "cs2",
      host: "play.gcs-servere.ro",
      port: 27000 + counter,
      queryPort: null,
      name: `Server ${counter}`,
      description: "",
      forumId: null,
      groups: [],
      adminIds: [],
      enabled: true,
      ...patch,
    };
    return servers.save(w.root, null, input);
  }

  return { ...w, clock, apps, store, published, answers, calls, query, servers, serverQueries, poller, addServer };
}

export type GcsServerWorld = Awaited<ReturnType<typeof createServerWorld>>;
