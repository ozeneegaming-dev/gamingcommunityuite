import {
  checkHealth,
  GcsError,
  hashPassword,
  installAppChoices,
  normalizeEmail,
  resolveAppSelection,
  resetRootPassword,
  validateUsername,
  type GcsActor,
  type GcsInstallInput,
} from "@gcs/core";
import { CLI_TOKEN_HEADER, isValidCliToken } from "@/lib/cli-token";
import { INSTALL_VERSION, installState, verifyInstallLicense } from "@/lib/install";
import { performInstall } from "@/lib/install-run";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

/** Actorul comenzilor din consolă (în jurnal apare fără user, cu IP-ul `cli`). */
const CLI_ACTOR: GcsActor = { userId: null, groupIds: [], primaryGroupId: 0, isBanned: false, ip: "cli" };

type Body = { command?: string; args?: Record<string, unknown> };
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => Response.json({ error, ...extra }, { status });

/** Datele instalării din CLI (`gcs install`), validate ca în wizard. */
async function cliInstallInput(
  args: Record<string, unknown>,
): Promise<{ ok: true; input: GcsInstallInput } | { ok: false; fields: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const siteName = str(args.siteName);
  const siteUrl = str(args.siteUrl);
  const adminName = str(args.adminName);
  const adminEmail = normalizeEmail(str(args.adminEmail));
  const adminPassword = typeof args.adminPassword === "string" ? args.adminPassword : "";
  if (!siteName) errors.siteName = "required";
  if (siteUrl && !URL.canParse(siteUrl)) errors.siteUrl = "invalid_url";
  const nameError = validateUsername(adminName);
  if (nameError) errors.adminName = nameError;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) errors.adminEmail = "email_invalid";
  if (adminPassword.length < 8) errors.adminPassword = "password_too_short";
  // Licența, ca la pasul „Licență” din wizard; aplicațiile: toate cele permise (sau lista dată), Forumul ca pornire implicită.
  const licenseToken = str(args.license);
  const licensed = verifyInstallLicense(licenseToken);
  if (!licensed.ok) errors.license = `license_${licensed.error}`;
  if (Object.keys(errors).length > 0 || !licensed.ok) return { ok: false, fields: errors };
  const { registry } = services();
  const wanted = str(args.apps);
  const selected = wanted ? wanted.split(",").map((k) => k.trim()).filter(Boolean) : installAppChoices(registry, licensed.license).filter((c) => c.available).map((c) => c.key);
  const apps = resolveAppSelection(registry, licensed.license, { selected, landing: str(args.landing) });
  if (!apps.ok) return { ok: false, fields: { apps: `apps_${apps.error}` } };

  const input: GcsInstallInput = {
    site: { name: siteName, url: siteUrl, locale: str(args.locale) === "en" ? "en" : "ro", timezone: str(args.timezone) || "Europe/Bucharest" },
    admin: { name: adminName, email: adminEmail, passwordHash: await hashPassword(adminPassword) },
    data: str(args.data) === "empty" ? "empty" : "demo",
    apps: apps.selection,
    license: licenseToken,
  };
  if (str(args.smtpHost)) {
    input.email = {
      host: str(args.smtpHost),
      port: Number(args.smtpPort) || 587,
      user: str(args.smtpUser),
      pass: typeof args.smtpPass === "string" ? args.smtpPass : "",
      from: str(args.smtpFrom),
    };
  }
  return { ok: true, input };
}

/**
 * Endpoint-ul intern al CLI-ului `gcs` (rulat în containerul `web`: `docker compose exec web node …/gcs.mjs`).
 * Autentificare: HMAC din `GCS_SECRET`; în plus, Caddy nu expune `/api/internal/*` în internet.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isValidCliToken(request.headers.get(CLI_TOKEN_HEADER), process.env.GCS_SECRET)) return fail(403, "forbidden");
  const body = (await request.json().catch(() => ({}))) as Body;
  const args = body.args ?? {};
  const state = installState();

  try {
    switch (body.command) {
      case "status": {
        const installed = await state.isInstalled();
        const { db, kv } = services();
        const health = await checkHealth({ db, kv });
        return Response.json({ installed, version: INSTALL_VERSION, health });
      }

      case "install": {
        if (await state.isInstalled()) return fail(409, "installed");
        const parsed = await cliInstallInput(args);
        if (!parsed.ok) return fail(422, "validation", { fields: parsed.fields });
        const { input } = parsed;
        const databaseUrl = str(args.databaseUrl) || process.env.DATABASE_URL;
        if (!databaseUrl) return fail(422, "validation", { fields: { databaseUrl: "required" } });
        if (!(await state.acquireRunLock())) return fail(409, "busy");
        try {
          const steps: string[] = [];
          await performInstall({ input, databaseUrl, external: Boolean(str(args.databaseUrl)), onProgress: (e) => steps.push(e.stepKey) });
          return Response.json({ installed: true, steps });
        } finally {
          await state.releaseRunLock();
        }
      }

      case "reset-admin-password": {
        const password = await resetRootPassword(services().db, str(args.name));
        return Response.json({ password });
      }

      case "maintenance": {
        await services().settings.set("system.maintenance", args.on === true, CLI_ACTOR);
        return Response.json({ maintenance: args.on === true });
      }

      case "plugins-list": {
        const list = await services().pluginAdmin.list();
        return Response.json({
          plugins: list.map((p) => ({ key: p.key, version: p.version, enabled: p.enabled, status: p.status, signed: p.signed, disabledReason: p.disabledReason })),
        });
      }

      case "plugins-disable-all":
        return Response.json({ disabled: await services().pluginAdmin.disableAll(CLI_ACTOR, "cli") });

      case "site-name":
        return Response.json({ siteName: await services().settings.get<string>("site.name") });

      default:
        return fail(400, "unknown_command");
    }
  } catch (error) {
    if (error instanceof GcsError) return fail(error.status, error.code, { params: error.params ?? {} });
    console.error("[GCS] Comanda CLI a eșuat", error);
    return fail(500, "internal", { message: error instanceof Error ? error.message : String(error) });
  }
}
