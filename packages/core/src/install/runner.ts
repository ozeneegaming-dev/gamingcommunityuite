import { createPrismaClient, gcsDbDialect } from "@gcs/db";
import { migrateDatabase } from "@gcs/db/migrate";
import pg from "pg";
import { prepareNewUser } from "../auth/registration";
import { normalizeEmail } from "../auth/usernames";
import type { GcsCache } from "../cache";
import type { GcsEventBus } from "../events";
import { compileNameStylesCss, type GcsNameStyle } from "../groups/nameStyles";
import type { GcsModuleRegistry } from "../modules/registry";
import type { GcsActor } from "../permissions/types";
import { APPS_LANDING_SETTING } from "../apps/service";
import { GcsSettingsService } from "../settings/service";
import { applyAppSelection, landingSettingValue, type GcsAppSelection } from "./apps";
import { seedDefaults } from "./seed";
import type { GcsInstallState } from "./state";

export type GcsDbConnection = { host: string; port: number; user: string; password: string; database: string };

export type GcsTestDatabaseResult =
  | { ok: true; created: boolean }
  | { ok: false; errorKey: "db_unreachable" | "db_auth" | "db_no_create_privilege" | "db_missing_extensions" };

const TIMEOUT_MS = 5000;
const EXTENSIONS = ["unaccent", "pg_trgm"];

/** Construiește URL-ul PostgreSQL pentru o conexiune introdusă în wizard. */
export function databaseUrlFor(conn: GcsDbConnection): string {
  const url = new URL("postgresql://localhost");
  url.hostname = conn.host;
  url.port = String(conn.port);
  url.username = conn.user;
  url.password = conn.password;
  url.pathname = `/${conn.database}`;
  return url.toString();
}

function pgError(error: unknown): "db_unreachable" | "db_auth" {
  const code = (error as { code?: string }).code;
  // 28P01: parolă greșită; 28000: autentificare refuzată (pg_hba).
  return code === "28P01" || code === "28000" ? "db_auth" : "db_unreachable";
}

/**
 * Pasul „Baza de date” (spec §17.1): conectare la baza `postgres`, crearea bazei dacă lipsește,
 * apoi extensiile `unaccent` și `pg_trgm`. Întoarce cheia erorii (tradusă în wizard).
 */
export async function testDatabase(conn: GcsDbConnection): Promise<GcsTestDatabaseResult> {
  const maintenance = new pg.Client({ connectionString: databaseUrlFor({ ...conn, database: "postgres" }), connectionTimeoutMillis: TIMEOUT_MS });
  maintenance.on("error", () => {});
  let created = false;
  try {
    await maintenance.connect();
  } catch (error) {
    return { ok: false, errorKey: pgError(error) };
  }
  try {
    const exists = await maintenance.query("SELECT 1 FROM pg_database WHERE datname = $1", [conn.database]);
    if (exists.rowCount === 0) {
      try {
        await maintenance.query(`CREATE DATABASE "${conn.database.replace(/"/g, '""')}"`);
        created = true;
      } catch {
        return { ok: false, errorKey: "db_no_create_privilege" };
      }
    }
  } finally {
    await maintenance.end().catch(() => {});
  }

  const target = new pg.Client({ connectionString: databaseUrlFor(conn), connectionTimeoutMillis: TIMEOUT_MS });
  target.on("error", () => {});
  try {
    await target.connect();
  } catch (error) {
    return { ok: false, errorKey: pgError(error) };
  }
  try {
    for (const ext of EXTENSIONS) await target.query(`CREATE EXTENSION IF NOT EXISTS ${ext}`);
    return { ok: true, created };
  } catch {
    return { ok: false, errorKey: "db_missing_extensions" };
  } finally {
    await target.end().catch(() => {});
  }
}

export type GcsInstallInput = {
  site: { name: string; url: string; locale: string; timezone: string };
  email?: { host: string; port: number; user: string; pass: string; from: string };
  /** Parola adminului ajunge aici deja ca hash Argon2 (nu stă niciodată în clar pe disc). */
  admin: { name: string; email: string; passwordHash: string };
  data: "demo" | "empty" | "import";
  /** Aplicațiile alese în wizard (pornite / oprite, pornirea). Fără ea, aplicațiile rămân cu starea implicită din seed. */
  apps?: GcsAppSelection;
  /** Tokenul licenței (verificat la pasul „Licență”); se păstrează doar pe server, în folderul de configurare (0600). */
  license?: string;
};

export const GCS_INSTALL_RUN_STEPS = ["migrate", "seed", "settings", "apps", "admin", "demo", "name_styles", "search_indexes", "lock"] as const;
export type GcsInstallRunStep = (typeof GCS_INSTALL_RUN_STEPS)[number];

export type GcsInstallDeps = {
  databaseUrl: string;
  migrationsDir: string;
  registry: GcsModuleRegistry;
  cache: GcsCache;
  bus: GcsEventBus;
  state: GcsInstallState;
  /** Apelat înaintea fiecărui pas (folosit în teste pentru a simula un eșec). */
  beforeStep?: (step: GcsInstallRunStep) => void | Promise<void>;
};

/** Actorul pașilor de instalare (în jurnal apare fără user, cu IP-ul `install`). */
const INSTALL_ACTOR: GcsActor = { userId: null, groupIds: [], primaryGroupId: 0, isBanned: false, ip: "install" };

/**
 * Rularea instalării (spec §17.1). Fiecare pas e idempotent: după o eroare, o rulare nouă reia totul
 * fără duplicate (ex. adminul se caută după email înainte de a fi creat).
 */
export async function runInstall(
  input: GcsInstallInput,
  onProgress: (e: { stepKey: GcsInstallRunStep; pct: number }) => void,
  deps: GcsInstallDeps,
): Promise<void> {
  const db = createPrismaClient(deps.databaseUrl);
  const total = GCS_INSTALL_RUN_STEPS.length;
  try {
    const steps: Record<GcsInstallRunStep, () => Promise<void>> = {
      migrate: async () => {
        await migrateDatabase(deps.databaseUrl, deps.migrationsDir);
      },
      seed: () => seedDefaults(db, deps.registry),
      settings: async () => {
        const settings = new GcsSettingsService({ db, cache: deps.cache, bus: deps.bus, registry: deps.registry });
        const values: Record<string, unknown> = {
          "site.name": input.site.name,
          "site.url": input.site.url,
          "site.locale": input.site.locale,
          "site.timezone": input.site.timezone,
        };
        if (input.email?.host) {
          Object.assign(values, {
            "email.smtp_host": input.email.host,
            "email.smtp_port": input.email.port,
            "email.smtp_user": input.email.user,
            "email.from": input.email.from,
          });
          if (input.email.pass) values["email.smtp_pass"] = input.email.pass;
        }
        for (const [key, value] of Object.entries(values)) {
          if (JSON.stringify(await settings.get(key)) !== JSON.stringify(value)) await settings.set(key, value, INSTALL_ACTOR);
        }
      },
      // Aplicațiile nebifate rămân instalate (tabelele există), dar oprite; se pornesc din ACP › Aplicații.
      apps: async () => {
        if (!input.apps) return;
        await applyAppSelection(db, input.apps);
        if (deps.registry.settingDef(APPS_LANDING_SETTING)) {
          const settings = new GcsSettingsService({ db, cache: deps.cache, bus: deps.bus, registry: deps.registry });
          const landing = landingSettingValue(deps.registry, input.apps.landing);
          if ((await settings.get(APPS_LANDING_SETTING)) !== landing) await settings.set(APPS_LANDING_SETTING, landing, INSTALL_ACTOR);
        }
        await deps.cache.invalidateTags(["apps", "nav", "layout"]);
      },
      admin: async () => {
        const root = await db.group.findUniqueOrThrow({ where: { key: "root_admin" } });
        const email = normalizeEmail(input.admin.email);
        const existing = await db.user.findUnique({ where: { email } });
        if (existing) {
          if (existing.primaryGroupId !== root.id) await db.user.update({ where: { id: existing.id }, data: { primaryGroupId: root.id } });
          return;
        }
        const data = await prepareNewUser(db, { name: input.admin.name, email }, { emailConfirm: false });
        await db.$transaction(async (tx) => {
          const user = await tx.user.create({ data: { ...data, primaryGroupId: root.id, emailVerified: true } });
          await tx.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: input.admin.passwordHash } });
        });
      },
      // Conținutul de pornire ales în wizard; importul din altă platformă (etapa de migrare) pornește deocamdată de la un site gol.
      demo: async () => {
        const variant = input.data === "demo" ? "demo" : "empty";
        for (const m of deps.registry.all()) {
          await m.seedDemo?.({ db, cache: deps.cache, bus: deps.bus, registry: deps.registry, variant, adminEmail: normalizeEmail(input.admin.email) });
        }
      },
      name_styles: async () => {
        const groups = await db.group.findMany({ select: { key: true, color: true, nameStyle: true }, orderBy: { position: "asc" } });
        const css = compileNameStylesCss(groups.map((g) => ({ ...g, nameStyle: (g.nameStyle as GcsNameStyle | null) ?? null })));
        await deps.cache.invalidateTags(["name-styles"]);
        await deps.cache.set("name-styles:css", css, { ttlSec: 3600, tags: ["name-styles"] });
      },
      search_indexes: async () => {
        // MySQL: indexurile FULLTEXT vin din migrația de bază; extensiile și indexul trigram sunt doar PostgreSQL.
        if (gcsDbDialect(deps.databaseUrl) === "mysql") return;
        for (const ext of EXTENSIONS) await db.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS ${ext}`);
        await db.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS "users_nameNormalized_trgm_idx" ON "users" USING gin ("nameNormalized" gin_trgm_ops)`,
        );
      },
      lock: async () => {
        if (input.license) await deps.state.saveLicense(input.license);
        await deps.state.markInstalled();
      },
    };

    for (const [index, step] of GCS_INSTALL_RUN_STEPS.entries()) {
      await deps.beforeStep?.(step);
      await steps[step]();
      onProgress({ stepKey: step, pct: Math.round(((index + 1) / total) * 100) });
    }
  } finally {
    await db.$disconnect();
  }
}
