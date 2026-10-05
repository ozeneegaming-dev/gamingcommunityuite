import { describe, expect, test } from "vitest";
import { normalizeEmail, normalizeUsername, validateUsername } from "./usernames";

describe("normalizeUsername (Review Focus #1)", () => {
  test("Ștefan (virgulă) și ştefan (sedilă) devin stefan", () => {
    expect(normalizeUsername("Ștefan")).toBe("stefan");
    expect(normalizeUsername("ştefan")).toBe("stefan");
    expect(normalizeUsername("Ştefan")).toBe(normalizeUsername("ștefan"));
  });

  test("ț/ţ, ă, â, î și spațiile de la capete", () => {
    expect(normalizeUsername("  Țânțăreț  ")).toBe("tantaret");
    expect(normalizeUsername("ţîră")).toBe("tira");
  });

  test("NFKC: caracterele de lățime completă devin ASCII", () => {
    expect(normalizeUsername("Ｋｒｙｐｔ")).toBe("krypt");
  });
});

describe("normalizeEmail", () => {
  test("Bling@Mail.com și bling@mail.com sunt același cont", () => {
    expect(normalizeEmail(" Bling@Mail.com ")).toBe("bling@mail.com");
    expect(normalizeEmail("bling@mail.com")).toBe(normalizeEmail("Bling@Mail.com"));
  });
});

describe("validateUsername", () => {
  test("lungime 3–24", () => {
    expect(validateUsername("ab")).toBe("username_too_short");
    expect(validateUsername("a".repeat(25))).toBe("username_too_long");
  });

  test("litere Unicode, cifre și _ . -", () => {
    expect(validateUsername("Krypt_99")).toBeNull();
    expect(validateUsername("Ștefan.ro-1")).toBeNull();
    expect(validateUsername("nume cu spațiu")).toBe("username_invalid_chars");
    expect(validateUsername("<script>")).toBe("username_invalid_chars");
  });
});
