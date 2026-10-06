import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { GcsInstallState, normalizeUsername, verifyPassword } from "@gcs/core";
import { truncateAll } from "@gcs/db/test/helpers";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "vitest";
import { POST } from "../app/api/internal/cli/route";
import { CLI_TOKEN_HEADER, cliToken } from "../lib/cli-token";
import { resetServices, services } from "../lib/services";
import { HELP, runCli, type GcsCliIo, type GcsCliResponse } from "./gcs";

const SECRET = "secret-de-test-pentru-cli";
let dir: string;
let lines: { out: string[]; err: string[] };
const previousConfigDir = process.env.GCS_CONFIG_DIR;
const previousSecret = process.env.GCS_SECRET;

/** I/O cu cererile trimise direct handler-ului real (`/api/internal/cli`). */
function io(env: Record<string, string> = {}): GcsCliIo {
  return {
    async request(command, args = {}): Promise<GcsCliResponse> {
      const res = await POST(
        new Request("http://localhost/api/internal/cli", {
          method: "POST",
          headers: { "content-type": "application/json", [CLI_TOKEN_HEADER]: cliToken(SECRET) },
          body: JSON.stringify({ command, args }),
        }),
      );
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    },
    out: (l) => lines.out.push(l),
    err: (l) => lines.err.push(l),
    env,
  };
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "gcs-cli-"));
  process.env.GCS_CONFIG_DIR = dir;
  process.env.GCS_SECRET = SECRET;
  lines = { out: [], err: [] };
  const { db, redis } = services();
  await truncateAll(db);
  await redis.flushdb();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

afterAll(async () => {
  if (previousConfigDir === undefined) delete process.env.GCS_CONFIG_DIR;
  else process.env.GCS_CONFIG_DIR = previousConfigDir;
  if (previousSecret === undefined) delete process.env.GCS_SECRET;
  else process.env.GCS_SECRET = previousSecret;
  // Serviciile sunt singleton-uri pe proces: le resetăm (nu doar le închidem), ca fișierele următoare să primească altele noi.
  await resetServices();
});

const installEnv = {
  GCS_INSTALL_SITE_NAME: "Comunitatea CLI",
  GCS_INSTALL_SITE_URL: "https://forum.example.com",
  GCS_INSTALL_ADMIN_NAME: "Fondator",
  GCS_INSTALL_ADMIN_EMAIL: "fondator@example.com",
  GCS_INSTALL_ADMIN_PASSWORD: "parola-sigura-123",
};

describe("gcs (CLI)", () => {
  test("fără argumente → exit 2 și ajutorul", async () => {
    await expect(runCli([], io())).resolves.toBe(2);
    expect(lines.err.join("\n")).toContain(HELP);
  });

  test("o comandă necunoscută sau incompletă → exit 2", async () => {
    await expect(runCli(["zbor"], io())).resolves.toBe(2);
    await expect(runCli(["reset-admin-password"], io())).resolves.toBe(2);
    await expect(runCli(["maintenance", "poate"], io())).resolves.toBe(2);
  });

  test("plugins:list și plugins:disable-all (recuperarea după un plugin stricat)", async () => {
    await expect(runCli(["plugins:list"], io())).resolves.toBe(0);
    expect(lines.out).toEqual(["Niciun plugin instalat."]);
    const manifest = { key: "acme.cli", name: "Cli", version: "1.2.0", author: "Acme" };
    await services().db.plugin.create({ data: { key: "acme.cli", name: "Cli", version: "1.2.0", enabled: true, manifest, capabilities: [], migrations: [] } });
    lines.out = [];
    await expect(runCli(["plugins:list"], io())).resolves.toBe(0);
    expect(lines.out.join("\n")).toMatch(/acme\.cli\s+1\.2\.0\s+activ · nesemnat/);
    lines.out = [];
    await expect(runCli(["plugins:disable-all"], io())).resolves.toBe(0);
    expect(lines.out).toEqual(["Dezactivate: acme.cli"]);
    expect(await services().db.plugin.findUnique({ where: { key: "acme.cli" } })).toMatchObject({ enabled: false, disabledReason: "cli" });
    expect(await services().db.auditLog.findFirst({ where: { action: "plugin.disable_all" } })).toMatchObject({ actorId: null, ip: "cli" });
  });

  test("install --non-interactive fără variabile → exit 2, cu lista lor", async () => {
    await expect(runCli(["install", "--non-interactive"], io())).resolves.toBe(2);
    expect(lines.err.join("\n")).toContain("GCS_INSTALL_ADMIN_PASSWORD");
  });

  test("install --non-interactive cu variabilele setate → isInstalled() = true", async () => {
    await expect(runCli(["install", "--non-interactive"], io(installEnv))).resolves.toBe(0);
    await expect(new GcsInstallState(dir).isInstalled()).resolves.toBe(true);
    const { db } = services();
    const admin = await db.user.findUniqueOrThrow({ where: { email: "fondator@example.com" }, include: { primaryGroup: true } });
    expect(admin.primaryGroup.key).toBe("root_admin");
    // A doua instalare e refuzată.
    await expect(runCli(["install", "--non-interactive"], io(installEnv))).resolves.toBe(1);
  });

  test("reset-admin-password pe un user care nu e Root Admin → exit 1 cu mesajul „Doar conturile Root Admin”", async () => {
    await runCli(["install", "--non-interactive"], io(installEnv));
    const { db } = services();
    const member = await db.group.findUniqueOrThrow({ where: { key: "member" } });
    await db.user.create({ data: { name: "Dexter", nameNormalized: normalizeUsername("Dexter"), email: "dexter@example.com", primaryGroupId: member.id } });
    lines = { out: [], err: [] };
    await expect(runCli(["reset-admin-password", "Dexter"], io())).resolves.toBe(1);
    expect(lines.err.join("\n")).toContain("Doar conturile Root Admin");
  });

  test("reset-admin-password pe un Root Admin → parolă nouă verificabilă, 2FA dezactivat, sesiuni șterse", async () => {
    await runCli(["install", "--non-interactive"], io(installEnv));
    const { db } = services();
    const admin = await db.user.findUniqueOrThrow({ where: { email: "fondator@example.com" } });
    await db.user.update({ where: { id: admin.id }, data: { twoFactorEnabled: true } });
    await db.session.create({ data: { token: "sesiune", userId: admin.id, expiresAt: new Date(Date.now() + 3_600_000) } });
    lines = { out: [], err: [] };

    await expect(runCli(["reset-admin-password", "Fondator"], io())).resolves.toBe(0);
    const password = /: (\S{20})$/.exec(lines.out[0] ?? "")?.[1];
    expect(password).toBeDefined();
    const account = await db.account.findFirstOrThrow({ where: { userId: admin.id, providerId: "credential" } });
    await expect(verifyPassword(account.password!, password!)).resolves.toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).twoFactorEnabled).toBe(false);
    expect(await db.session.count({ where: { userId: admin.id } })).toBe(0);
  });

  test("fără tokenul corect, endpoint-ul refuză (403)", async () => {
    const res = await POST(
      new Request("http://localhost/api/internal/cli", {
        method: "POST",
        headers: { [CLI_TOKEN_HEADER]: cliToken("alt-secret") },
        body: JSON.stringify({ command: "status" }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
