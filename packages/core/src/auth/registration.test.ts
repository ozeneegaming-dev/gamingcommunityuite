import { testDb, truncateAll } from "@gcs/db/test/helpers";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { testRegistry } from "../../test/fixtures";
import { GcsValidationError } from "../errors";
import { seedDefaults } from "../install/seed";
import { prepareNewUser } from "./registration";

const db = testDb();
let groups: Record<string, number>;

beforeEach(async () => {
  await truncateAll(db);
  await seedDefaults(db, testRegistry());
  groups = Object.fromEntries((await db.group.findMany()).map((g) => [g.key, g.id]));
});

afterAll(async () => {
  await db.$disconnect();
});

async function register(name: string, email: string, emailConfirm = true) {
  const data = await prepareNewUser(db, { name, email }, { emailConfirm });
  return db.user.create({ data });
}

async function fieldError(promise: Promise<unknown>): Promise<Record<string, string>> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(GcsValidationError);
  return (error as GcsValidationError).fields;
}

describe("prepareNewUser", () => {
  test("calculează nameNormalized, salvează emailul lowercase și pune userul în new_member", async () => {
    const user = await register("Ștefan", "Stefan@Mail.com");
    expect(user).toMatchObject({ name: "Ștefan", nameNormalized: "stefan", email: "stefan@mail.com" });
    expect(user.primaryGroupId).toBe(groups.new_member);
  });

  test("fără confirmare pe email, userul intră direct în member", async () => {
    const user = await register("Krypt", "krypt@mail.com", false);
    expect(user.primaryGroupId).toBe(groups.member);
  });

  test("Review Focus #1: „ștefan” după „Ștefan” → username_taken", async () => {
    await register("Ștefan", "a@mail.com");
    expect(await fieldError(register("ştefan", "b@mail.com"))).toEqual({ name: "username_taken" });
  });

  test("Review Focus #1: Bling@Mail.com și bling@mail.com sunt același cont → email_taken", async () => {
    await register("Bling", "Bling@Mail.com");
    expect(await fieldError(register("Bling2", "bling@mail.com"))).toEqual({ email: "email_taken" });
  });

  test("un nume invalid e refuzat înainte de orice interogare", async () => {
    expect(await fieldError(register("ab", "x@mail.com"))).toEqual({ name: "username_too_short" });
  });

  test("autoRename (Discord/Steam): un nume luat sau invalid primește o variantă liberă", async () => {
    await register("Krypt", "a@mail.com");
    const taken = await prepareNewUser(db, { name: "krypt", email: "b@mail.com" }, { emailConfirm: false, autoRename: true });
    expect(taken.name).toMatch(/^krypt\d{4}$/);
    expect(taken.nameNormalized).toBe(taken.name);

    const invalid = await prepareNewUser(
      db,
      { name: "x y!", email: "c@mail.com" },
      { emailConfirm: false, autoRename: true },
    );
    expect(invalid.name).toMatch(/^x_y_/);
    expect(invalid.name.length).toBeGreaterThanOrEqual(3);

    const long = await prepareNewUser(db, { name: "a".repeat(40), email: "d@mail.com" }, { emailConfirm: false, autoRename: true });
    expect([...long.name].length).toBeLessThanOrEqual(24);
  });

  test("un email invalid e refuzat", async () => {
    expect(await fieldError(register("Valid", "fara-arond"))).toEqual({ email: "email_invalid" });
  });
});
