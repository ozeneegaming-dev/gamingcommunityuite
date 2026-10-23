import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsRateLimiter } from "../auth/rateLimit";
import { GcsConflict, GcsForbidden, GcsNotFound, GcsRateLimited, GcsValidationError } from "../errors";
import type { GcsActor } from "../permissions/types";
import { GcsReportService } from "./reports";

let world: GcsTestWorld;
let reports: GcsReportService;
let reporter: GcsActor;
let mod: GcsActor;
const hidden: string[] = [];

beforeEach(async () => {
  world = await createWorld();
  reports = new GcsReportService({ db: world.db, bus: world.bus, rateLimiter: new GcsRateLimiter(world.kv) });
  reporter = await world.actorFor(await world.createUser("Mara", "member"));
  mod = await world.actorFor(await world.createUser("Neo", "super_moderator"));
  hidden.length = 0;
  reports.registerContent("test.item", {
    canView: async (_a, id) => id !== "secret",
    canModerate: async (a) => a.userId === mod.userId,
    hide: async (_a, id) => {
      hidden.push(id);
    },
  });
});

afterAll(async () => {
  await world.db.$disconnect();
  world.kv.disconnect();
});

const item = (contentId = "1", reason = "spam evident") => ({ contentType: "test.item", contentId, reason });

describe("GcsReportService", () => {
  test("un raport deschis per user per conținut; altcineva poate raporta același conținut", async () => {
    await reports.report(reporter, item());
    await expect(reports.report(reporter, item())).rejects.toBeInstanceOf(GcsConflict);
    await reports.report(mod, item());
    expect(await world.db.report.count({ where: { status: "OPEN" } })).toBe(2);
  });

  test("validări: motiv prea scurt, conținut invizibil sau necunoscut, vizitator", async () => {
    await expect(reports.report(reporter, item("1", "x"))).rejects.toBeInstanceOf(GcsValidationError);
    await expect(reports.report(reporter, item("secret"))).rejects.toBeInstanceOf(GcsNotFound);
    await expect(reports.report(reporter, { ...item(), contentType: "necunoscut" })).rejects.toBeInstanceOf(GcsNotFound);
    await expect(reports.report({ ...reporter, userId: null }, item())).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("al 11-lea raport într-o oră → GcsRateLimited", async () => {
    for (let i = 0; i < 10; i++) await reports.report(reporter, item(String(i)));
    await expect(reports.report(reporter, item("99"))).rejects.toBeInstanceOf(GcsRateLimited);
  });

  test("închiderea cu „ascunde” ascunde conținutul și închide toate rapoartele lui; doar moderatorul", async () => {
    const r1 = await reports.report(reporter, item());
    await reports.report(mod, item());
    await expect(reports.close(reporter, r1.id, { action: "hide" })).rejects.toBeInstanceOf(GcsForbidden);

    await reports.close(mod, r1.id, { action: "hide" });
    expect(hidden).toEqual(["1"]);
    expect(await world.db.report.count({ where: { status: "OPEN" } })).toBe(0);
    expect(await world.db.report.findUniqueOrThrow({ where: { id: r1.id } })).toMatchObject({ status: "CLOSED", handledById: mod.userId });
    expect(await world.db.auditLog.count({ where: { action: "mod.report.close" } })).toBe(1);
  });

  test("închiderea fără acțiune închide doar raportul acela", async () => {
    const r1 = await reports.report(reporter, item());
    await reports.report(mod, item());
    await reports.close(mod, r1.id, { action: "none" });
    expect(hidden).toEqual([]);
    expect(await world.db.report.count({ where: { status: "OPEN" } })).toBe(1);
  });
});
