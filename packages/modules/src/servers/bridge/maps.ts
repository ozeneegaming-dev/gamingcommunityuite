import { GcsBlockedFetch, GcsNotFound, GcsValidationError, safeFetchBuffer, writeAudit, type GcsAcpRoleService, type GcsActor, type GcsAttachmentService, type GcsFetchedFile, type GcsSettingsService } from "@gcs/core";
import type { Prisma, PrismaClient } from "@gcs/db";
import { gameDef } from "../games";
import { BRIDGE_SETTING, MAP_IMAGE, SERVER_MAPS_ACP_SECTION, isBridgeGame } from "./config";
import { cleanMapName } from "./types";

export const MAP_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const MAP_UPLOAD_MAX_FILES = 100;
/** Mărimea imaginilor hărților după recodare (încadrate, fără mărire). */
const IMAGE_SIZE = { width: 1280, height: 720 };
/** Câte hărți aduce o rundă a jobului și de câte ori încearcă (1 h × 2^încercări, max 7 zile). */
const FETCH_BATCH = 20;
const RETRY_BASE_MS = 3_600_000;
const RETRY_MAX_MS = 7 * 86_400_000;
const FETCH_TIMEOUT_MS = 15_000;
const PAGE_SIZE = 60;

/** Adresa artei generice a unui joc (SVG original, cache public o zi). */
export const mapArtUrl = (game: string) => `/api/servers/maps/art/${encodeURIComponent(game)}`;

export type GcsMapImage = { url: string; generic: boolean };
export type GcsMapRow = {
  id: number;
  game: string;
  name: string;
  image: GcsMapImage;
  source: string | null;
  fetchedAt: string | null;
  fetchError: string | null;
  attempts: number;
  nextFetchAt: string | null;
  updatedAt: string;
};

/** Numele hărții din numele fișierului (`de_dust2.jpg` → `de_dust2`). */
export function mapNameFromFile(filename: string): string | null {
  const base = filename.replace(/\\/g, "/").split("/").pop() ?? "";
  return cleanMapName(base.replace(/\.[A-Za-z0-9]{1,5}$/, ""));
}

const templateKey = (game: string) => (game === "cs2" ? BRIDGE_SETTING.mapTemplateCs2 : game === "cs16" ? BRIDGE_SETTING.mapTemplateCs16 : null);

/**
 * Catalogul hărților (specul 2026-10-08-servere-bridge §13): rândurile apar când o hartă e văzută (heartbeat, `map`,
 * meci) sau la încărcare. Imaginile vin doar din încărcarea în masă din ACP sau din șablonul de adresă al jocului,
 * aduse de job cu descărcarea gardată a platformei; fără imagine se arată arta generică originală.
 */
export class GcsBridgeMaps {
  constructor(
    private readonly deps: {
      db: PrismaClient;
      acp: GcsAcpRoleService;
      attachments: GcsAttachmentService;
      settings: GcsSettingsService;
      now?: () => number;
      /** Doar pentru teste: descărcarea (implicit `safeFetchBuffer`, doar porturile 80 / 443). */
      fetch?: (url: string) => Promise<GcsFetchedFile>;
    },
  ) {}

  private now(): Date {
    return new Date(this.deps.now?.() ?? Date.now());
  }

  /** O hartă văzută pe un server (idempotent, ieftin). */
  async seen(game: string, map: string | null): Promise<void> {
    const name = cleanMapName(map);
    if (!name || !isBridgeGame(game)) return;
    await this.deps.db.gameMap.createMany({ data: [{ game, name }], skipDuplicates: true });
  }

  async image(game: string, map: string): Promise<GcsMapImage> {
    return (await this.images(game, [map])).get(map) ?? { url: mapArtUrl(game), generic: true };
  }

  /** Imaginile mai multor hărți ale unui joc (o singură citire). */
  async images(game: string, maps: string[]): Promise<Map<string, GcsMapImage>> {
    const names = [...new Set(maps.map((m) => cleanMapName(m)).filter((m): m is string => m !== null))];
    const rows = names.length === 0 ? [] : await this.deps.db.gameMap.findMany({ where: { game, name: { in: names } }, select: { name: true, imageId: true } });
    const byName = new Map(rows.map((r) => [r.name, r.imageId]));
    return new Map(maps.map((m) => {
      const imageId = byName.get(cleanMapName(m) ?? "");
      return [m, imageId ? { url: `/files/${imageId}`, generic: false } : { url: mapArtUrl(game), generic: true }];
    }));
  }

  async list(actor: GcsActor, filter: { game?: string; q?: string; missing?: boolean; page?: number } = {}): Promise<{ items: GcsMapRow[]; total: number; page: number; pages: number }> {
    await this.deps.acp.assert(actor, SERVER_MAPS_ACP_SECTION, "view");
    const where: Prisma.GameMapWhereInput = {};
    if (filter.game) where.game = filter.game;
    if (filter.q?.trim()) where.name = { contains: filter.q.trim().toLowerCase() };
    if (filter.missing) where.imageId = null;
    const page = Math.max(1, Math.floor(filter.page ?? 1));
    const [total, rows] = await Promise.all([this.deps.db.gameMap.count({ where }), this.deps.db.gameMap.findMany({ where, orderBy: [{ game: "asc" }, { name: "asc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE })]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        game: r.game,
        name: r.name,
        image: r.imageId ? { url: `/files/${r.imageId}`, generic: false } : { url: mapArtUrl(r.game), generic: true },
        source: r.source,
        fetchedAt: r.fetchedAt?.toISOString() ?? null,
        fetchError: r.fetchError,
        attempts: r.attempts,
        nextFetchAt: r.nextFetchAt?.toISOString() ?? null,
        updatedAt: r.updatedAt.toISOString(),
      })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    };
  }

  /** Imaginea nouă a unei hărți: cea veche se șterge (și fișierul ei). */
  private async setImage(game: string, name: string, imageId: string, source: "UPLOAD" | "TEMPLATE"): Promise<void> {
    const { db, attachments } = this.deps;
    const now = this.now();
    const row = await db.gameMap.upsert({ where: { game_name: { game, name } }, create: { game, name }, update: {} });
    await attachments.deleteFor(MAP_IMAGE, [String(row.id)]);
    await db.$transaction([
      db.attachment.update({ where: { id: imageId }, data: { contentType: MAP_IMAGE, contentId: String(row.id) } }),
      db.gameMap.update({ where: { id: row.id }, data: { imageId, source, fetchedAt: now, fetchError: null, attempts: 0, nextFetchAt: null } }),
    ]);
  }

  /**
   * Încărcarea în masă (ACP → Gaming → Hărți): numele fișierului dă numele hărții; fiecare imagine trece prin pipeline-ul
   * atașamentelor (tipul real din magic bytes, recodarea), max 5 MB, max 100 de fișiere pe încărcare.
   */
  async upload(actor: GcsActor, game: string, files: { name: string; bytes: Buffer }[]): Promise<{ saved: string[]; errors: { file: string; error: string }[] }> {
    await this.deps.acp.assert(actor, SERVER_MAPS_ACP_SECTION, "edit");
    if (!isBridgeGame(game) || !gameDef(game)) throw new GcsValidationError({ game: "invalid" });
    if (files.length === 0) throw new GcsValidationError({ files: "required" });
    if (files.length > MAP_UPLOAD_MAX_FILES) throw new GcsValidationError({ files: "too_many" }, { max: String(MAP_UPLOAD_MAX_FILES) });
    const saved: string[] = [];
    const errors: { file: string; error: string }[] = [];
    for (const file of files) {
      const name = mapNameFromFile(file.name);
      const label = file.name.slice(0, 120);
      if (!name) {
        errors.push({ file: label, error: "invalid_map_name" });
        continue;
      }
      try {
        const stored = await this.deps.attachments.storeImage(actor.userId, { name: `${name}.webp`, bytes: file.bytes }, { maxBytes: MAP_IMAGE_MAX_BYTES, ...IMAGE_SIZE, fit: "inside" });
        await this.setImage(game, name, stored.id, "UPLOAD");
        saved.push(name);
      } catch (error) {
        if (!(error instanceof GcsValidationError)) throw error;
        errors.push({ file: label, error: Object.values(error.fields)[0] ?? "invalid_image" });
      }
    }
    if (saved.length > 0) {
      await writeAudit(this.deps.db, { actorId: actor.userId, action: "servers.maps.upload", targetType: "game_map", targetId: game, after: { saved }, ip: actor.ip });
    }
    return { saved, errors };
  }

  /** Scoate imaginea unei hărți (rămâne arta generică; șablonul o poate aduce din nou). */
  async removeImage(actor: GcsActor, id: number): Promise<void> {
    const { db, acp, attachments } = this.deps;
    await acp.assert(actor, SERVER_MAPS_ACP_SECTION, "delete");
    const row = await db.gameMap.findUnique({ where: { id } });
    if (!row) throw new GcsNotFound();
    await attachments.deleteFor(MAP_IMAGE, [String(id)]);
    await db.gameMap.update({ where: { id }, data: { imageId: null, source: null, fetchedAt: null, fetchError: null, attempts: 0, nextFetchAt: null } });
    await writeAudit(db, { actorId: actor.userId, action: "servers.maps.remove_image", targetType: "game_map", targetId: String(id), before: { game: row.game, name: row.name }, ip: actor.ip });
  }

  /**
   * Jobul `servers.bridge.maps` (la 10 minute): pentru fiecare joc cu șablon (`https://…/{map}.jpg`), max 20 de hărți
   * fără imagine, scadente. Descărcarea e gardată (doar http/https pe 80 / 443, adrese publice verificate la conectare,
   * redirecturile re-verificate, max 5 MB, 15 s); un eșec se notează și se reîncearcă după 1 h × 2^încercări (max 7 zile).
   */
  async fetchDue(): Promise<{ fetched: number; failed: number }> {
    const { db, settings } = this.deps;
    const now = this.now();
    let fetched = 0;
    let failed = 0;
    for (const game of ["cs16", "cs2"]) {
      const key = templateKey(game);
      const template = key ? (await settings.get<string>(key)).trim() : "";
      if (!template) continue;
      const due = await db.gameMap.findMany({
        where: { game, imageId: null, OR: [{ nextFetchAt: null }, { nextFetchAt: { lte: now } }] },
        orderBy: [{ attempts: "asc" }, { id: "asc" }],
        take: FETCH_BATCH,
      });
      for (const map of due) {
        const url = template.replaceAll("{map}", encodeURIComponent(map.name));
        try {
          const file = await (this.deps.fetch ?? ((u: string) => safeFetchBuffer(u, { maxBytes: MAP_IMAGE_MAX_BYTES, timeoutMs: FETCH_TIMEOUT_MS, ports: [80, 443], maxRedirects: 3 })))(url);
          const stored = await this.deps.attachments.storeImage(null, { name: `${map.name}.webp`, bytes: file.bytes }, { maxBytes: MAP_IMAGE_MAX_BYTES, ...IMAGE_SIZE, fit: "inside" });
          await this.setImage(game, map.name, stored.id, "TEMPLATE");
          fetched++;
        } catch (error) {
          const reason = error instanceof GcsBlockedFetch ? error.reason : error instanceof GcsValidationError ? (Object.values(error.fields)[0] ?? "invalid_image") : "error";
          const attempts = map.attempts + 1;
          await db.gameMap.update({ where: { id: map.id }, data: { attempts, fetchError: reason.slice(0, 64), nextFetchAt: new Date(now.getTime() + Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_MAX_MS)) } });
          failed++;
        }
      }
    }
    return { fetched, failed };
  }

  /** Șablonul unui joc s-a schimbat: hărțile fără imagine se reîncearcă la runda următoare. */
  async resetFetches(game: string): Promise<void> {
    await this.deps.db.gameMap.updateMany({ where: { game, imageId: null }, data: { attempts: 0, fetchError: null, nextFetchAt: null } });
  }
}
