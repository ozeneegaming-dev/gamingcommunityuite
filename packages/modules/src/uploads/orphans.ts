import type { GcsAttachmentService, GcsSettingsService } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { UPLOAD_SETTINGS } from "./settings";

/** Jobul zilnic al fișierelor orfane (worker-ul VPS sau coada SQL a ediției Lite). */
export const ORPHANS_JOB = "uploads.orphans";
/** Câte fișiere se verifică și se șterg dintr-o dată; o rulare trece prin cel mult `ORPHANS_MAX_PER_RUN`. */
export const ORPHANS_BATCH = 200;
export const ORPHANS_MAX_PER_RUN = 5000;
const DAY_MS = 86_400_000;

export type GcsOrphanResult = { deleted: number; kept: number; bytes: number; skipped?: "disabled" | "import_running" };

/**
 * Curățarea fișierelor orfane (ACP → Setări → Încărcări și imagini, `uploads.orphan_days`): un fișier încărcat (ex. în
 * editor) și nelegat de niciun conținut de mai mult de N zile se șterge, pe loturi. Un fișier nelegat îl vede doar cel
 * care l-a încărcat, deci ștergerea nu strică nicio pagină publică. Pentru siguranță rămân și fișierele la care trimite
 * direct un rând (imaginea unui rang, badge, ramă, emoticon, banner de server, logo de clan, hartă, cover) sau o setare
 * (ex. imaginea de distribuire `/files/<id>`), iar cât timp un import din altă platformă e în lucru nu se șterge nimic.
 */
export class GcsOrphanFilesService {
  constructor(private readonly deps: { db: PrismaClient; settings: Pick<GcsSettingsService, "get">; attachments: Pick<GcsAttachmentService, "unattachedBefore" | "discard"> }) {}

  private async days(): Promise<number> {
    const v = await this.deps.settings.get<number>(UPLOAD_SETTINGS.orphanDays).catch(() => 0);
    return Number.isInteger(v) && v > 0 ? v : 0;
  }

  /** Id-urile din lot la care trimite ceva direct (coloanele de atașament ale modulelor). */
  private async referenced(ids: string[]): Promise<Set<string>> {
    const { db } = this.deps;
    const inIds = { in: ids };
    const lists = await Promise.all([
      db.user.findMany({ where: { coverAttachmentId: inIds }, select: { coverAttachmentId: true } }).then((r) => r.map((x) => x.coverAttachmentId)),
      db.rank.findMany({ where: { imageAttachmentId: inIds }, select: { imageAttachmentId: true } }).then((r) => r.map((x) => x.imageAttachmentId)),
      db.badge.findMany({ where: { imageAttachmentId: inIds }, select: { imageAttachmentId: true } }).then((r) => r.map((x) => x.imageAttachmentId)),
      db.avatarFrame.findMany({ where: { imageAttachmentId: inIds }, select: { imageAttachmentId: true } }).then((r) => r.map((x) => x.imageAttachmentId)),
      db.chatEmote.findMany({ where: { attachmentId: inIds }, select: { attachmentId: true } }).then((r) => r.map((x) => x.attachmentId)),
      db.gameServer.findMany({ where: { bannerId: inIds }, select: { bannerId: true } }).then((r) => r.map((x) => x.bannerId)),
      db.clan.findMany({ where: { OR: [{ logoId: inIds }, { bannerId: inIds }] }, select: { logoId: true, bannerId: true } }).then((r) => r.flatMap((x) => [x.logoId, x.bannerId])),
      db.gameMap.findMany({ where: { imageId: inIds }, select: { imageId: true } }).then((r) => r.map((x) => x.imageId)),
    ]);
    return new Set(lists.flat().filter((v): v is string => typeof v === "string"));
  }

  /** Fișierele (`/files/<id>`) la care trimit setările site-ului, citite o dată pe rulare. */
  private async inSettings(): Promise<Set<string>> {
    const rows = await this.deps.db.setting.findMany({ select: { value: true } });
    const text = rows.map((r) => JSON.stringify(r.value)).join("\n");
    return new Set([...text.matchAll(/\/files\/([A-Za-z0-9_-]{1,40})/g)].map((m) => m[1]!));
  }

  async run(now = new Date()): Promise<GcsOrphanResult> {
    const days = await this.days();
    if (days === 0) return { deleted: 0, kept: 0, bytes: 0, skipped: "disabled" };
    // Fișierele aduse de un import se leagă de postări pe parcurs: un import pornit sau oprit temporar le poate lega încă.
    const busy = await this.deps.db.importJob.count({ where: { status: { in: ["QUEUED", "RUNNING", "PAUSED"] } } });
    if (busy > 0) return { deleted: 0, kept: 0, bytes: 0, skipped: "import_running" };

    const cutoff = new Date(now.getTime() - days * DAY_MS);
    const settingsRefs = await this.inSettings();
    const result: GcsOrphanResult = { deleted: 0, kept: 0, bytes: 0 };
    let after: string | null = null;
    for (let seen = 0; seen < ORPHANS_MAX_PER_RUN; ) {
      const rows = await this.deps.attachments.unattachedBefore(cutoff, ORPHANS_BATCH, after);
      if (rows.length === 0) break;
      seen += rows.length;
      after = rows[rows.length - 1]!.id;
      const refs = await this.referenced(rows.map((r) => r.id));
      const orphans = rows.filter((r) => !refs.has(r.id) && !settingsRefs.has(r.id));
      result.kept += rows.length - orphans.length;
      if (orphans.length > 0) {
        await this.deps.attachments.discard(orphans.map((r) => r.id));
        result.deleted += orphans.length;
        result.bytes += orphans.reduce((n, r) => n + r.size, 0);
      }
      if (rows.length < ORPHANS_BATCH) break;
    }
    return result;
  }
}
