import { GcsAppService, GcsContentRatingService, GcsNotificationService, type GcsActor } from "@gcs/core";
import { GcsContentSources } from "../src/community/contentSources";
import { GcsPagesAccess } from "../src/pages/access";
import { GcsPagesAdmin } from "../src/pages/admin";
import { registerPagesNotifications } from "../src/pages/notify";
import { GcsPagesQueries } from "../src/pages/queries";
import { GcsPagesRecords } from "../src/pages/records";
import { PAGES_MEDIA_TYPE, PAGES_RECORD_TYPE, PAGES_SOURCE } from "../src/pages/shared";
import { registerPagesRatings } from "../src/pages/wiring";
import { createForumWorld } from "./world";

/** Un document de editor cu un paragraf. */
export const pageDoc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

/** Traducerea de test a șabloanelor: întoarce cheia (ușor de verificat). */
export const presetT = (key: string) => (key === "name" ? "Ghiduri" : key === "record" ? "Ghid" : key.startsWith("fields.") && key.endsWith(".label") ? key.split(".")[1]! : key.includes(".options.") ? `opt${key.split(".").pop()}` : key);

/**
 * Un site de test cu aplicația Pagini: lumea forumului, accesul, citirile, ACP-ul, înregistrările, notele, notificările
 * (cu țintele reale) și sursa de conținut.
 */
export async function createPagesWorld() {
  const w = await createForumWorld();
  const apps = new GcsAppService({ db: w.db, cache: w.cache, bus: w.bus, registry: w.registry, acp: w.acp, permissions: w.permissions, settings: w.settings });
  const ratings = new GcsContentRatingService({ db: w.db, bus: w.bus });
  const access = new GcsPagesAccess({ db: w.db, cache: w.cache, permissions: w.permissions, acp: w.acp });
  const queries = new GcsPagesQueries({ db: w.db, settings: w.settings, access, ratings });
  const admin = new GcsPagesAdmin({ db: w.db, acp: w.acp, bus: w.bus, registry: w.registry, settings: w.settings, attachments: w.attachments, render: (c, actor) => w.posting.render(c, { actor, blocks: true }) });
  const records = new GcsPagesRecords({
    db: w.db,
    bus: w.bus,
    settings: w.settings,
    attachments: w.attachments,
    rateLimiter: w.rateLimiter,
    access,
    render: (c, actor) => w.posting.render(c, { actor, blocks: true }),
    renderComment: (c, actor) => w.posting.render(c, { actor }),
    checkWrite: async () => {},
  });
  const notifications = new GcsNotificationService({ db: w.db, bus: w.bus, cache: w.cache, registry: w.registry });
  registerPagesNotifications({ db: w.db, bus: w.bus, notifications, settings: w.settings, access, queries, actors: w.actors });
  registerPagesRatings(ratings, { db: w.db, access, queries });
  w.attachments.registerAccess(PAGES_MEDIA_TYPE, async () => true);
  w.attachments.registerAccess(PAGES_RECORD_TYPE, (actor, id) => queries.canViewRecord(actor, Number(id)));
  const sources = new GcsContentSources({ registry: w.registry, apps });
  sources.register(PAGES_SOURCE, { search: (a, i) => queries.search(a, i), stream: (v, q) => queries.stream(v, q) });
  await w.settings.set("pages.submit_cooldown", 0, w.root);

  async function user(name: string, group = "member"): Promise<GcsActor> {
    return w.actorFor(await w.createUser(name, group));
  }

  /** Baza „Ghiduri” din șablon, cu pagina ei (trimiterile cu aprobare pornite). */
  async function guides() {
    return admin.createFromPreset(w.root, "guides", presetT);
  }

  return { ...w, apps, ratings, access, queries, admin, records, notifications, sources, user, guides };
}

export type GcsPagesWorld = Awaited<ReturnType<typeof createPagesWorld>>;
