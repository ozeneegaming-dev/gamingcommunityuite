import type { GcsActor } from "@gcs/core";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createRemovalWorld, type GcsRemovalWorld } from "../../test/removalWorld";
import { GcsImportMap } from "./engine/map";

let w: GcsRemovalWorld;
let root: GcsActor;

beforeAll(async () => {
  w = await createRemovalWorld();
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  await w.reset();
  root = await w.user("Fondator", "root_admin");
});

describe("harta importului la ștergerea / unirea unui cont", () => {
  test("ștergerea marchează legătura: o rulare nouă nu recreează membrul și nu-i dă conținutul unui cont inexistent", async () => {
    const imported = await w.user("Importat");
    await w.s.db.importMap.create({ data: { source: "src", type: "member", sourceId: "42", targetId: imported.userId! } });
    await w.s.memberRemoval.requestDelete(root, imported.userId!, { mode: "KEEP_CONTENT", keepMessages: false });
    const map = new GcsImportMap(w.s.db, "src");
    // Pasul membrilor vede legătura (nu-l recreează); restul pașilor nu primesc un autor.
    expect((await map.get("member", ["42"], { includeDeleted: true })).has("42")).toBe(true);
    expect(await map.one("member", "42")).toBeNull();
  });

  test("unirea mută legătura pe țintă", async () => {
    const source = await w.user("Importat");
    const target = await w.user("Principal");
    await w.s.db.importMap.create({ data: { source: "src", type: "member", sourceId: "7", targetId: source.userId! } });
    await w.s.memberRemoval.requestMerge(root, source.userId!, target.userId!);
    expect(await new GcsImportMap(w.s.db, "src").one("member", "7")).toBe(target.userId);
  });
});
