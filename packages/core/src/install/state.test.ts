import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { testRedis } from "../../test/redis";
import { GcsRedisRateLimiter } from "../auth/rateLimit";
import { GcsRateLimited } from "../errors";
import { ensureInstallCode, GcsInstallState, installGate, verifyInstallCode } from "./state";

let dir: string;
const redis = testRedis();
const limiter = new GcsRedisRateLimiter(redis);

beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "gcs-install-"));
  await redis.flushdb();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

afterAll(() => {
  redis.disconnect();
});

describe("GcsInstallState (Review Focus #3)", () => {
  test("acquireRunLock() de două ori → true, apoi false; după release se poate lua din nou", async () => {
    const state = new GcsInstallState(dir);
    await expect(state.acquireRunLock()).resolves.toBe(true);
    await expect(new GcsInstallState(dir).acquireRunLock()).resolves.toBe(false);
    await state.releaseRunLock();
    await expect(state.acquireRunLock()).resolves.toBe(true);
  });

  test("după markInstalled(), isInstalled() → true", async () => {
    const state = new GcsInstallState(dir);
    await expect(state.isInstalled()).resolves.toBe(false);
    await state.markInstalled();
    await expect(new GcsInstallState(dir).isInstalled()).resolves.toBe(true);
  });

  test("saveStep('site', …), apoi o instanță nouă → progress().step === 'site'", async () => {
    await new GcsInstallState(dir).saveStep("site", { siteName: "RED-LINE" });
    const progress = await new GcsInstallState(dir).progress();
    expect(progress.step).toBe("site");
    expect(progress.data).toMatchObject({ site: { siteName: "RED-LINE" } });
  });

  test("fără progres salvat, instalarea începe cu pasul 'code'", async () => {
    await expect(new GcsInstallState(dir).progress()).resolves.toEqual({ step: "code", data: {} });
  });

  test("progress nu conține parola; secretele merg în .env.runtime (0600)", async () => {
    const state = new GcsInstallState(dir);
    await state.saveStep("database", { host: "postgres", password: "x" });
    const progress = await state.progress();
    expect(progress.data).toEqual({ database: { host: "postgres" } });
    expect(readFileSync(path.join(dir, "install_progress.json"), "utf8")).not.toContain('"password"');

    const env = readFileSync(path.join(dir, ".env.runtime"), "utf8");
    expect(env).toContain("GCS_INSTALL_DATABASE_PASSWORD=x");
    if (process.platform !== "win32") expect(statSync(path.join(dir, ".env.runtime")).mode & 0o777).toBe(0o600);
    await expect(state.secret("database", "password")).resolves.toBe("x");
  });
});

describe("sesiunea wizard-ului și tokenul de final", () => {
  test("sesiunea: tokenul corect trece, altul sau lipsa nu; o sesiune nouă o anulează pe veche", async () => {
    const state = new GcsInstallState(dir);
    const token = await state.createInstallSession();
    await expect(state.verifyInstallSession(token)).resolves.toBe(true);
    await expect(state.verifyInstallSession("altceva")).resolves.toBe(false);
    await expect(state.verifyInstallSession(undefined)).resolves.toBe(false);
    const next = await state.createInstallSession();
    await expect(state.verifyInstallSession(token)).resolves.toBe(false);
    await expect(state.verifyInstallSession(next)).resolves.toBe(true);
  });

  test("tokenul de final se poate folosi o singură dată", async () => {
    const state = new GcsInstallState(dir);
    const token = await state.createFinishToken("admin@example.com");
    await expect(state.consumeFinishToken("gresit")).resolves.toBeNull();
    await expect(state.consumeFinishToken(token)).resolves.toBe("admin@example.com");
    await expect(state.consumeFinishToken(token)).resolves.toBeNull();
  });

  test("clearInstallSecrets șterge doar secretele wizard-ului", async () => {
    const state = new GcsInstallState(dir);
    await state.saveStep("database", { password: "x" });
    await state.writeSecrets({ DATABASE_URL: "postgresql://a:b@c/d" });
    await state.clearInstallSecrets();
    await expect(state.readSecrets()).resolves.toEqual({ DATABASE_URL: "postgresql://a:b@c/d" });
  });

  test("advance mută pasul curent fără să piardă datele", async () => {
    const state = new GcsInstallState(dir);
    await state.saveStep("site", { siteName: "X" });
    await state.advance("email");
    await expect(state.progress()).resolves.toEqual({ step: "email", data: { site: { siteName: "X" } } });
  });
});

describe("codul de instalare", () => {
  test("ensureInstallCode: primul apel întoarce codul (și îl scrie în log), al doilea → null", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await ensureInstallCode(dir);
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(log).toHaveBeenCalledWith(`[GCS] Cod de instalare: ${code}`);
    await expect(ensureInstallCode(dir)).resolves.toBeNull();
    expect(readFileSync(path.join(dir, "install_code.hash"), "utf8")).toMatch(/^\$argon2id\$/);
  });

  test("verifyInstallCode: corect → true, greșit → false, a 6-a încercare → GcsRateLimited", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const code = (await ensureInstallCode(dir))!;
    const opts = { ip: "203.0.113.9", limiter };
    await expect(verifyInstallCode(dir, code.toLowerCase().replace(/-/g, " "), opts)).resolves.toBe(true);
    for (let i = 0; i < 4; i++) await expect(verifyInstallCode(dir, "AAAA-AAAA-AAAA", opts)).resolves.toBe(false);
    await expect(verifyInstallCode(dir, code, opts)).rejects.toBeInstanceOf(GcsRateLimited);
    // Alt IP nu e afectat.
    await expect(verifyInstallCode(dir, code, { ip: "203.0.113.10", limiter })).resolves.toBe(true);
  });
});

describe("installGate", () => {
  test("neinstalat: totul redirecționează la /install, în afară de /install*, /api/health și asset-uri", () => {
    expect(installGate("/", false)).toBe("redirect");
    expect(installGate("/admin", false)).toBe("redirect");
    expect(installGate("/install", false)).toBe("pass");
    expect(installGate("/install/database", false)).toBe("pass");
    expect(installGate("/api/health", false)).toBe("pass");
    expect(installGate("/api/internal/cli", false)).toBe("pass");
    expect(installGate("/_next/static/chunk.js", false)).toBe("pass");
    expect(installGate("/installer-fals", false)).toBe("redirect");
  });

  test("instalat: /install* → 404, restul trece", () => {
    expect(installGate("/install", true)).toBe("not_found");
    expect(installGate("/install/run", true)).toBe("not_found");
    expect(installGate("/", true)).toBe("pass");
  });
});
