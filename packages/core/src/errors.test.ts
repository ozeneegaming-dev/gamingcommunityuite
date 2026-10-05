import { describe, expect, test } from "vitest";
import {
  GcsConflict,
  GcsError,
  GcsForbidden,
  GcsNotFound,
  GcsRateLimited,
  GcsValidationError,
  toResult,
} from "./errors";

describe("GcsError", () => {
  test("subclasele au codul și statusul HTTP din spec", () => {
    expect(new GcsNotFound()).toMatchObject({ code: "not_found", status: 404 });
    expect(new GcsForbidden()).toMatchObject({ code: "forbidden", status: 403 });
    expect(new GcsValidationError({ name: "taken" })).toMatchObject({
      code: "validation",
      status: 422,
      fields: { name: "taken" },
    });
    expect(new GcsRateLimited()).toMatchObject({ code: "rate_limited", status: 429 });
    expect(new GcsConflict()).toMatchObject({ code: "conflict", status: 409 });
    expect(new GcsForbidden()).toBeInstanceOf(GcsError);
    expect(new GcsForbidden()).toBeInstanceOf(Error);
  });
});

describe("instanceof între copii ale modulului", () => {
  test("o eroare dintr-o altă copie a modulului (ex. alt bundle Next.js) e recunoscută după cod", async () => {
    // Simulăm o a doua copie a modulului: o clasă diferită, cu aceeași marcă.
    const copy = await import(`./errors?copie=${Date.now()}`);
    const foreign: unknown = new copy.GcsForbidden();
    expect(copy.GcsForbidden).not.toBe(GcsForbidden);
    expect(foreign instanceof GcsForbidden).toBe(true);
    expect(foreign instanceof GcsError).toBe(true);
    expect(foreign instanceof GcsNotFound).toBe(false);
    await expect(
      toResult(async () => {
        throw foreign;
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  test("numele minificate ale claselor nu contează", () => {
    const minified = new GcsForbidden();
    minified.name = "h";
    expect(minified instanceof GcsForbidden).toBe(true);
    expect(minified instanceof GcsNotFound).toBe(false);
  });

  test("un Error obișnuit nu e GcsError", () => {
    expect(new Error("x") instanceof GcsError).toBe(false);
    expect(new GcsForbidden() instanceof GcsValidationError).toBe(false);
  });
});

describe("toResult", () => {
  test("valoarea întoarsă devine {ok:true,data}", async () => {
    await expect(toResult(async () => 42)).resolves.toEqual({ ok: true, data: 42 });
  });

  test("GcsForbidden devine {ok:false,error:{code:'forbidden'}}", async () => {
    const result = await toResult(async () => {
      throw new GcsForbidden();
    });
    expect(result).toMatchObject({ ok: false, error: { code: "forbidden", status: 403 } });
  });

  test("câmpurile și parametrii ajung în payload", async () => {
    const result = await toResult(async () => {
      throw new GcsValidationError({ email: "invalid" }, { min: "3" });
    });
    expect(result).toEqual({
      ok: false,
      error: { code: "validation", status: 422, fields: { email: "invalid" }, params: { min: "3" } },
    });
  });

  test("o eroare obișnuită e aruncată mai departe", async () => {
    await expect(
      toResult(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
