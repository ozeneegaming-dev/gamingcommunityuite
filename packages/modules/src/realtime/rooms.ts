import type { GcsActor, GcsPermissionService } from "@gcs/core";
import type { GcsForumQueries } from "../forums/queries";

/** Verifică dacă actorul poate intra în camera `{tip}:{id}` (id-ul e partea de după primele „:”). */
export type GcsRoomCheck = (actor: GcsActor, id: string) => Promise<boolean>;

const TOPIC_ID = /^[1-9]\d{0,9}$/;

/**
 * Accesul la camerele `gcs-realtime` (specul etapei 4 §5). Camerele fără id: `presence` (toți), `acp` (`acp.access`).
 * Modulele își adaugă tipurile de cameră cu `register` (ex. chat-ul: `chat:{cheie}`).
 */
export class GcsRealtimeRooms {
  private readonly checks = new Map<string, GcsRoomCheck>();

  constructor(private readonly deps: { permissions: GcsPermissionService; forumQueries: GcsForumQueries }) {
    this.register("user", async (actor, id) => actor.userId !== null && actor.userId === id);
    this.register("topic", async (actor, id) => TOPIC_ID.test(id) && (await deps.forumQueries.topicAccess(actor, Number(id))).canRead);
    this.register("presence", async () => true);
    this.register("acp", async (actor) => actor.userId !== null && (await deps.permissions.can(actor, "acp.access")));
  }

  /** Doar cine poate răspunde în topic trimite „scrie…”. */
  async canType(actor: GcsActor, topicId: number): Promise<boolean> {
    return actor.userId !== null && !actor.isBanned && (await this.deps.forumQueries.topicAccess(actor, topicId)).canReply;
  }

  register(type: string, check: GcsRoomCheck): void {
    this.checks.set(type, check);
  }

  async canJoin(actor: GcsActor, room: string): Promise<boolean> {
    if (typeof room !== "string" || room.length > 100 || actor.isBanned) return false;
    const sep = room.indexOf(":");
    const [type, id] = sep === -1 ? [room, ""] : [room.slice(0, sep), room.slice(sep + 1)];
    const check = this.checks.get(type);
    if (!check) return false;
    // Camerele cu id cer un id; cele fără id (presence, acp) nu acceptă unul.
    if ((type === "presence" || type === "acp") !== (sep === -1)) return false;
    if (sep !== -1 && id === "") return false;
    return check(actor, id);
  }
}
