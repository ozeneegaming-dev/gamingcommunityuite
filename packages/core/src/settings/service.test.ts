import type { PrismaClient } from "@gcs/db";
import { testDb, truncateAll } from "@gcs/db/test/helpers";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { testKv } from "../../test/kv";
import { GcsCache } from "../cache";
import { GcsValidationError } from "../errors";
import { GcsEventBus, type GcsEvent } from "../events";
import { GcsModuleRegistry } from "../modules/registry";
import type { GcsActor } from "../permissions/types";
import { GcsSettingsService } from "./service";

const db = testDb();
const kv = testKv();
const cache = new GcsCache(kv);

// Numărăm interogările `setting.findUnique` printr-o extensie Prisma (`vi.spyOn` nu merge pe delegații Prisma).
let findUniqueCalls = 0;
const countingDb = db.$extends({
  query: {
    setting: {
      findUnique({ args, query }) {
        findUniqueCalls++;
        return query(args);
      },
    },
  },
}) as unknown as PrismaClient;

const actor: GcsActor = { userId: "admin-1", groupIds: [1], primaryGroupId: 1, isBanned: false, ip: "10.0.0.1" };

function makeService() {
  const registry = new GcsModuleRegistry();
  registry.register({
    key: "test",
    permissions: [],
    acpMenu: [],
    eventListeners: [],
    settings: [
      { key: "site.name", type: "string", default: "RED-LINE", section: "general", labelKey: "s.name" },
      {
        key: "site.slogan",
        type: "string",
        default: "",
        section: "general",
        labelKey: "s.slogan",
        validate: (v) => ((v as string).length > 10 ? "too_long" : null),
      },
      { key: "email.smtp_host", type: "string", default: "", section: "email", labelKey: "s.host" },
      { key: "email.smtp_port", type: "number", default: 587, section: "email", labelKey: "s.port" },
      { key: "email.smtp_pass", type: "secret", default: "", section: "email", labelKey: "s.pass" },
      { key: "auth.open", type: "boolean", default: true, section: "auth", labelKey: "s.open" },
    ],
  });
  const events: GcsEvent[] = [];
  const bus = new GcsEventBus({ cache });
  bus.on("settings.updated", async (e) => {
    events.push(e);
  });
  return { service: new GcsSettingsService({ db: countingDb, cache, bus, registry }), events };
}

beforeEach(async () => {
  await truncateAll(db);
  await kv.flushAll();
});

afterAll(async () => {
  await db.$disconnect();
  kv.disconnect();
});

describe("GcsSettingsService", () => {
  test("get pe o bază goală întoarce valoarea implicită", async () => {
    const { service } = makeService();
    await expect(service.get("site.name")).resolves.toBe("RED-LINE");
  });

  test("set urmat de get întoarce valoarea nouă; al doilea get nu mai interoghează baza", async () => {
    const { service } = makeService();
    await service.get("site.name"); // valoarea veche intră în cache
    await service.set("site.name", "Comunitatea X", actor);

    findUniqueCalls = 0;
    await expect(service.get("site.name")).resolves.toBe("Comunitatea X");
    await expect(service.get("site.name")).resolves.toBe("Comunitatea X");
    expect(findUniqueCalls).toBe(1);
  });

  test("set cu un tip greșit aruncă GcsValidationError", async () => {
    const { service } = makeService();
    await expect(service.set("email.smtp_port", "587", actor)).rejects.toBeInstanceOf(GcsValidationError);
    await expect(service.set("auth.open", 1, actor)).rejects.toBeInstanceOf(GcsValidationError);
    await expect(service.set("email.smtp_port", Number.NaN, actor)).rejects.toBeInstanceOf(GcsValidationError);
    expect(await db.setting.count()).toBe(0);
  });

  test("validate-ul definiției se aplică, cu codul pe câmp", async () => {
    const { service } = makeService();
    const error = await service.set("site.slogan", "un slogan mult prea lung", actor).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GcsValidationError);
    expect((error as GcsValidationError).fields).toEqual({ "site.slogan": "too_long" });
  });

  test("o cheie necunoscută aruncă GcsValidationError", async () => {
    const { service } = makeService();
    await expect(service.set("nu.exista", "x", actor)).rejects.toBeInstanceOf(GcsValidationError);
  });

  test("getMany('email') nu conține email.smtp_pass", async () => {
    const { service } = makeService();
    await service.set("email.smtp_host", "smtp.example.com", actor);
    await service.set("email.smtp_pass", "parola", actor);
    await expect(service.getMany("email")).resolves.toEqual({
      "email.smtp_host": "smtp.example.com",
      "email.smtp_port": 587,
    });
    await expect(service.get("email.smtp_pass")).resolves.toBe("parola");
  });

  test("set scrie un audit (fără valoarea secretelor) și emite settings.updated", async () => {
    const { service, events } = makeService();
    await service.set("site.name", "Nou", actor);
    await service.set("email.smtp_pass", "secret123", actor);

    const logs = await db.auditLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({
      actorId: "admin-1",
      action: "settings.update",
      targetType: "setting",
      targetId: "site.name",
      before: "RED-LINE",
      after: "Nou",
      ip: "10.0.0.1",
    });
    expect(JSON.stringify(logs[1])).not.toContain("secret123");

    expect(events.map((e) => e.payload.key)).toEqual(["site.name", "email.smtp_pass"]);
    expect(events[0]?.tags).toContain("settings");
  });
});
