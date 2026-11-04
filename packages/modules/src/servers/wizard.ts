import { GcsValidationError, type GcsAcpRoleService, type GcsActor } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import type { GcsForumService } from "../forums/forums";
import { FORUMS_ACP_SECTION } from "../forums/forums";
import type { GcsForumSlotService } from "../forums/slots";
import { gameDef } from "./games";
import { normalizeHost } from "./net";
import { SERVERS_FORUM_EXTENSION } from "./forum";
import { MAX_SERVERS } from "./poller";
import { SERVERS_ACP_SECTION, type GcsServerService } from "./service";

/** Subforumurile propuse pentru fiecare server (macheta `ServerWizard`, pasul 3); adminul poate adăuga altele. */
export const WIZARD_SUBFORUMS = ["complaints", "admin_requests", "suggestions", "unban_requests", "guides", "events"] as const;
/** Ce apare live în descrierea forumului (cheile câmpurilor tabului „Server”). */
export const WIZARD_LIVE = ["status", "players", "map", "address", "connect", "top"] as const;

export const WIZARD_LIMITS = { servers: 20, subforums: 10, name: 80, description: 300, subforumName: 60 } as const;

/** Un server din asistent: unul nou (joc, nume, adresă) sau unul existent (doar id-ul). */
export type GcsWizardServer = { existingId: number } | { name: string; game: string; host: string; port: number; queryPort?: number | null; description?: string };

export type GcsWizardInput = {
  name: string;
  description: string;
  servers: GcsWizardServer[];
  /** Numele subforumurilor create sub fiecare forum de server (deja traduse în limba adminului). */
  subforums: string[];
  live: Partial<Record<(typeof WIZARD_LIVE)[number], boolean>>;
};

export type GcsWizardResult = { categoryId: number; forums: { serverId: number; forumId: number; subforumIds: number[] }[] };

const plain = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim() : "");

/**
 * Asistentul „Creează categorie de servere” (macheta `ServerWizard`, aplicația Servere): o categorie, un forum pentru
 * fiecare server (legat prin `GameServer.forumId`, cu tabul „Server” completat), subforumurile alese sub fiecare și
 * serverele noi adăugate în aplicație. Totul se verifică înainte să se creeze ceva (adresele, duplicatele, limita de
 * servere), apoi se creează prin serviciile obișnuite (drepturile, jurnalul, cache-ul).
 */
export class GcsServerWizard {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      acp: GcsAcpRoleService;
      forums: GcsForumService;
      forumSlots: GcsForumSlotService;
      servers: GcsServerService;
    },
  ) {}

  /** Validarea întregului asistent (fără nicio scriere); erorile pe câmpuri, cu indexul serverului (`servers.2.host`). */
  async check(actor: GcsActor, input: GcsWizardInput): Promise<{ name: string; description: string; subforums: string[]; servers: (GcsWizardServer & { resolvedName: string })[] }> {
    const { acp, db, servers } = this.deps;
    await acp.assert(actor, FORUMS_ACP_SECTION, "edit");
    await acp.assert(actor, SERVERS_ACP_SECTION, "edit");
    const errors: Record<string, string> = {};
    const name = plain(input.name);
    if (!name || [...name].length > WIZARD_LIMITS.name) errors.name = "required";
    const description = plain(input.description);
    if ([...description].length > WIZARD_LIMITS.description) errors.description = "too_long";
    const list = Array.isArray(input.servers) ? input.servers : [];
    if (list.length === 0) errors.servers = "required";
    if (list.length > WIZARD_LIMITS.servers) errors.servers = "too_many";
    const subforums = [...new Set((Array.isArray(input.subforums) ? input.subforums : []).map(plain).filter(Boolean))];
    if (subforums.length > WIZARD_LIMITS.subforums) errors.subforums = "too_many";
    if (subforums.some((s) => [...s].length > WIZARD_LIMITS.subforumName)) errors.subforums = "too_long";

    const existing = await db.gameServer.findMany({ select: { id: true, name: true, game: true, host: true, port: true } });
    const seen = new Set<string>();
    const out: (GcsWizardServer & { resolvedName: string })[] = [];
    let added = 0;
    for (const [i, s] of list.entries()) {
      if ("existingId" in s) {
        const row = existing.find((r) => r.id === s.existingId);
        if (!row) errors[`servers.${i}`] = "invalid";
        else if (seen.has(`id:${row.id}`)) errors[`servers.${i}`] = "duplicate_server";
        else out.push({ existingId: row.id, resolvedName: row.name });
        if (row) seen.add(`id:${row.id}`);
        continue;
      }
      added++;
      const fieldErrors = await servers.checkTarget({ game: s.game, host: s.host, port: s.port, queryPort: s.queryPort ?? null });
      for (const [k, v] of Object.entries(fieldErrors)) errors[`servers.${i}.${k}`] = v;
      const serverName = plain(s.name);
      if (!serverName || [...serverName].length > WIZARD_LIMITS.name) errors[`servers.${i}.name`] = "required";
      const host = gameDef(s.game)?.protocol === "discord" ? String(s.host).trim() : (normalizeHost(s.host) ?? String(s.host).trim().toLowerCase());
      const key = `${s.game}|${host}|${s.port}`;
      if (seen.has(key) || existing.some((r) => `${r.game}|${r.host}|${r.port}` === key)) errors[`servers.${i}.host`] = "duplicate_server";
      seen.add(key);
      out.push({ ...s, name: serverName, resolvedName: serverName });
    }
    if (existing.length + added > MAX_SERVERS) errors.servers = "too_many";
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    return { name, description, subforums, servers: out };
  }

  async create(actor: GcsActor, input: GcsWizardInput): Promise<GcsWizardResult> {
    const plan = await this.check(actor, input);
    const { forums, servers, forumSlots } = this.deps;
    const live = Object.fromEntries(WIZARD_LIVE.map((k) => [k, input.live?.[k] !== false]));
    const category = await forums.create({ parentId: null, type: "CATEGORY", name: plan.name, description: plan.description, icon: "fa-solid fa-server" }, actor);
    const result: GcsWizardResult = { categoryId: category.id, forums: [] };
    for (const s of plan.servers) {
      const game = "existingId" in s ? undefined : gameDef(s.game);
      const forum = await forums.create({ parentId: category.id, type: "FORUM", name: s.resolvedName, description: "existingId" in s ? "" : plain(s.description), icon: game?.icon ?? "fa-solid fa-server" }, actor);
      const serverId =
        "existingId" in s
          ? (await servers.linkForum(actor, s.existingId, forum.id), s.existingId)
          : (
              await servers.save(actor, null, {
                game: s.game,
                host: s.host,
                port: s.port,
                queryPort: s.queryPort ?? null,
                name: s.resolvedName,
                description: plain(s.description),
                forumId: forum.id,
                groups: [],
                adminIds: [],
                enabled: true,
              })
            ).id;
      const subforumIds: number[] = [];
      for (const sub of plan.subforums) subforumIds.push((await forums.create({ parentId: forum.id, type: "FORUM", name: sub }, actor)).id);
      await forumSlots.saveTab(actor, { forumId: forum.id, extension: SERVERS_FORUM_EXTENSION, tab: "server", values: { server: "", style: "full", row: true, parent: true, card: true, topic: false, ...live } }, { plugins: false });
      result.forums.push({ serverId, forumId: forum.id, subforumIds });
    }
    return result;
  }
}
