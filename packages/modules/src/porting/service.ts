/**
 * `GcsPortingService`: asistentul de portare din ACP (Sistem → Conversii → Portare plugin, secțiunea `system.porting`).
 *
 * Fluxul: **încărcare** (analiza: formatul, metadatele, licența, numerele; nimic convertit) → **confirmarea dreptului**
 * de a modifica și folosi pluginul (temeiul + bifa, obligatorii) → **conversie** (pluginul GCS, raportul, arhiva
 * rezultatului) → **descărcare** și/sau **predare** la pasul de validare al instalatorului de pluginuri. Pluginul nu se
 * instalează și nu se activează niciodată de aici. Încărcarea, conversia, predarea și ștergerea intră în jurnalul ACP.
 *
 * Erorile (pentru interfață):
 * - `GcsValidationError({ file: <cod> }, params)`: arhiva respinsă la încărcare; codurile sunt cele ale cititorului
 *   (`archive_too_large`, `zip_invalid`, `zip_corrupt`, `zip_crc`, `zip64_unsupported`, `zip_encrypted`, `zip_method`,
 *   `zip_multidisk`, `path_unsafe`, `symlink`, `special_file`, `duplicate_path`, `too_many_files`, `file_too_large`,
 *   `total_too_large`, `compression_ratio`) plus `required` (fișier gol), `unknown_archive` (nici ZIP, nici TAR, nici
 *   XML) și `unknown_format` (arhivă validă, dar fără un format de plugin cunoscut); `params` poate avea `path`, `max`;
 * - `GcsValidationError({ rights: "required" })`: conversia fără confirmarea dreptului (bifa + temeiul valid);
 * - `GcsValidationError({ key: "invalid" })`: cheia pluginului nu e `vendor.nume` valid;
 * - `GcsValidationError({ package: "invalid" })`: predarea unui pachet care nu trece de validare;
 * - `GcsConflict({ reason: "already_converted" })` / `GcsConflict({ reason: "not_converted" })`;
 * - `GcsNotFound({ entity: "plugin_port" })`: portarea nu există sau a expirat (după o zi).
 */
import { createHash } from "node:crypto";
import {
  GcsConflict,
  GcsNotFound,
  GcsPluginPackageError,
  GcsValidationError,
  writeAudit,
  type GcsAcpRoleService,
  type GcsActor,
  type GcsPluginService,
} from "@gcs/core";
import type { Prisma, PrismaClient } from "@gcs/db";
import { readPortArchive } from "./archive";
import { analyzePortSource, readPortSource } from "./detect";
import { convertPortSource } from "./generate";
import type { GcsPortLocale } from "./report";
import { GCS_PORT_RIGHTS, type GcsPortAnalysis, type GcsPortFormat, type GcsPortReport, type GcsPortRightsBasis } from "./types";

/** Secțiunea ACP a asistentului (ACP → Sistem → Conversii → Portare plugin); implicit doar Root Admin. */
export const PORTING_ACP_SECTION = "system.porting";
/** O portare (cu arhivele ei) se păstrează o zi. */
export const PORT_TTL_MS = 24 * 60 * 60 * 1000;

export type GcsPortStatus = "analyzed" | "converted";

/** O portare, cum o vede interfața (fără arhive). */
export type GcsPortView = {
  id: string;
  status: GcsPortStatus;
  /** Numele fișierului încărcat (curățat). */
  fileName: string;
  format: GcsPortFormat;
  /** Numele pluginului din sursă. */
  sourceName: string;
  sha256: string;
  createdAt: Date;
  /** Formatul, metadatele, licența (cu semnalul GPL), cheia propusă și numerele pe tipuri. */
  analysis: GcsPortAnalysis;
  /** Confirmarea dreptului (după conversie). */
  rights: { basis: GcsPortRightsBasis; confirmedAt: Date } | null;
  pluginKey: string | null;
  /** Raportul conversiei: procentul, tabelul pe tipuri, fișierele manuale, avertismentele, verificările pachetului. */
  report: GcsPortReport | null;
  /** Mărimea arhivei rezultatului (octeți), după conversie. */
  resultSize: number | null;
  /** Pachetul generat trece de validarea instalatorului (butonul „Trimite la instalare”). */
  canHandoff: boolean;
  /** Când se șterge automat. */
  expiresAt: Date;
};

/** Un rând din lista portărilor recente. */
export type GcsPortListItem = Pick<GcsPortView, "id" | "status" | "fileName" | "format" | "sourceName" | "pluginKey" | "createdAt"> & { automatedPercent: number | null };

/** Confirmarea de dinaintea conversiei. */
export type GcsPortConvertInput = {
  /** Temeiul: e autorul, are acordul scris al autorului sau licența permite. */
  basis: GcsPortRightsBasis;
  /** Bifa „Confirm că am dreptul să modific și să folosesc acest plugin”. */
  confirmed: boolean;
  /** Cheia pluginului (`vendor.nume`); lipsă = cea propusă de analiză. */
  key?: string;
  /** Limba pentru `PORTING.md` și sugestii (implicit `ro`). */
  locale?: GcsPortLocale;
};

export type GcsPortingServiceDeps = {
  db: PrismaClient;
  acp: GcsAcpRoleService;
  /** Instalatorul de pluginuri: predarea pachetului la pasul lui de validare (`stage`). */
  plugins: Pick<GcsPluginService, "stage">;
};

const VIEW_SELECT = {
  id: true,
  fileName: true,
  format: true,
  sourceName: true,
  sha256: true,
  analysis: true,
  rightsBasis: true,
  confirmedAt: true,
  pluginKey: true,
  report: true,
  createdAt: true,
} as const;

type ViewRow = Prisma.PluginPortGetPayload<{ select: typeof VIEW_SELECT }>;

/** Numele fișierului încărcat, redus la caractere sigure. */
const cleanFileName = (name: string) => name.replace(/^.*[\\/]/, "").replace(/[^\w.\- ]/g, "_").slice(0, 120) || "plugin";

export class GcsPortingService {
  constructor(private readonly deps: GcsPortingServiceDeps) {}

  private toView(row: ViewRow, resultSize: number | null): GcsPortView {
    const report = (row.report as GcsPortReport | null) ?? null;
    return {
      id: row.id,
      status: report ? "converted" : "analyzed",
      fileName: row.fileName,
      format: row.format as GcsPortFormat,
      sourceName: row.sourceName,
      sha256: row.sha256,
      createdAt: row.createdAt,
      analysis: row.analysis as GcsPortAnalysis,
      rights: row.rightsBasis && row.confirmedAt ? { basis: row.rightsBasis as GcsPortRightsBasis, confirmedAt: row.confirmedAt } : null,
      pluginKey: row.pluginKey,
      report,
      resultSize,
      canHandoff: report?.validation.ok === true,
      expiresAt: new Date(row.createdAt.getTime() + PORT_TTL_MS),
    };
  }

  /** Rândul unei portări neexpirate, sau `GcsNotFound`. */
  private async row(id: string) {
    const row = await this.deps.db.pluginPort.findUnique({ where: { id: String(id) } });
    if (!row || row.createdAt.getTime() < Date.now() - PORT_TTL_MS) throw new GcsNotFound({ entity: "plugin_port" });
    return row;
  }

  /**
   * Primește arhiva sursă și o analizează (formatul, metadatele, licența, numerele), fără să convertească nimic.
   * Arhiva se păstrează până la conversie (cel mult o zi). Portările expirate se șterg acum.
   */
  async analyze(actor: GcsActor, input: { fileName: string; data: Buffer }): Promise<GcsPortView> {
    await this.deps.acp.assert(actor, PORTING_ACP_SECTION, "edit");
    const { db } = this.deps;
    await db.pluginPort.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - PORT_TTL_MS) } } });
    if (!input.data || input.data.length === 0) throw new GcsValidationError({ file: "required" });
    const fileName = cleanFileName(input.fileName);
    let analysis: GcsPortAnalysis;
    try {
      analysis = analyzePortSource(readPortSource(readPortArchive(fileName, input.data)));
    } catch (e) {
      if (e instanceof GcsPluginPackageError) throw new GcsValidationError({ file: e.code }, e.params);
      throw new GcsValidationError({ file: "unknown_format" });
    }
    const sha256 = createHash("sha256").update(input.data).digest("hex");
    const row = await db.pluginPort.create({
      data: {
        actorId: actor.userId,
        fileName,
        format: analysis.format,
        sourceName: analysis.meta.name.slice(0, 200),
        sha256,
        analysis: analysis as unknown as Prisma.InputJsonValue,
        source: new Uint8Array(input.data),
      },
      select: VIEW_SELECT,
    });
    await writeAudit(db, {
      actorId: actor.userId,
      action: "porting.upload",
      targetType: "plugin_port",
      targetId: row.id,
      after: { fileName, format: analysis.format, plugin: analysis.meta.name, version: analysis.meta.version, gpl: analysis.license.gpl, sha256 },
      ip: actor.ip,
    });
    return this.toView(row, null);
  }

  async get(actor: GcsActor, id: string): Promise<GcsPortView> {
    await this.deps.acp.assert(actor, PORTING_ACP_SECTION, "view");
    const row = await this.row(id);
    return this.toView(row, row.result ? row.result.length : null);
  }

  /** Portările din ultima zi, cele mai noi întâi. */
  async list(actor: GcsActor, limit = 10): Promise<GcsPortListItem[]> {
    await this.deps.acp.assert(actor, PORTING_ACP_SECTION, "view");
    const rows = await this.deps.db.pluginPort.findMany({
      where: { createdAt: { gte: new Date(Date.now() - PORT_TTL_MS) } },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(1, limit), 50),
      select: { id: true, fileName: true, format: true, sourceName: true, pluginKey: true, createdAt: true, report: true },
    });
    return rows.map((r) => {
      const report = r.report as GcsPortReport | null;
      return {
        id: r.id,
        status: report ? "converted" : "analyzed",
        fileName: r.fileName,
        format: r.format as GcsPortFormat,
        sourceName: r.sourceName,
        pluginKey: r.pluginKey,
        createdAt: r.createdAt,
        automatedPercent: report?.automatedPercent ?? null,
      };
    });
  }

  /**
   * Conversia, după confirmarea dreptului de a modifica și folosi pluginul (bifa + temeiul). Confirmarea, numele
   * pluginului și semnalul GPL intră în jurnalul ACP (`porting.convert`). Arhiva sursă se șterge după conversie.
   */
  async convert(actor: GcsActor, id: string, input: GcsPortConvertInput): Promise<GcsPortView> {
    await this.deps.acp.assert(actor, PORTING_ACP_SECTION, "edit");
    const { db } = this.deps;
    if (input.confirmed !== true || !GCS_PORT_RIGHTS.includes(input.basis)) throw new GcsValidationError({ rights: "required" });
    const row = await this.row(id);
    if (row.report || !row.source) throw new GcsConflict({ reason: "already_converted" });
    const analysis = row.analysis as unknown as GcsPortAnalysis;
    const key = (input.key ?? "").trim() || analysis.suggestedKey;
    const confirmedAt = new Date();
    // Sursa a fost deja citită la încărcare; se recitește (tot doar ca text) din arhiva păstrată.
    const source = readPortSource(readPortArchive(row.fileName, Buffer.from(row.source)));
    const out = convertPortSource(source, { key, rights: { basis: input.basis, confirmedAt }, locale: input.locale === "en" ? "en" : "ro" });
    const updated = await db.$transaction(async (tx) => {
      const saved = await tx.pluginPort.update({
        where: { id: row.id },
        data: {
          rightsBasis: input.basis,
          confirmedAt,
          pluginKey: key,
          report: out.report as unknown as Prisma.InputJsonValue,
          result: new Uint8Array(out.resultZip),
          package: new Uint8Array(out.packageZip),
          source: null,
        },
        select: VIEW_SELECT,
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: "porting.convert",
        targetType: "plugin_port",
        targetId: row.id,
        after: {
          plugin: row.sourceName,
          format: row.format,
          rights: input.basis,
          confirmed: true,
          key,
          version: out.report.plugin.version,
          gpl: out.report.license.gpl,
          license: out.report.license.spdx,
          automatedPercent: out.report.automatedPercent,
          valid: out.report.validation.ok,
        },
        ip: actor.ip,
      });
      return saved;
    });
    return this.toView(updated, out.resultZip.length);
  }

  /** Arhiva rezultatului (`<cheie>-port.zip`): folderul pluginului, pachetul, `ORIGINAL/`, `PORTING.md`, `report.json`. */
  async download(actor: GcsActor, id: string): Promise<{ fileName: string; data: Buffer }> {
    await this.deps.acp.assert(actor, PORTING_ACP_SECTION, "view");
    const row = await this.row(id);
    if (!row.result || !row.pluginKey) throw new GcsConflict({ reason: "not_converted" });
    return { fileName: `${row.pluginKey}-port.zip`, data: Buffer.from(row.result) };
  }

  /**
   * Predă pachetul generat la pasul de validare al instalatorului de pluginuri (o încărcare în așteptare, ca un `.zip`
   * urcat din ACP → Aplicații și pluginuri). Nu instalează și nu activează nimic: adminul decide pe ecranul de
   * confirmare al instalatorului (`/admin/system/applications/install/<uploadId>`), cu drepturile lui pe pluginuri.
   */
  async handoff(actor: GcsActor, id: string): Promise<{ uploadId: string }> {
    await this.deps.acp.assert(actor, PORTING_ACP_SECTION, "edit");
    const row = await this.row(id);
    const report = row.report as GcsPortReport | null;
    if (!report || !row.package) throw new GcsConflict({ reason: "not_converted" });
    if (!report.validation.ok) throw new GcsValidationError({ package: "invalid" });
    const { id: uploadId } = await this.deps.plugins.stage(actor, { fileName: report.plugin.fileName, data: Buffer.from(row.package) });
    await writeAudit(this.deps.db, {
      actorId: actor.userId,
      action: "porting.handoff",
      targetType: "plugin_port",
      targetId: row.id,
      after: { key: row.pluginKey, uploadId },
      ip: actor.ip,
    });
    return { uploadId };
  }

  async delete(actor: GcsActor, id: string): Promise<void> {
    await this.deps.acp.assert(actor, PORTING_ACP_SECTION, "delete");
    const row = await this.deps.db.pluginPort.findUnique({ where: { id: String(id) }, select: { id: true, sourceName: true, pluginKey: true } });
    if (!row) throw new GcsNotFound({ entity: "plugin_port" });
    await this.deps.db.pluginPort.delete({ where: { id: row.id } });
    await writeAudit(this.deps.db, {
      actorId: actor.userId,
      action: "porting.delete",
      targetType: "plugin_port",
      targetId: row.id,
      before: { plugin: row.sourceName, key: row.pluginKey },
      ip: actor.ip,
    });
  }
}
