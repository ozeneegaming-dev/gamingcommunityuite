import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createWorld, type GcsTestWorld } from "../../test/world";
import { GcsValidationError } from "../errors";
import { GcsTagService, normalizeTag } from "./tags";

let world: GcsTestWorld;
const tags = new GcsTagService();

beforeEach(async () => {
  world = await createWorld();
});

afterAll(async () => {
  await world.db.$disconnect();
  world.kv.disconnect();
});

describe("normalizeTag", () => {
  test.each([
    ["Mașină", "masina"],
    ["  CS2 ", "cs2"],
    ["Counter Strike", "counter-strike"],
    ["#config", "config"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeTag(input)).toBe(expected);
  });

  test.each(["a", "x".repeat(31), "!!!", ""])("„%s” → null", (input) => {
    expect(normalizeTag(input)).toBeNull();
  });
});

describe("GcsTagService.ensure", () => {
  test("creează tag-urile lipsă și le refolosește pe cele existente, fără dubluri", async () => {
    const first = await world.db.$transaction((tx) => tags.ensure(tx, ["Mașină", "cs2", "masina"], 5));
    expect(first.map((t) => t.slug)).toEqual(["masina", "cs2"]);
    const second = await world.db.$transaction((tx) => tags.ensure(tx, ["CS2"], 5));
    expect(second[0]!.id).toBe(first[1]!.id);
    expect(await world.db.tag.count()).toBe(2);
  });

  test("peste maxim sau un tag invalid → GcsValidationError", async () => {
    await expect(world.db.$transaction((tx) => tags.ensure(tx, ["a1", "a2", "a3"], 2))).rejects.toBeInstanceOf(GcsValidationError);
    await expect(world.db.$transaction((tx) => tags.ensure(tx, ["ok", "!"], 5))).rejects.toBeInstanceOf(GcsValidationError);
  });
});
