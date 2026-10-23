import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../test/world";
import { queryAudit, writeAudit } from "./audit";

let w: GcsTestWorld;

beforeEach(async () => {
  w = await createWorld();
});

afterAll(async () => {
  await w.db.$disconnect();
  w.kv.disconnect();
});

describe("queryAudit", () => {
  test("filtrează după actor, acțiune și interval, cu numele actorului", async () => {
    const a = await w.createUser("AdminA", "admin");
    const b = await w.createUser("AdminB", "admin");
    await writeAudit(w.db, { actorId: a.id, action: "group.update", targetType: "group", targetId: "1", before: { c: 1 }, after: { c: 2 } });
    await writeAudit(w.db, { actorId: b.id, action: "group.update", targetType: "group", targetId: "2" });
    await writeAudit(w.db, { actorId: a.id, action: "user.ban", targetType: "user", targetId: "x" });

    const byActor = await queryAudit(w.db, { actorId: a.id, page: 1 });
    expect(byActor.total).toBe(2);
    expect(byActor.items.every((i) => i.actorName === "AdminA")).toBe(true);

    const byAction = await queryAudit(w.db, { action: "group.update", page: 1 });
    expect(byAction.total).toBe(2);

    const future = await queryAudit(w.db, { from: new Date(Date.now() + 60_000), page: 1 });
    expect(future.total).toBe(0);

    const one = byAction.items.find((i) => i.targetId === "1");
    expect(one).toMatchObject({ before: { c: 1 }, after: { c: 2 } });
  });

  test("cele mai noi primele, 50 pe pagină", async () => {
    for (let i = 0; i < 55; i++) await writeAudit(w.db, { actorId: null, action: `a.${i}`, targetType: "t", targetId: String(i) });
    const page1 = await queryAudit(w.db, { page: 1 });
    expect(page1.items).toHaveLength(50);
    expect(page1.pages).toBe(2);
    expect(page1.items[0]?.action).toBe("a.54");
  });
});
