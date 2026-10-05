import { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { testDb, truncateAll } from "./helpers";

const db = testDb();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$disconnect();
});

async function expectUniqueViolation(promise: Promise<unknown>): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  expect((error as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
}

async function createGroup(key: string) {
  return db.group.create({ data: { key, name: key } });
}

describe("schema nucleu", () => {
  test("al doilea user cu același nameNormalized → P2002", async () => {
    const member = await createGroup("member");
    await db.user.create({
      data: { name: "Ștefan", nameNormalized: "stefan", email: "stefan@example.com", primaryGroupId: member.id },
    });
    await expectUniqueViolation(
      db.user.create({
        data: { name: "ştefan", nameNormalized: "stefan", email: "altul@example.com", primaryGroupId: member.id },
      }),
    );
  });

  test("ContainerPermission duplicat → P2002", async () => {
    const member = await createGroup("member");
    const row = { containerType: "forum", containerId: "1", groupId: member.id, action: "view" };
    await db.containerPermission.create({ data: row });
    await expectUniqueViolation(db.containerPermission.create({ data: row }));
  });

  test("ștergerea unui user șterge în cascadă UserGroup și Warning", async () => {
    const member = await createGroup("member");
    const vip = await createGroup("vip_gold");
    const user = await db.user.create({
      data: { name: "Krypt", nameNormalized: "krypt", email: "krypt@example.com", primaryGroupId: member.id },
    });
    await db.userGroup.create({ data: { userId: user.id, groupId: vip.id } });
    await db.warning.create({ data: { userId: user.id, points: 1, reason: "test" } });

    await db.user.delete({ where: { id: user.id } });

    expect(await db.userGroup.count()).toBe(0);
    expect(await db.warning.count()).toBe(0);
  });
});
