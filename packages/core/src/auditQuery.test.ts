import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../test/world";
import { auditCsv, exportAudit, queryAudit, writeAudit } from "./audit";

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

  test("ținta: după membru (cu numele lui) și după tip; exportul CSV cu aceleași filtre", async () => {
    const a = await w.createUser("AdminA", "admin");
    const victim = await w.createUser("Ținta", "member");
    await writeAudit(w.db, { actorId: a.id, action: "user.ban", targetType: "user", targetId: victim.id, after: { reason: 'spam, "grav"' }, ip: "203.0.113.9" });
    await writeAudit(w.db, { actorId: a.id, action: "group.update", targetType: "group", targetId: "3" });
    await writeAudit(w.db, { actorId: null, action: "user.warn", targetType: "user", targetId: "=cmd()" });

    const byTarget = await queryAudit(w.db, { targetType: "user", targetId: victim.id, page: 1 });
    expect(byTarget.items).toMatchObject([{ action: "user.ban", targetName: "Ținta", actorName: "AdminA" }]);
    expect((await queryAudit(w.db, { targetType: "group", page: 1 })).total).toBe(1);

    const csv = auditCsv(await exportAudit(w.db, { targetType: "user" }));
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("\uFEFFcreatedAt,actor,actorId,action,targetType,targetId,target,before,after,ip");
    expect(lines).toHaveLength(4);
    // Ghilimelele dublate; o valoare care începe cu „=” nu devine formulă.
    expect(csv).toContain(`,user.ban,user,${victim.id},Ținta,,"{""reason"":""spam, \\""grav\\""""}",203.0.113.9`);
    expect(csv).toContain(",user.warn,user,'=cmd(),,,,");
  });
});
