import { describe, expect, test } from "vitest";
import { openSecret, sealSecret } from "./secrets";

describe("sealSecret / openSecret", () => {
  test("criptează și decriptează; textul cifrat nu conține parola și diferă la fiecare apel", () => {
    const a = sealSecret("parola-bazei-vechi", "cheie-test");
    const b = sealSecret("parola-bazei-vechi", "cheie-test");
    expect(a).not.toContain("parola");
    expect(a).not.toBe(b);
    expect(openSecret(a, "cheie-test")).toBe("parola-bazei-vechi");
  });

  test("o altă cheie sau un text modificat → null", () => {
    const sealed = sealSecret("x", "cheie-test");
    expect(openSecret(sealed, "alta-cheie")).toBeNull();
    const parts = sealed.split(".");
    parts[3] = Buffer.from("y").toString("base64url");
    expect(openSecret(parts.join("."), "cheie-test")).toBeNull();
    expect(openSecret("nu-e-secret", "cheie-test")).toBeNull();
  });
});
