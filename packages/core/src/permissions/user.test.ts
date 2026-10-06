import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import type { GcsModule } from "../modules/registry";

const extra: GcsModule = {
  key: "permtest",
  settings: [],
  acpMenu: [],
  eventListeners: [],
  permissions: [
    { key: "chat.create_private", scope: "group", labelKey: "p", default: { admin: true } },
    { key: "forums.flood_seconds", scope: "group", labelKey: "p", merge: "min", default: { member: 10, admin: 0 } },
  ],
};

let w: GcsTestWorld;

beforeEach(async () => {
  w = await createWorld([extra]);
});

afterAll(async () => {
  await w.db.$disconnect();
  w.redis.disconnect();
});

describe("permisiuni individuale", () => {
  test("o permisiune dată unui singur membru i se aplică doar lui; ștergerea revine la grup", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const ana = await w.actorFor(await w.createUser("Ana", "member"));
    const bogdan = await w.actorFor(await w.createUser("Bogdan", "member"));
    expect(await w.permissions.can(ana, "chat.create_private")).toBe(false);

    await w.permissions.setUserPermission(root, ana.userId!, "chat.create_private", true);
    expect(await w.permissions.can(ana, "chat.create_private")).toBe(true);
    expect(await w.permissions.can(bogdan, "chat.create_private")).toBe(false);
    expect(await w.permissions.userPermissions(ana.userId!)).toEqual({ "chat.create_private": true });

    await w.permissions.setUserPermission(root, ana.userId!, "chat.create_private", null);
    expect(await w.permissions.can(ana, "chat.create_private")).toBe(false);
    expect(await w.db.auditLog.count({ where: { action: "permissions.user" } })).toBe(2);
  });

  test("valoarea individuală o înlocuiește pe cea a grupurilor, și la `min`, și când ia un drept", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const ana = await w.actorFor(await w.createUser("Ana", "member"));
    const admin = await w.actorFor(await w.createUser("Adm", "admin"));
    expect(await w.permissions.groupValue<number>(ana, "forums.flood_seconds")).toBe(10);
    await w.permissions.setUserPermission(root, ana.userId!, "forums.flood_seconds", 0);
    expect(await w.permissions.groupValue<number>(ana, "forums.flood_seconds")).toBe(0);

    // Un admin căruia i se ia dreptul individual nu-l mai are.
    expect(await w.permissions.can(admin, "chat.create_private")).toBe(true);
    await w.permissions.setUserPermission(root, admin.userId!, "chat.create_private", false);
    expect(await w.permissions.can(admin, "chat.create_private")).toBe(false);
  });

  test("bannul și Root Admin rămân deasupra permisiunilor individuale", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const ana = await w.actorFor(await w.createUser("Ana", "member"));
    await w.permissions.setUserPermission(root, ana.userId!, "chat.create_private", true);
    expect(await w.permissions.can({ ...ana, isBanned: true }, "chat.create_private")).toBe(false);
    await w.permissions.setUserPermission(root, root.userId!, "chat.create_private", false);
    expect(await w.permissions.can(root, "chat.create_private")).toBe(true);
  });

  test("validare: cheie necunoscută, permisiune pe container, tip greșit, user inexistent", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const ana = await w.actorFor(await w.createUser("Ana", "member"));
    await expect(w.permissions.setUserPermission(root, ana.userId!, "nu.exista", true)).rejects.toMatchObject({ fields: { key: "unknown" } });
    await expect(w.permissions.setUserPermission(root, ana.userId!, "forums.view", true)).rejects.toMatchObject({ fields: { key: "unknown" } });
    await expect(w.permissions.setUserPermission(root, ana.userId!, "forums.flood_seconds", true)).rejects.toMatchObject({ fields: { value: "invalid_value" } });
    await expect(w.permissions.setUserPermission(root, ana.userId!, "chat.create_private", 3)).rejects.toMatchObject({ fields: { value: "invalid_value" } });
    await expect(w.permissions.setUserPermission(root, "nu-exista", "chat.create_private", true)).rejects.toThrow();
  });

  test("cache-ul se invalidează la schimbare (fără să aștepte TTL-ul)", async () => {
    const root = await w.actorFor(await w.createUser("Root", "root_admin"));
    const ana = await w.actorFor(await w.createUser("Ana", "member"));
    expect(await w.permissions.can(ana, "chat.create_private")).toBe(false);
    await w.permissions.setUserPermission(root, ana.userId!, "chat.create_private", true);
    expect(await w.permissions.can(ana, "chat.create_private")).toBe(true);
  });
});
