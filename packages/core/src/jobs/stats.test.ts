import { describe, expect, test } from "vitest";
import { GcsJobRegistry, type GcsJobData, type GcsJobDef } from "./queue";

/** Registrul fără driver: rulează direct handler-ul, ca worker-ul. */
class TestRegistry extends GcsJobRegistry {
  run(name: string, data: GcsJobData = {}): Promise<void> {
    return this.runDef(this.defs.get(name) as GcsJobDef, data);
  }
}

describe("înregistrarea rulărilor de joburi (Stare sistem)", () => {
  test("rularea reușită și cea picată ajung la înregistrator; eroarea jobului merge mai departe", async () => {
    const reg = new TestRegistry();
    const runs: { name: string; ok: boolean; message?: string }[] = [];
    reg.setRecorder(async (name, run) => void runs.push({ name, ok: run.error === undefined, ...(run.error instanceof Error ? { message: run.error.message } : {}) }));
    reg.register({ name: "bun", handler: async () => {} });
    reg.register({ name: "rau", handler: async () => Promise.reject(new Error("bum")) });

    await reg.run("bun");
    await expect(reg.run("rau")).rejects.toThrow("bum");
    expect(runs).toEqual([
      { name: "bun", ok: true },
      { name: "rau", ok: false, message: "bum" },
    ]);
  });

  test("un înregistrator care pică nu strică jobul", async () => {
    const reg = new TestRegistry();
    let ran = false;
    reg.setRecorder(async () => Promise.reject(new Error("kv căzut")));
    reg.register({ name: "j", handler: async () => void (ran = true) });
    await expect(reg.run("j")).resolves.toBeUndefined();
    expect(ran).toBe(true);
  });
});
