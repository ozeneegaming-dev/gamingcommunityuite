import type { Prisma, PrismaClient } from "@gcs/db";
import type { KeyObject } from "node:crypto";
import type { GcsAcpRoleService } from "../acp/roles";
import { AUDIT_REDACTED, writeAudit } from "../audit";
import { GcsConflict, GcsForbidden, GcsNotFound, GcsValidationError } from "../errors";
import type { GcsEventBus } from "../events";
import type { GcsJobQueue } from "../jobs/queue";
import type { GcsPermissionService } from "../permissions/service";
import type { GcsActor } from "../permissions/types";
import { PLUGIN_DEFAULT_PRIORITY, pluginAcpSection, pluginRegistryKey } from "./catalog";
import type { GcsPluginDatabase } from "./database";
import { defaultPluginSettings, manifestSettingFields, parsePluginManifest, validatePluginSetting, type GcsPluginManifest } from "./manifest";
import { validatePluginPackage, type GcsPluginReport } from "./package";
import { readPluginZip } from "./zip";

/** Secțiunea ACP a pluginurilor (aceeași cu aplicațiile: Sistem → Aplicații și pluginuri). */
export const PLUGINS_ACP_SECTION = "system.applications";
/** Secțiunea ACP a paginii Sistem → Hook-uri. */
export const HOOKS_ACP_SECTION = "system.hooks";
/** Jobul generic care rulează joburile pluginurilor în `gcs-worker`. */
export const PLUGIN_JOB = "plugin.job";
/** Cât stă o încărcare în așteptarea confirmării. */
const UPLOAD_TTL_MS = 3600_000;
const MAX_LOGS = 300;

export type GcsPluginRow = {
  key: string;
  name: string;
  version: string;
  enabled: boolean;
  status: string;
  signed: boolean;
  signatureKeyId: string | null;
  capabilities: string[];
  manifest: GcsPluginManifest;
  settings: Record<string, unknown>;
  packageSha256: string | null;
  dbRole: string | null;
  migrations: string[];
  disabledReason: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  lastErrorAt: Date | null;
  installedAt: Date;
  updatedAt: Date;
};

/** Ce primește un proces ca să încarce un plugin (fără parola rolului DB, care rămâne în gazdă). */
export type GcsPluginLoadable = GcsPluginRow & { package: Buffer };

export type GcsPluginLogView = { id: number; level: string; hook: string | null; message: string; durationMs: number | null; createdAt: Date };
export type GcsPluginHookSettingView = { pluginKey: string; hook: string; enabled: boolean; priority: number | null };

const ROW_SELECT = {
  key: true,
  name: true,
  version: true,
  enabled: true,
  status: true,
  signed: true,
  signatureKeyId: true,
  capabilities: true,
  manifest: true,
  settings: true,
  packageSha256: true,
  dbRole: true,
  migrations: true,
  disabledReason: true,
  consecutiveFailures: true,
  lastError: true,
  lastErrorAt: true,
  installedAt: true,
  updatedAt: true,
} satisfies Prisma.PluginSelect;

type RawRow = Prisma.PluginGetPayload<{ select: typeof ROW_SELECT }>;

function toRow(r: RawRow): GcsPluginRow {
  // Manifestul a fost validat la instalare; îl parsăm din nou ca să primim valorile implicite și tipurile.
  const parsed = parsePluginManifest(r.manifest);
  if (!parsed.ok) throw new Error(`Manifest invalid în baza de date pentru ${r.key}`);
  return { ...r, manifest: parsed.manifest, settings: (r.settings ?? {}) as Record<string, unknown>, capabilities: r.capabilities ?? [], migrations: r.migrations ?? [] };
}

/** Id-ul programării unui job periodic al pluginului (BullMQ nu acceptă `:`). */
export const pluginSchedulerId = (key: string, job: string) => `plugin-${key}-${job}`;

export type GcsPluginServiceDeps = {
  db: PrismaClient;
  acp: GcsAcpRoleService;
  database: GcsPluginDatabase;
  jobs: Pick<GcsJobQueue, "upsertScheduler" | "removeScheduler" | "schedulerIds">;
  /** Anunță toate procesele (Redis) că starea pluginurilor s-a schimbat. */
  notify: () => Promise<void>;
  /** Pentru invalidarea cache-urilor atinse la dezinstalare (layout-ul widget-urilor). */
  bus?: GcsEventBus;
  /** Versiunea permisiunilor crește când dezinstalarea șterge permisiunile pluginului (altfel cache-ul le-ar păstra). */
  permissions: Pick<GcsPermissionService, "bumpVersion">;
  trustedKeys: () => ReadonlyMap<string, KeyObject>;
  unsignedPolicy: () => "allow" | "deny";
  platformVersion?: string;
};

export type GcsPluginInstallConfirm = {
  /** Cheia pluginului, tastată de admin (obligatorie la pachetele nesemnate). */
  typedKey?: string;
  /** Codul 2FA a fost verificat chiar acum (obligatoriu la pachetele nesemnate). */
  twoFactorVerified?: boolean;
};

/**
 * Ciclul de viață al pluginurilor (designul pluginurilor §2.4): încărcare → raport → confirmare → instalare;
 * activare / dezactivare; setări; actualizare; dezinstalare (cu sau fără păstrarea datelor). Toate scriu în jurnalul ACP și
 * anunță celelalte procese, care încarcă sau descarcă pluginul fără repornire.
 */
export class GcsPluginService {
  constructor(private readonly deps: GcsPluginServiceDeps) {}

  // ─── Citiri ───

  async list(): Promise<GcsPluginRow[]> {
    const rows = await this.deps.db.plugin.findMany({ select: ROW_SELECT, orderBy: { name: "asc" } });
    return rows.map(toRow);
  }

  async get(key: string): Promise<GcsPluginRow | null> {
    const row = await this.deps.db.plugin.findUnique({ where: { key }, select: ROW_SELECT });
    return row ? toRow(row) : null;
  }

  /** Pluginurile active, cu arhiva (pentru încărcarea în procese); `keys` le restrânge. */
  async loadable(keys?: string[]): Promise<GcsPluginLoadable[]> {
    const rows = await this.deps.db.plugin.findMany({
      where: { enabled: true, status: "installed", package: { not: null }, ...(keys ? { key: { in: keys } } : {}) },
      select: { ...ROW_SELECT, package: true },
    });
    return rows.map((r) => ({ ...toRow(r), package: Buffer.from(r.package!) }));
  }

  /** Starea pentru reconcilierea proceselor: cheie, sha și setări (fără arhive). */
  async states(): Promise<{ key: string; enabled: boolean; status: string; sha: string | null; settingsHash: string; updatedAt: Date }[]> {
    const rows = await this.deps.db.plugin.findMany({ select: { key: true, enabled: true, status: true, packageSha256: true, settings: true, updatedAt: true } });
    return rows.map((r) => ({ key: r.key, enabled: r.enabled, status: r.status, sha: r.packageSha256, settingsHash: JSON.stringify(r.settings), updatedAt: r.updatedAt }));
  }

  /** Credențialele rolului DB (doar pentru gazdă; nu ajung niciodată la plugin). */
  async credentials(key: string): Promise<{ role: string; password: string } | null> {
    const row = await this.deps.db.plugin.findUnique({ where: { key }, select: { dbRole: true, dbPassword: true } });
    return row?.dbRole && row.dbPassword ? { role: row.dbRole, password: row.dbPassword } : null;
  }

  async logs(key: string, limit = 100): Promise<GcsPluginLogView[]> {
    return this.deps.db.pluginLog.findMany({
      where: { pluginKey: key },
      orderBy: { id: "desc" },
      take: Math.min(limit, MAX_LOGS),
      select: { id: true, level: true, hook: true, message: true, durationMs: true, createdAt: true },
    });
  }

  async hookSettings(): Promise<GcsPluginHookSettingView[]> {
    return this.deps.db.pluginHookSetting.findMany({ select: { pluginKey: true, hook: true, enabled: true, priority: true } });
  }

  // ─── Încărcarea și confirmarea ───

  private async installedInfo() {
    const rows = await this.deps.db.plugin.findMany({ select: { key: true, version: true, status: true, enabled: true, capabilities: true } });
    return rows.map((r) => ({ ...r, capabilities: r.capabilities ?? [] }));
  }

  private async validate(data: Buffer): Promise<ReturnType<typeof validatePluginPackage>> {
    return validatePluginPackage(data, {
      installed: await this.installedInfo(),
      trustedKeys: this.deps.trustedKeys(),
      unsignedPolicy: this.deps.unsignedPolicy(),
      ...(this.deps.platformVersion ? { platformVersion: this.deps.platformVersion } : {}),
    });
  }

  /** Primește o arhivă din ACP: o validează și o păstrează (o oră) până la confirmare. Întoarce raportul. */
  async stage(actor: GcsActor, input: { fileName: string; data: Buffer }): Promise<{ id: string; report: GcsPluginReport }> {
    await this.deps.acp.assert(actor, PLUGINS_ACP_SECTION, "edit");
    const { db } = this.deps;
    await db.pluginUpload.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - UPLOAD_TTL_MS) } } });
    const { report } = await this.validate(input.data);
    const upload = await db.pluginUpload.create({
      data: {
        actorId: actor.userId,
        fileName: input.fileName.replace(/[^\w.\- ]/g, "_").slice(0, 120) || "plugin.zip",
        data: new Uint8Array(input.data),
        sha256: report.sha256,
        report: report as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return { id: upload.id, report };
  }

  /** O încărcare în așteptare, cu raportul recalculat (pluginurile instalate se pot fi schimbat între timp). */
  async staged(
    actor: GcsActor,
    id: string,
  ): Promise<{ id: string; fileName: string; createdAt: Date; report: GcsPluginReport; langs: Record<string, Record<string, unknown>> } | null> {
    await this.deps.acp.assert(actor, PLUGINS_ACP_SECTION, "view");
    const upload = await this.deps.db.pluginUpload.findUnique({ where: { id } });
    if (!upload || upload.createdAt.getTime() < Date.now() - UPLOAD_TTL_MS) return null;
    const { report, files } = await this.validate(Buffer.from(upload.data));
    return { id: upload.id, fileName: upload.fileName, createdAt: upload.createdAt, report, langs: files ? langsOf(files) : {} };
  }

  async discard(actor: GcsActor, id: string): Promise<void> {
    await this.deps.acp.assert(actor, PLUGINS_ACP_SECTION, "edit");
    await this.deps.db.pluginUpload.deleteMany({ where: { id } });
  }

  private async isRootAdmin(actor: GcsActor): Promise<boolean> {
    if (actor.isBanned || !actor.userId) return false;
    const groups = await this.deps.db.group.findMany({ where: { id: { in: actor.groupIds } }, select: { key: true } });
    return groups.some((g) => g.key === "root_admin") && !groups.some((g) => g.key === "banned");
  }

  /**
   * Instalează (sau actualizează / reinstalează) pluginul dintr-o încărcare confirmată. Pachetele nesemnate cer Root
   * Admin, codul 2FA verificat chiar acum și cheia pluginului tastată. Pluginul nou pornește activ; o actualizare
   * păstrează starea (activ / dezactivat) și setările, completate cu valorile implicite ale câmpurilor noi.
   */
  async install(actor: GcsActor, uploadId: string, confirm: GcsPluginInstallConfirm = {}): Promise<{ key: string; mode: "install" | "update" | "reinstall" }> {
    await this.deps.acp.assert(actor, PLUGINS_ACP_SECTION, "edit");
    const { manifest } = await this.confirmedUpload(actor, uploadId, confirm);
    // Două confirmări simultane (dublu-click, doi admini) pentru aceeași cheie rulează pe rând; a doua revalidează
    // încărcarea (poate fi deja consumată) față de starea lăsată de prima.
    return this.deps.database.withInstallLock(manifest.key, () => this.installLocked(actor, uploadId, confirm));
  }

  /** Încărcarea confirmată: există, e validă, iar un pachet nesemnat are confirmările cerute. */
  private async confirmedUpload(actor: GcsActor, uploadId: string, confirm: GcsPluginInstallConfirm) {
    const upload = await this.deps.db.pluginUpload.findUnique({ where: { id: uploadId } });
    if (!upload || upload.createdAt.getTime() < Date.now() - UPLOAD_TTL_MS) throw new GcsNotFound({ entity: "plugin_upload" });
    const data = Buffer.from(upload.data);
    const { report, files } = await this.validate(data);
    if (!report.ok || !files || !report.manifest || !report.mode) throw new GcsValidationError({ package: "invalid" });
    const manifest = report.manifest;
    const signed = report.signature?.status === "signed";

    if (!signed) {
      if (!(await this.isRootAdmin(actor))) throw new GcsForbidden({ reason: "unsigned_requires_root" });
      if (!confirm.twoFactorVerified) throw new GcsValidationError({ code: "invalid_code" });
      if ((confirm.typedKey ?? "").trim() !== manifest.key) throw new GcsValidationError({ confirmKey: "mismatch" });
    }
    return { data, report: { ...report, mode: report.mode }, files, manifest, signed };
  }

  private async installLocked(actor: GcsActor, uploadId: string, confirm: GcsPluginInstallConfirm): Promise<{ key: string; mode: "install" | "update" | "reinstall" }> {
    const { db, database } = this.deps;
    const { data, report, files, manifest, signed } = await this.confirmedUpload(actor, uploadId, confirm);
    const existing = await db.plugin.findUnique({ where: { key: manifest.key } });
    let creds = existing?.dbRole && existing.dbPassword ? { role: existing.dbRole, password: existing.dbPassword } : null;
    let applied = existing?.migrations ?? [];
    if (manifest.capabilities.includes("db")) {
      // Cu credențiale existente parola rămâne aceeași: o migrație eșuată nu taie accesul versiunii instalate.
      creds = await database.provision(manifest.key, creds);
      const migrations = [...files.keys()]
        .filter((p) => p.startsWith("migrations/"))
        .map((p) => ({ name: p.slice("migrations/".length), sql: files.get(p)!.toString("utf8") }));
      applied = await database.migrate(manifest.key, creds, migrations);
    }

    const previous = (existing?.settings ?? {}) as Record<string, unknown>;
    const defaults = defaultPluginSettings(manifest);
    const settings = Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, k in previous ? previous[k] : v]));
    const enabled = report.mode === "update" ? (existing?.enabled ?? true) : true;
    const fields = {
      name: manifest.name,
      version: manifest.version,
      status: "installed",
      enabled,
      disabledReason: enabled ? null : (existing?.disabledReason ?? "admin"),
      signed,
      signatureKeyId: report.signature && "keyId" in report.signature ? (report.signature.keyId ?? null) : null,
      capabilities: manifest.capabilities,
      manifest: manifest as unknown as Prisma.InputJsonValue,
      settings: settings as Prisma.InputJsonValue,
      package: new Uint8Array(data),
      packageSha256: report.sha256,
      dbRole: creds?.role ?? null,
      dbPassword: creds?.password ?? null,
      migrations: applied,
      consecutiveFailures: 0,
      lastError: null,
      lastErrorAt: null,
      installedById: actor.userId,
    };
    await db.$transaction(async (tx) => {
      await tx.plugin.upsert({ where: { key: manifest.key }, create: { key: manifest.key, ...fields }, update: fields });
      await tx.pluginUpload.delete({ where: { id: uploadId } });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: report.mode === "update" ? "plugin.update" : "plugin.install",
        targetType: "plugin",
        targetId: manifest.key,
        before: existing ? { version: existing.version, capabilities: existing.capabilities } : null,
        after: { version: manifest.version, capabilities: manifest.capabilities, signed, sha256: report.sha256, mode: report.mode },
        ip: actor.ip,
      });
    });
    await this.log(manifest.key, "info", `${report.mode} ${manifest.version}`);
    await this.syncSchedulers(manifest.key, enabled ? manifest : null);
    await this.deps.notify();
    return { key: manifest.key, mode: report.mode };
  }

  // ─── Activare, setări, hook-uri ───

  async setEnabled(actor: GcsActor, key: string, enabled: boolean): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, PLUGINS_ACP_SECTION, "edit");
    const row = await this.get(key);
    if (!row || row.status !== "installed") throw new GcsNotFound({ entity: "plugin" });
    if (enabled) {
      const installed = await this.installedInfo();
      for (const dep of Object.keys(row.manifest.dependencies)) {
        if (!installed.some((p) => p.key === dep && p.status === "installed" && p.enabled)) throw new GcsConflict({ reason: "dependency_disabled", plugin: dep });
      }
    }
    await db.$transaction(async (tx) => {
      await tx.plugin.update({ where: { key }, data: { enabled, disabledReason: enabled ? null : "admin", ...(enabled ? { consecutiveFailures: 0 } : {}) } });
      await writeAudit(tx, { actorId: actor.userId, action: enabled ? "plugin.enable" : "plugin.disable", targetType: "plugin", targetId: key, after: { enabled }, ip: actor.ip });
    });
    await this.syncSchedulers(key, enabled ? row.manifest : null);
    await this.deps.notify();
  }

  /** Dezactivează toate pluginurile (ACP sau `gcs plugins:disable-all`). Întoarce cheile dezactivate. */
  async disableAll(actor: GcsActor, reason: "admin" | "cli" = "admin"): Promise<string[]> {
    const { db, acp } = this.deps;
    if (reason === "admin") await acp.assert(actor, PLUGINS_ACP_SECTION, "edit");
    const rows = await db.plugin.findMany({ where: { enabled: true }, select: { key: true } });
    if (rows.length === 0) return [];
    const keys = rows.map((r) => r.key);
    await db.$transaction(async (tx) => {
      await tx.plugin.updateMany({ where: { key: { in: keys } }, data: { enabled: false, disabledReason: reason } });
      await writeAudit(tx, { actorId: actor.userId, action: "plugin.disable_all", targetType: "plugin", targetId: "*", after: { keys, reason }, ip: actor.ip });
    });
    for (const key of keys) await this.syncSchedulers(key, null);
    await this.deps.notify();
    return keys;
  }

  /**
   * Dezactivarea automată după prea multe eșecuri la rând (apelată de gazdă, fără actor): motivul `auto`, ultima eroare,
   * jurnalul pluginului și jurnalul ACP. Întoarce `false` dacă pluginul era deja dezactivat.
   */
  async autoDisable(key: string, failures: number, error: string): Promise<boolean> {
    const { db } = this.deps;
    const message = error.slice(0, 500);
    const changed = await db.$transaction(async (tx) => {
      const r = await tx.plugin.updateMany({
        where: { key, enabled: true },
        data: { enabled: false, disabledReason: "auto", consecutiveFailures: failures, lastError: message, lastErrorAt: new Date() },
      });
      if (r.count === 0) return false;
      await writeAudit(tx, { actorId: null, action: "plugin.auto_disable", targetType: "plugin", targetId: key, after: { failures, error: message } });
      return true;
    });
    if (!changed) return false;
    await this.log(key, "error", `auto-disabled after ${failures} consecutive failures: ${message}`);
    await this.syncSchedulers(key, null);
    await this.deps.notify();
    return true;
  }

  /**
   * Salvează setările pluginului (formularul generat din manifest). Valorile sunt validate după câmpuri; un secret gol
   * păstrează valoarea salvată. Erorile vin pe câmpuri.
   */
  async saveSettings(actor: GcsActor, key: string, values: Record<string, unknown>): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, PLUGINS_ACP_SECTION, "edit");
    const row = await this.get(key);
    if (!row) throw new GcsNotFound({ entity: "plugin" });
    const next = { ...row.settings };
    const errors: Record<string, string> = {};
    const changedKeys: string[] = [];
    for (const field of manifestSettingFields(row.manifest)) {
      if (!(field.key in values)) continue;
      const value = values[field.key];
      if (field.type === "secret" && value === "") continue;
      const check = validatePluginSetting(field, value);
      if (!check.ok) errors[field.key] = check.code;
      else if (next[field.key] !== check.value) {
        next[field.key] = check.value;
        changedKeys.push(field.key);
      }
    }
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    if (changedKeys.length === 0) return;
    const secrets = new Set(manifestSettingFields(row.manifest).filter((f) => f.type === "secret").map((f) => f.key));
    const shown = (s: Record<string, unknown>) => Object.fromEntries(changedKeys.map((k) => [k, secrets.has(k) ? AUDIT_REDACTED : s[k]]));
    await db.$transaction(async (tx) => {
      await tx.plugin.update({ where: { key }, data: { settings: next as Prisma.InputJsonValue } });
      await writeAudit(tx, { actorId: actor.userId, action: "plugin.settings", targetType: "plugin", targetId: key, before: shown(row.settings), after: shown(next), ip: actor.ip });
    });
    await this.deps.notify();
  }

  /** ACP → Sistem → Hook-uri: pornește/oprește un hook al unui plugin și îi schimbă prioritatea (`null` = cea din manifest). */
  async setHook(actor: GcsActor, key: string, hook: string, input: { enabled: boolean; priority: number | null }): Promise<void> {
    const { db, acp } = this.deps;
    await acp.assert(actor, HOOKS_ACP_SECTION, "edit");
    const row = await this.get(key);
    if (!row) throw new GcsNotFound({ entity: "plugin" });
    if (!pluginHooks(row.manifest).some((h) => h.hook === hook)) throw new GcsValidationError({ hook: "unknown" });
    if (input.priority !== null && (!Number.isInteger(input.priority) || input.priority < 0 || input.priority > 100)) throw new GcsValidationError({ priority: "invalid_range" });
    await db.$transaction(async (tx) => {
      await tx.pluginHookSetting.upsert({
        where: { pluginKey_hook: { pluginKey: key, hook } },
        create: { pluginKey: key, hook, enabled: input.enabled, priority: input.priority },
        update: { enabled: input.enabled, priority: input.priority },
      });
      await writeAudit(tx, { actorId: actor.userId, action: "plugin.hooks", targetType: "plugin", targetId: key, after: { hook, ...input }, ip: actor.ip });
    });
    await this.deps.notify();
  }

  // ─── Dezinstalarea ───

  /**
   * Dezinstalează pluginul. Cu `keepData`, schema, rolul DB, setările și jurnalul rămân (o reinstalare le refolosește);
   * altfel se șterg schema și rolul, rândul pluginului, permisiunile date grupurilor, drepturile ACP și widget-urile lui.
   */
  async uninstall(actor: GcsActor, key: string, opts: { keepData: boolean }): Promise<void> {
    const { db, acp, database } = this.deps;
    await acp.assert(actor, PLUGINS_ACP_SECTION, "delete");
    const row = await db.plugin.findUnique({ where: { key }, select: { key: true, version: true, dbRole: true, status: true } });
    if (!row) throw new GcsNotFound({ entity: "plugin" });
    await this.syncSchedulers(key, null);

    if (opts.keepData) {
      await db.$transaction(async (tx) => {
        await tx.plugin.update({ where: { key }, data: { status: "removed_kept_data", enabled: false, disabledReason: "admin", package: null, packageSha256: null } });
        await writeAudit(tx, { actorId: actor.userId, action: "plugin.uninstall", targetType: "plugin", targetId: key, before: { version: row.version }, after: { keepData: true }, ip: actor.ip });
      });
      await this.deps.notify();
      return;
    }

    // Întâi se descarcă din procese (altfel conexiunile rolului țin schema ocupată).
    await db.plugin.update({ where: { key }, data: { enabled: false, disabledReason: "admin" } });
    await this.deps.notify();
    await database.drop(key, row.dbRole);
    const prefix = `${pluginRegistryKey(key)}.`;
    await db.$transaction(async (tx) => {
      await tx.groupSetting.deleteMany({ where: { key: { startsWith: prefix } } });
      await tx.userPermission.deleteMany({ where: { key: { startsWith: prefix } } });
      await tx.containerPermission.deleteMany({ where: { action: { startsWith: prefix } } });
      await tx.acpRolePermission.deleteMany({ where: { section: pluginAcpSection(key) } });
      await tx.widgetPlacement.deleteMany({ where: { type: { startsWith: prefix } } });
      await tx.plugin.delete({ where: { key } });
      await writeAudit(tx, { actorId: actor.userId, action: "plugin.uninstall", targetType: "plugin", targetId: key, before: { version: row.version }, after: { keepData: false }, ip: actor.ip });
    });
    // Permisiunile pluginului au fost șterse: o reinstalare rapidă nu trebuie să le primească înapoi din cache.
    await this.deps.permissions.bumpVersion();
    // Widget-urile pluginului au dispărut din layout-urile paginilor.
    await this.deps.bus?.emit({ name: "layout.updated", payload: { plugin: key }, tags: ["layout"] });
    await this.deps.notify();
  }

  // ─── Jurnalul și joburile ───

  /** O intrare în jurnalul pluginului; păstrează doar ultimele `MAX_LOGS`. */
  async log(key: string, level: "info" | "warn" | "error", message: string, hook?: string | null, durationMs?: number | null): Promise<void> {
    const { db } = this.deps;
    try {
      const entry = await db.pluginLog.create({
        data: { pluginKey: key, level, message: message.slice(0, 1000), hook: hook ?? null, durationMs: durationMs ?? null },
        select: { id: true },
      });
      if (entry.id % 25 === 0) await db.pluginLog.deleteMany({ where: { pluginKey: key, id: { lte: entry.id - MAX_LOGS } } });
    } catch {
      // Pluginul a fost șters între timp: jurnalul nu mai are unde scrie.
    }
  }

  /** Joburile periodice ale pluginului: programate cât e activ, șterse altfel. */
  async syncSchedulers(key: string, manifest: GcsPluginManifest | null): Promise<void> {
    const { jobs } = this.deps;
    const wanted = new Map((manifest?.jobs ?? []).filter((j) => j.everyMinutes).map((j) => [pluginSchedulerId(key, j.key), j]));
    try {
      for (const id of await jobs.schedulerIds(`plugin-${key}-`)) if (!wanted.has(id)) await jobs.removeScheduler(id);
      for (const [id, j] of wanted) await jobs.upsertScheduler(id, j.everyMinutes! * 60_000, { name: PLUGIN_JOB, data: { plugin: key, job: j.key } });
    } catch (error) {
      await this.log(key, "warn", `job scheduling failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Textele pluginului (`lang/*.json` din arhiva instalată), pentru paginile ACP ale unui plugin neîncărcat. */
  async langs(key: string): Promise<Record<string, Record<string, unknown>>> {
    const row = await this.deps.db.plugin.findUnique({ where: { key }, select: { package: true } });
    return row?.package ? langsOf(readPluginZip(Buffer.from(row.package))) : {};
  }

  /** Arhiva instalată a unui plugin, citită (pentru pagina lui: fișierele). */
  async packageFiles(key: string): Promise<{ path: string; size: number }[]> {
    const row = await this.deps.db.plugin.findUnique({ where: { key }, select: { package: true } });
    if (!row?.package) return [];
    return [...readPluginZip(Buffer.from(row.package))].map(([path, d]) => ({ path, size: d.length })).sort((a, b) => a.path.localeCompare(b.path));
  }
}

/** Fișierele de limbă dintr-o arhivă citită (validate la încărcare; unul stricat se ignoră). */
function langsOf(files: ReadonlyMap<string, Buffer>): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [path, data] of files) {
    const m = /^lang\/([a-z]{2})\.json$/.exec(path);
    if (!m) continue;
    try {
      out[m[1]!] = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
    } catch {
      // Ignorat.
    }
  }
  return out;
}

export type GcsPluginHookKind = "event" | "filter" | "hook" | "widget" | "page" | "acp" | "api" | "job" | "menu";

/** Toate hook-urile unui plugin, cu prioritatea din manifest (pagina Hook-uri, comutatoarele și ordinea). */
export function pluginHooks(m: GcsPluginManifest): { kind: GcsPluginHookKind; hook: string; priority: number }[] {
  const out: { kind: GcsPluginHookKind; hook: string; priority: number }[] = [];
  for (const e of m.events) out.push({ kind: "event", hook: e, priority: PLUGIN_DEFAULT_PRIORITY });
  for (const f of m.filters) out.push({ kind: "filter", hook: f.point, priority: f.priority ?? PLUGIN_DEFAULT_PRIORITY });
  for (const h of m.hooks) out.push({ kind: "hook", hook: h.point, priority: h.priority ?? PLUGIN_DEFAULT_PRIORITY });
  for (const w of m.widgets) out.push({ kind: "widget", hook: `widget:${w.key}`, priority: PLUGIN_DEFAULT_PRIORITY });
  for (const p of m.routes.pages) out.push({ kind: "page", hook: `page:${p.path}`, priority: PLUGIN_DEFAULT_PRIORITY });
  for (const p of m.routes.acp) out.push({ kind: "acp", hook: `acp:${p.path}`, priority: PLUGIN_DEFAULT_PRIORITY });
  for (const p of m.routes.api) out.push({ kind: "api", hook: `api:${p.path}`, priority: PLUGIN_DEFAULT_PRIORITY });
  for (const j of m.jobs) out.push({ kind: "job", hook: `job:${j.key}`, priority: PLUGIN_DEFAULT_PRIORITY });
  for (const e of m.menus.site) out.push({ kind: "menu", hook: `menu.site:${e.key}`, priority: PLUGIN_DEFAULT_PRIORITY });
  for (const e of m.menus.user) out.push({ kind: "menu", hook: `menu.user:${e.key}`, priority: PLUGIN_DEFAULT_PRIORITY });
  return out;
}
