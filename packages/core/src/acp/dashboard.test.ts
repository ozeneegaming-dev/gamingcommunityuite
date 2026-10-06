import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsForbidden } from "../errors";
import { GcsPresenceService } from "../presence/presence";
import { DEFAULT_ACP_LAYOUT, GcsAcpDashboardService } from "./dashboard";

let w: GcsTestWorld;
let dash: GcsAcpDashboardService;

beforeEach(async () => {
  w = await createWorld();
  dash = new GcsAcpDashboardService({ db: w.db, acp: w.acp });
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

describe("layout-ul dashboard-ului", () => {
  test("fără layout salvat → cel implicit", async () => {
    const user = await w.createUser("Root", "root_admin");
    await expect(dash.getLayout(user.id)).resolves.toEqual(DEFAULT_ACP_LAYOUT);
  });

  test("se salvează pe admin; widgeturile necunoscute sau duble sunt eliminate, cele lipsă revin", async () => {
    const user = await w.createUser("Root", "root_admin");
    await dash.saveLayout(user.id, {
      main: ["system_health", "nu_exista", "registrations"],
      side: ["online_users", "admin_notes", "admin_notes"],
      collapsed: ["online_users", "nu_exista"],
      appOrder: ["members", "system", "inventat"],
    });
    const layout = await dash.getLayout(user.id);
    expect(layout.main).toEqual(["system_health", "registrations", "latest_members", "pending_content", "open_reports", "acp_log", "vip_expiring"]);
    expect(layout.side.slice(0, 2)).toEqual(["online_users", "admin_notes"]);
    // Widgeturile nemenționate sunt adăugate la final, ca niciunul să nu dispară definitiv.
    expect(new Set([...layout.main, ...layout.side])).toEqual(
      new Set([...DEFAULT_ACP_LAYOUT.main, ...DEFAULT_ACP_LAYOUT.side]),
    );
    expect(layout.collapsed).toEqual(["online_users"]);
    expect(layout.appOrder).toEqual(["members", "system"]);
  });
});

describe("datele widgeturilor", () => {
  test("înregistrările pe ultimele N zile, inclusiv zilele fără înregistrări", async () => {
    const now = new Date("2026-10-05T10:00:00Z");
    const a = await w.createUser("A", "member");
    const b = await w.createUser("B", "member");
    await w.db.user.update({ where: { id: a.id }, data: { createdAt: new Date("2026-10-05T08:00:00Z") } });
    await w.db.user.update({ where: { id: b.id }, data: { createdAt: new Date("2026-10-03T08:00:00Z") } });

    const series = await dash.registrations(3, now);
    expect(series).toEqual([
      { x: "2026-10-03", y: 1 },
      { x: "2026-10-04", y: 0 },
      { x: "2026-10-05", y: 1 },
    ]);
  });

  test("rezumatul: serii pe 30 de zile, variația față de perioada anterioară, liste și cache de 60 s", async () => {
    const now = new Date("2026-10-05T10:00:00Z");
    const root = await w.createUser("Root", "root_admin");
    const recent = await w.createUser("Nou", "member");
    const old = await w.createUser("Vechi", "member");
    await w.db.user.update({ where: { id: root.id }, data: { createdAt: new Date("2026-01-01T08:00:00Z") } });
    await w.db.user.update({ where: { id: recent.id }, data: { createdAt: new Date("2026-10-04T21:30:00Z") } });
    await w.db.user.update({ where: { id: old.id }, data: { createdAt: new Date("2026-08-20T08:00:00Z") } });
    await w.db.report.create({ data: { contentType: "post", contentId: "1", reason: "spam", createdAt: new Date("2026-10-01T08:00:00Z") } });
    await dash.recordAcpLogin(root.id, "10.0.0.1", false);

    const cached = new GcsAcpDashboardService({ db: w.db, acp: w.acp, cache: w.cache });
    await w.cache.invalidateTags(["acp-dashboard"]);
    const o = await cached.overview(now);
    expect(o.days).toHaveLength(30);
    expect(o.days.at(-1)).toBe("2026-10-05");
    // 21:30 UTC pe 4 octombrie e deja 5 octombrie la București.
    expect(o.series.registrations.at(-1)).toBe(1);
    expect(o.periods.registrations).toEqual({ current: 1, previous: 1 });
    expect(o.periods.reports.current).toBe(1);
    expect(o.totals).toMatchObject({ members: 3, openReports: 1, reports: 1 });
    expect(o.latestMembers[0]).toMatchObject({ name: "Nou", groupKey: "member" });
    expect(o.audit[0]).toMatchObject({ action: "acp.login_failed", actorName: "Root" });

    await w.createUser("Ulterior", "member");
    await expect(cached.overview(now)).resolves.toMatchObject({ totals: { members: 3 } });
    await w.cache.invalidateTags(["acp-dashboard"]);
  });

  test("notițele admin: salvare cu drept, citire cu autorul", async () => {
    const rootUser = await w.createUser("Root", "root_admin");
    const root = await w.actorFor(rootUser);
    await dash.saveNote("Turneu sâmbătă", root);
    await expect(dash.getNote()).resolves.toMatchObject({ body: "Turneu sâmbătă", updatedBy: "Root" });
    expect(await w.db.auditLog.count({ where: { action: "acp.note.update" } })).toBe(1);

    const member = await w.actorFor(await w.createUser("Membru", "member"));
    await expect(dash.saveNote("x", member)).rejects.toBeInstanceOf(GcsForbidden);
  });

  test("autentificările în ACP: reușita salvează data și IP-ul, eșecurile apar în widget", async () => {
    const user = await w.createUser("Root", "root_admin");
    await dash.recordAcpLogin(user.id, "10.0.0.9", false);
    await dash.recordAcpLogin(user.id, "10.0.0.9", true);

    const updated = await w.db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.lastAcpAuthIp).toBe("10.0.0.9");
    expect(updated.lastAcpAuthAt).not.toBeNull();

    const failed = await dash.failedAcpLogins(5);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ userName: "Root", ip: "10.0.0.9" });
  });

  test("online: membrii activi în ultimele 15 minute și adminii dintre ei", async () => {
    const now = new Date("2026-10-05T10:00:00Z");
    const admin = await w.createUser("Admin", "admin");
    const member = await w.createUser("Membru", "member");
    const away = await w.createUser("Plecat", "member");
    await w.db.user.update({ where: { id: admin.id }, data: { lastActiveAt: new Date("2026-10-05T09:55:00Z") } });
    await w.db.user.update({ where: { id: member.id }, data: { lastActiveAt: new Date("2026-10-05T09:50:00Z") } });
    await w.db.user.update({ where: { id: away.id }, data: { lastActiveAt: new Date("2026-10-05T09:00:00Z") } });

    await expect(dash.onlineCount(now)).resolves.toBe(2);
    await expect(dash.onlineAdmins(now)).resolves.toEqual([{ id: admin.id, name: "Admin", groupKey: "admin" }]);
  });

  test("cu prezența din Redis (etapa 4), numărul de online vine de acolo; o eroare Redis revine la lastActiveAt", async () => {
    const now = new Date("2026-10-05T10:00:00Z");
    const presence = new GcsPresenceService({ redis: w.redis });
    await presence.touch({ userId: "u1" }, now.getTime());
    await presence.touch({ userId: "u2" }, now.getTime());
    await presence.touch({ guestId: "g1" }, now.getTime());
    const live = new GcsAcpDashboardService({ db: w.db, acp: w.acp, presence });
    await expect(live.onlineCount(now)).resolves.toBe(2);

    const broken = new GcsAcpDashboardService({ db: w.db, acp: w.acp, presence: { online: async () => Promise.reject(new Error("down")) } });
    await expect(broken.onlineCount(now)).resolves.toBe(0);
  });
});
