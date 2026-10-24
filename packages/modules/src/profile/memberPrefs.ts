import { GcsForbidden, GcsValidationError, type GcsActor, type GcsEventBus } from "@gcs/core";
import { type PrismaClient, sql, sqlJsonMerge } from "@gcs/db";

/**
 * Preferințele contului din setările v2 (salvate în `users.prefs`, lângă `sound` / `toasts` / `theme`):
 * - `topicOpen`: unde se deschide un topic din liste (primul necitit, început — implicit, ca până acum —, ultima postare);
 * - `showSignatures`: arată semnăturile celorlalți sub postări;
 * - `newDeviceEmail`: email la intrarea de pe un dispozitiv nou;
 * - `steamTab` / `faceitTab`: tabul Steam / FACEIT pe profilul public (doar dacă e legat contul);
 * - `showVisitors`: caseta „Vizitatori recenți” pe profil; `recordVisits`: vizitele mele apar la ceilalți.
 */
export type GcsTopicOpen = "unread" | "start" | "last";
export type GcsMemberPrefs = {
  topicOpen: GcsTopicOpen;
  showSignatures: boolean;
  newDeviceEmail: boolean;
  steamTab: boolean;
  faceitTab: boolean;
  showVisitors: boolean;
  recordVisits: boolean;
};

export const DEFAULT_MEMBER_PREFS: GcsMemberPrefs = {
  topicOpen: "start",
  showSignatures: true,
  newDeviceEmail: true,
  steamTab: true,
  faceitTab: true,
  showVisitors: true,
  recordVisits: true,
};

const TOPIC_OPEN: GcsTopicOpen[] = ["unread", "start", "last"];
const BOOLEANS = ["showSignatures", "newDeviceEmail", "steamTab", "faceitTab", "showVisitors", "recordVisits"] as const;

/** Preferințele salvate, completate cu cele implicite (o valoare necunoscută revine la implicit). */
export function normalizeMemberPrefs(raw: unknown): GcsMemberPrefs {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: GcsMemberPrefs = { ...DEFAULT_MEMBER_PREFS };
  if (TOPIC_OPEN.includes(r.topicOpen as GcsTopicOpen)) out.topicOpen = r.topicOpen as GcsTopicOpen;
  for (const k of BOOLEANS) if (typeof r[k] === "boolean") out[k] = r[k] as boolean;
  return out;
}

/** Citirea și scrierea preferințelor (doar câmpurile trimise; restul cheilor din `prefs` rămân). */
export class GcsMemberPrefsService {
  constructor(private readonly deps: { db: PrismaClient; bus: GcsEventBus }) {}

  async get(userId: string): Promise<GcsMemberPrefs> {
    const row = await this.deps.db.user.findUnique({ where: { id: userId }, select: { prefs: true } });
    return normalizeMemberPrefs(row?.prefs);
  }

  async set(actor: GcsActor, patch: Partial<GcsMemberPrefs>): Promise<GcsMemberPrefs> {
    if (!actor.userId) throw new GcsForbidden({ reason: "guest" });
    const clean: Record<string, unknown> = {};
    if (patch.topicOpen !== undefined) {
      if (!TOPIC_OPEN.includes(patch.topicOpen)) throw new GcsValidationError({ topicOpen: "invalid_choice" });
      clean.topicOpen = patch.topicOpen;
    }
    for (const k of BOOLEANS) {
      if (patch[k] === undefined) continue;
      if (typeof patch[k] !== "boolean") throw new GcsValidationError({ [k]: "invalid" });
      clean[k] = patch[k];
    }
    if (Object.keys(clean).length > 0) {
      await this.deps.db.$executeRaw(sql`UPDATE users SET prefs = ${sqlJsonMerge("prefs", clean)} WHERE id = ${actor.userId}`);
      await this.deps.bus.emit({ name: "profile.updated", payload: { userId: actor.userId, what: "prefs" }, tags: [`user:${actor.userId}`] });
    }
    return this.get(actor.userId);
  }
}
