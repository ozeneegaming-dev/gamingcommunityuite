import { createTranslator } from "next-intl";
import { describe, expect, test } from "vitest";
import en from "../messages/en.json";
import ro from "../messages/ro.json";
import { groupPillText, type GcsGroupPillT } from "./group-pill-text";

const tr = (locale: "ro" | "en", messages: typeof ro): GcsGroupPillT => {
  const t = createTranslator({ locale, messages, namespace: "groups.pill" });
  return (key, values) => t(key, values as never);
};

describe("tooltip-ul pastilei unui grup", () => {
  const t = tr("ro", ro);

  test("un grup nou, fără membri: „0 membri · 0 online acum”", () => {
    const r = groupPillText({ name: "Grup nou", description: "" }, undefined, t);
    expect(r.tooltip).toEqual(["0 membri · 0 online acum"]);
    expect(r.ariaLabel).toBe("Membrii grupului Grup nou · 0 membri · 0 online acum");
  });

  test("un membru (singular) și descrierea scurtă pe primul rând", () => {
    const r = groupPillText({ name: "Testeri", description: "Cei care testează" }, { members: 1, secondary: 0, online: 0 }, t);
    expect(r.tooltip).toEqual(["Cei care testează", "1 membru · 0 online acum"]);
  });

  test("membrii secundari și rândul unei aplicații", () => {
    expect(groupPillText({ name: "VIP", description: "" }, { members: 31, secondary: 12, online: 7 }, t, "Admin pe 2 servere").tooltip).toEqual([
      "31 de membri (12 ca grup secundar) · 7 online acum",
      "Admin pe 2 servere",
    ]);
    expect(groupPillText({ name: "Clan", description: "" }, { members: 11, secondary: 11, online: 3 }, t).tooltip).toEqual([
      "11 membri, toți ca grup secundar · 3 online acum",
    ]);
  });

  test("pluralul în engleză", () => {
    const e = tr("en", en as typeof ro);
    expect(groupPillText({ name: "VIP", description: "" }, { members: 1, secondary: 0, online: 1 }, e).tooltip[0]).toMatch(/^1 member\b/);
    expect(groupPillText({ name: "VIP", description: "" }, { members: 2, secondary: 0, online: 1 }, e).tooltip[0]).toMatch(/^2 members\b/);
  });
});
