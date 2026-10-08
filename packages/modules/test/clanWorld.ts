import { GcsAppService, GcsNotificationService, type GcsActor, type GcsEvent } from "@gcs/core";
import type { GcsPlayerStatsAggregate } from "../src/servers/playerStats";
import { GcsClanAdmin } from "../src/clans/admin";
import type { GcsClanGameStatsSource } from "../src/clans/gameStats";
import { registerClanNotifications } from "../src/clans/notify";
import { GcsClanQueries } from "../src/clans/queries";
import { CLAN_BANNER, CLAN_LOGO, GcsClanService, type GcsClanInput } from "../src/clans/service";
import { createForumWorld } from "./world";

/** Un document de editor cu un paragraf (descrierea clanului). */
export const clanDoc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

/**
 * Un site de test cu aplicația Clanuri: lumea forumului (forumuri, Root Admin, membru, vizitator), serviciul, citirile,
 * ACP-ul, notificările (cu țintele și ascultătorii reali) și evenimentele clanurilor colectate.
 */
export async function createClanWorld() {
  const w = await createForumWorld();
  const apps = new GcsAppService({ db: w.db, cache: w.cache, bus: w.bus, registry: w.registry, acp: w.acp });
  // Statisticile de joc „ale aplicației Servere”, controlate de test: pornite / oprite și datele pe membru.
  const gameStats = { on: false, data: new Map<string, GcsPlayerStatsAggregate>() };
  const gameSource: GcsClanGameStatsSource = {
    enabled: async () => gameStats.on,
    forUsers: async (ids) => new Map(ids.flatMap((id) => (gameStats.data.has(id) ? [[id, gameStats.data.get(id)!] as const] : []))),
  };
  const clans = new GcsClanService({
    db: w.db,
    cache: w.cache,
    bus: w.bus,
    settings: w.settings,
    permissions: w.permissions,
    acp: w.acp,
    apps,
    actors: w.actors,
    attachments: w.attachments,
    rateLimiter: w.rateLimiter,
    gameStats: gameSource,
  });
  const clanQueries = new GcsClanQueries({ db: w.db, cache: w.cache, permissions: w.permissions, settings: w.settings, apps, clans, gameStats: gameSource });
  const clanAdmin = new GcsClanAdmin({ db: w.db, acp: w.acp, settings: w.settings, permissions: w.permissions, bus: w.bus, registry: w.registry, clans });
  const notifications = new GcsNotificationService({ db: w.db, bus: w.bus, cache: w.cache, registry: w.registry });
  registerClanNotifications({ db: w.db, bus: w.bus, notifications, clanQueries, actors: w.actors });
  w.attachments.registerAccess(CLAN_LOGO, (actor, id) => clanQueries.canSeeClan(actor, Number(id)));
  w.attachments.registerAccess(CLAN_BANNER, (actor, id) => clanQueries.canSeeClan(actor, Number(id)));

  const clanEvents: GcsEvent[] = [];
  for (const name of ["clan.invited", "clan.requested", "clan.membership", "clan.reviewed", "clan.disbanded"]) {
    w.bus.on(name, async (e) => {
      clanEvents.push(e);
    });
  }

  let counter = 0;
  /** Un membru nou în grupul dat (implicit Membru), ca actor. */
  async function user(name: string, group = "member"): Promise<GcsActor> {
    return w.actorFor(await w.createUser(name, group));
  }

  /** Datele valide ale unui clan, cu câmpurile schimbate de `patch`. */
  function input(patch: Partial<GcsClanInput> = {}): GcsClanInput {
    counter++;
    return {
      tag: `T${counter}`,
      name: `Clanul ${counter}`,
      description: clanDoc("Un clan de test."),
      color: "#D62839",
      color2: "#1B1E26",
      links: {},
      joinMode: "REQUEST",
      ...patch,
    };
  }

  /** O setare a clanurilor (ca Root Admin). */
  async function option(key: string, value: unknown): Promise<void> {
    await w.settings.set(key, value, w.root);
  }

  /** Un clan activ (fără aprobare), creat de un VIP nou; întoarce clanul și liderul. */
  async function activeClan(patch: Partial<GcsClanInput> = {}, leaderGroup = "vip_gold") {
    await option("clans.require_approval", false);
    const leader = await user(`Lider${++counter}`, leaderGroup);
    const created = await clans.create(leader, input(patch));
    await option("clans.require_approval", true);
    return { id: created.id, leader };
  }

  /** Categoria în care se creează forumurile clanurilor (setată în opțiuni). */
  async function forumCategory(): Promise<number> {
    const category = await w.forums.create({ parentId: null, type: "CATEGORY", name: "Clanuri" }, w.root);
    await option("clans.forum_parent", category.id);
    return category.id;
  }

  return { ...w, gameStats, apps, clans, clanQueries, clanAdmin, notifications, clanEvents, user, input, option, activeClan, forumCategory };
}

export type GcsClanWorld = Awaited<ReturnType<typeof createClanWorld>>;
