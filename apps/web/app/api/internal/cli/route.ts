import {
  checkHealth,
  GcsError,
  hashPassword,
  normalizeEmail,
  resetRootPassword,
  validateUsername,
  type GcsActor,
  type GcsInstallInput,
} from "@gcs/core";
import { CLI_TOKEN_HEADER, isValidCliToken } from "@/lib/cli-token";
import { INSTALL_VERSION, installState } from "@/lib/install";
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
  if (Object.keys(errors).length > 0) return { ok: false, fields: errors };

  const input: GcsInstallInput = {
    site: { name: siteName, url: siteUrl, locale: str(args.locale) === "en" ? "en" : "ro", timezone: str(args.timezone) || "Europe/Bucharest" },
    admin: { name: adminName, email: adminEmail, passwordHash: await hashPassword(adminPassword) },
    data: str(args.data) === "empty" ? "empty" : "demo",
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
        const { db, redis } = services();
        const health = await checkHealth({ db, redis });
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

      case "site-name":
        return Response.json({ siteName: await services().settings.get<string>("site.name") });

      default:
        return fail(400, "unknown_command");
    }
  } catch (error) {
    if (error instanceof GcsError) return fail(error.status, error.code, { params: error.params ?? {} });
    console.error("[RED-LINE] Comanda CLI a eșuat", error);
    return fail(500, "internal", { message: error instanceof Error ? error.message : String(error) });
  }
}
