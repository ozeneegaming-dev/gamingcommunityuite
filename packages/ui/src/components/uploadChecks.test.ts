import { describe, expect, test } from "vitest";
import { GCS_ICON_CATEGORIES, GCS_ICON_CATEGORY_KEYS, iconMatch, resolveIcon, searchIcons } from "../icons/registry";
import { checkUploadFile, formatBytes, sniffType, typeAccepted, type GcsUploadRules } from "./uploadChecks";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(Math.max(0, 16 - b.length)).fill(0)]);
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("popupul de încărcare: verificările dinainte de trimitere", () => {
  test("tipul se recunoaște după primii octeți, nu după nume", () => {
    expect(sniffType(bytes(...PNG))).toBe("image/png");
    expect(sniffType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe("image/gif");
    expect(sniffType(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe("image/webp");
    expect(sniffType(bytes(0x50, 0x4b, 0x03, 0x04))).toBe("application/zip");
    expect(sniffType(new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe("image/svg+xml");
    expect(sniffType(new TextEncoder().encode("hello"))).toBeNull();
  });

  test("tipul acceptat: exact, cu „image/*” sau după extensie (fișierele fără semnătură)", () => {
    expect(typeAccepted("image/png", "a.png", ["image/png"])).toBe(true);
    expect(typeAccepted("image/webp", "a.webp", ["image/*"])).toBe(true);
    expect(typeAccepted("", "conf.JSON", [".json"])).toBe(true);
    expect(typeAccepted("image/jpeg", "a.png", ["image/png", "image/webp"])).toBe(false);
  });

  test("mărimile se scriu pe scurt", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(412 * 1024)).toMatch(/^412 KB$/);
    expect(formatBytes(3.2 * 1024 * 1024)).toMatch(/^3[.,]2 MB$/);
  });

  test("un fișier prea mare sau de alt tip e respins, cu motivul", async () => {
    const rules: GcsUploadRules = { accept: ["application/zip"], typesLabel: "ZIP", maxBytes: 10 };
    const zip = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(20).fill(0)])], "plugin.zip");
    const checks = await checkUploadFile(zip, rules);
    expect(checks.map((c) => [c.key, c.ok])).toEqual([
      ["okType", true],
      ["errSize", false],
      ["okReal", true],
    ]);
    const text = new File(["nu e o arhivă"], "plugin.zip");
    expect((await checkUploadFile(text, { ...rules, maxBytes: 1000 }))[0]).toEqual({ key: "errType", ok: false });
  });
});

describe("selectorul de iconițe: categoriile și căutarea", () => {
  test("fiecare iconiță din categorii există în Font Awesome Free", () => {
    for (const key of GCS_ICON_CATEGORY_KEYS) {
      for (const name of GCS_ICON_CATEGORIES[key]) expect(resolveIcon(name), `${key}: ${name}`).not.toBeNull();
    }
  });

  test("fără text, deschide „Populare” (nu lista alfabetică cu cifrele 0–9)", () => {
    const first = searchIcons("", 60).map((i) => i.name);
    expect(first[0]).toBe("fa-solid fa-trophy");
    expect(first.some((n) => /fa-[0-9]$/.test(n))).toBe(false);
    expect(searchIcons("", 60, "brands").every((i) => i.name.startsWith("fa-brands"))).toBe(true);
  });

  test("căutarea trece prin toate iconițele; la „Mărci”, doar prin mărci", () => {
    expect(searchIcons("gamepad").map((i) => i.name)).toContain("fa-solid fa-gamepad");
    expect(searchIcons("discord", 60, "brands").map((i) => i.name)).toEqual(["fa-brands fa-discord"]);
    expect(iconMatch("fa-solid fa-trophy")?.path).toBeTruthy();
    expect(iconMatch("fa-solid fa-nu-exista")).toBeNull();
  });
});
