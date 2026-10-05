import { describe, expect, test } from "vitest";
import { parseRef, slugify } from "./slug";

describe("slugify", () => {
  test.each([
    ["Cereri & reclamații", "cereri-reclamatii"],
    ["Mașina lui Ștefan", "masina-lui-stefan"],
    ["Țară, ÎNVĂȚĂMÂNT și școală!", "tara-invatamant-si-scoala"],
    ["  Cel mai bun crosshair pentru 1440p?  ", "cel-mai-bun-crosshair-pentru-1440p"],
    ["[RDL] recrutează 2 rifleri", "rdl-recruteaza-2-rifleri"],
    ["???", "topic"],
    ["", "topic"],
  ])("%s → %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  test("maxim 80 de caractere, tăiat la un cuvânt întreg", () => {
    const slug = slugify("cuvant ".repeat(30));
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug.split("-").every((w) => w === "cuvant")).toBe(true);
  });
});

describe("parseRef", () => {
  test("`{id}-{slug}` și doar `{id}`", () => {
    expect(parseRef("128-cum-intru-pe-server")).toEqual({ id: 128, slug: "cum-intru-pe-server" });
    expect(parseRef("128")).toEqual({ id: 128, slug: "" });
  });

  test("referințe invalide → null", () => {
    expect(parseRef("abc")).toBeNull();
    expect(parseRef("-5-x")).toBeNull();
    expect(parseRef("0-x")).toBeNull();
    expect(parseRef("99999999999999999999-x")).toBeNull();
  });
});
