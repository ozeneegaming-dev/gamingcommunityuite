import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { GCS_PREMIUM_APPS } from "./apps";
import {
  activateLicenseKey,
  checkLicenseOnline,
  installDomain,
  licenseActivationServer,
  licenseServerFor,
  normalizeLicenseKey,
  verifyLicense,
  type GcsLicense,
  type GcsLicenseActivationError,
  type GcsLicenseOnlineResult,
} from "./license";
import type { GcsInstallState } from "./state";

/** Cât rămân pornite aplicațiile premium după ce platforma-mamă declară licența invalidă. */
export const GCS_LICENSE_GRACE_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * Starea verificării online, în folderul de configurare (lângă licență): rezultatul ultimei verificări, de când e
 * licența invalidă (`invalidSince`, primul răspuns „invalid”) și identificatorul instanței (trimis platformei-mamă).
 */
export type GcsLicenseOnlineState = {
  instanceUuid: string;
  /** `valid`, un motiv de invaliditate (`revoked`, `suspended`, `expired`, `domain`…), `unreachable`, `disabled`. */
  status: string;
  checkedAt: string | null;
  /** ISO: prima verificare care a găsit licența invalidă; `null` cât e validă (sau neverificată). */
  invalidSince: string | null;
  /** ISO: ultima dată când platforma-mamă a trimis un token nou (păstrat după verificarea offline). */
  tokenUpdatedAt: string | null;
};

const FILE = "license_online.json";

export type GcsLicenseKeyActivation =
  | { ok: true; key: string; token: string; license: GcsLicense }
  | { ok: false; error: GcsLicenseActivationError };

/**
 * Verificarea zilnică a licenței la platforma-mamă (Data Center): doar pentru licențele emise de ea
 * (`licenseServerFor`). O licență declarată invalidă păstrează aplicațiile premium încă `GCS_LICENSE_GRACE_DAYS` zile
 * (avertisment în ACP), apoi le oprește; forumul și restul aplicațiilor merg mai departe. Un Data Center indisponibil
 * nu schimbă nimic. Un token nou (ex. după prelungire) se verifică offline și, dacă e valid pentru domeniu, înlocuiește
 * licența salvată.
 */
export class GcsLicenseOnline {
  constructor(
    private readonly deps: {
      configDir: string;
      state: GcsInstallState;
      version?: string;
      edition?: string;
      check?: typeof checkLicenseOnline;
      activate?: typeof activateLicenseKey;
      now?: () => number;
      env?: NodeJS.ProcessEnv;
    },
  ) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private file(): string {
    return path.join(this.deps.configDir, FILE);
  }

  async read(): Promise<GcsLicenseOnlineState | null> {
    try {
      const parsed = JSON.parse(await readFile(this.file(), "utf8")) as Partial<GcsLicenseOnlineState>;
      if (typeof parsed.instanceUuid !== "string") return null;
      return {
        instanceUuid: parsed.instanceUuid,
        status: typeof parsed.status === "string" ? parsed.status : "disabled",
        checkedAt: parsed.checkedAt ?? null,
        invalidSince: parsed.invalidSince ?? null,
        tokenUpdatedAt: parsed.tokenUpdatedAt ?? null,
      };
    } catch {
      return null;
    }
  }

  private async write(next: GcsLicenseOnlineState): Promise<void> {
    await mkdir(this.deps.configDir, { recursive: true });
    const tmp = `${this.file()}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    await rename(tmp, this.file());
  }

  private fresh(): GcsLicenseOnlineState {
    return { instanceUuid: randomUUID(), status: "disabled", checkedAt: null, invalidSince: null, tokenUpdatedAt: null };
  }

  /**
   * Activarea unei chei scurte (installer-ul și ACP › Sistem › Licență): Data Center-ul dă tokenul semnat, verificat
   * aici offline pentru domeniul instalării. Activarea trimite identificatorul instanței (același ca verificările
   * zilnice); reușita pornește starea online de la „validă”, fără perioadă de grație. Nimic nu salvează licența:
   * apelantul păstrează tokenul (și cheia).
   */
  async activate(input: string): Promise<GcsLicenseKeyActivation> {
    const key = normalizeLicenseKey(input);
    if (!key) return { ok: false, error: "format" };
    const env = this.deps.env ?? process.env;
    const domain = installDomain(env);
    const prev = (await this.read()) ?? this.fresh();
    const result = await (this.deps.activate ?? activateLicenseKey)(key, {
      domain,
      server: licenseActivationServer(env),
      instanceUuid: prev.instanceUuid,
      ...(this.deps.version ? { version: this.deps.version } : {}),
      ...(this.deps.edition ? { edition: this.deps.edition } : {}),
    });
    if (!result.ok) return result;
    const offline = verifyLicense(result.token, { domain, premiumApps: GCS_PREMIUM_APPS });
    if (!offline.ok || offline.license.dev) return { ok: false, error: "invalid_token" };
    const at = new Date(this.now()).toISOString();
    await this.write({ ...prev, status: "valid", checkedAt: at, invalidSince: null, tokenUpdatedAt: at });
    return { ok: true, key, token: result.token, license: offline.license };
  }

  /** O verificare (jobul zilnic). Întoarce starea nouă sau `null` fără licență (încă neinstalat). */
  async run(): Promise<GcsLicenseOnlineState | null> {
    const token = await this.deps.state.readLicense();
    if (!token) return null;
    const env = this.deps.env ?? process.env;
    const domain = installDomain(env);
    const prev = (await this.read()) ?? this.fresh();
    const offline = verifyLicense(token, { domain, premiumApps: GCS_PREMIUM_APPS });
    const server = licenseServerFor(token, env);
    if ((offline.ok && offline.license.dev) || !server) {
      // Licența de test sau una emisă offline: nimic de verificat online (și nimic de oprit).
      const next = { ...prev, status: "disabled", checkedAt: new Date(this.now()).toISOString(), invalidSince: null };
      await this.write(next);
      return next;
    }
    const result: GcsLicenseOnlineResult = await (this.deps.check ?? checkLicenseOnline)(token, {
      domain,
      server,
      instanceUuid: prev.instanceUuid,
      ...(this.deps.version ? { version: this.deps.version } : {}),
      ...(this.deps.edition ? { edition: this.deps.edition } : {}),
    });
    const at = new Date(this.now()).toISOString();
    let next: GcsLicenseOnlineState;
    if (result.status === "valid") {
      next = { ...prev, status: "valid", checkedAt: at, invalidSince: null };
      if (result.token && result.token !== token && verifyLicense(result.token, { domain, premiumApps: GCS_PREMIUM_APPS }).ok) {
        await this.deps.state.saveLicense(result.token);
        next.tokenUpdatedAt = at;
      }
    } else if (result.status === "revoked") {
      next = { ...prev, status: result.reason ?? "revoked", checkedAt: at, invalidSince: prev.invalidSince ?? at };
    } else {
      // Indisponibil: starea de dinainte rămâne (inclusiv o perioadă de grație deja începută).
      next = { ...prev, status: prev.invalidSince ? prev.status : "unreachable", checkedAt: at };
    }
    await this.write(next);
    return next;
  }

  /**
   * Un token mai nou primit de la Data Center pe altă cale decât verificarea zilnică (ex. Marketplace-ul, după o aplicație
   * premium cumpărată): păstrat doar dacă e valid offline pentru domeniul instalării și e al aceleiași licențe.
   * `true` dacă a înlocuit licența salvată.
   */
  async adopt(token: string): Promise<boolean> {
    const env = this.deps.env ?? process.env;
    const domain = installDomain(env);
    const current = await this.deps.state.readLicense();
    if (!current || current === token) return false;
    const before = verifyLicense(current, { domain, premiumApps: GCS_PREMIUM_APPS });
    const next = verifyLicense(token, { domain, premiumApps: GCS_PREMIUM_APPS });
    if (!next.ok || next.license.dev || (before.ok && before.license.id !== next.license.id)) return false;
    await this.deps.state.saveLicense(token);
    const prev = (await this.read()) ?? this.fresh();
    await this.write({ ...prev, tokenUpdatedAt: new Date(this.now()).toISOString() });
    return true;
  }

  /** Până când rămân pornite aplicațiile premium (`null` = licența nu e declarată invalidă). */
  graceEndsAt(state: GcsLicenseOnlineState | null): Date | null {
    if (!state?.invalidSince) return null;
    return new Date(Date.parse(state.invalidSince) + GCS_LICENSE_GRACE_DAYS * DAY_MS);
  }

  /** Aplicațiile premium sunt oprite: licența e invalidă de mai mult de `GCS_LICENSE_GRACE_DAYS` zile. */
  async premiumBlocked(): Promise<boolean> {
    const ends = this.graceEndsAt(await this.read());
    return ends !== null && this.now() >= ends.getTime();
  }
}
