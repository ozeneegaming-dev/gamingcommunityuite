import { describe, expect, test } from "vitest";
import { PLUGIN_FORM_MAX_FIELDS, PLUGIN_FORM_MAX_VALUE, pluginFormBody, pluginFormReturn } from "./forms";

describe("formularele pluginurilor", () => {
  test("câmpurile devin un obiect; numele repetate devin liste", () => {
    expect(pluginFormBody([["style", "ns_1"], ["plans", "vip_gold"], ["plans", "vip_legend"], ["plans", "vip_bronze"], ["quote", "Salut"]])).toEqual({
      style: "ns_1",
      plans: ["vip_gold", "vip_legend", "vip_bronze"],
      quote: "Salut",
    });
  });

  test("numele nesigure se ignoră, valorile lungi se taie, numărul de câmpuri e limitat", () => {
    const body = pluginFormBody([["__proto__", "x"], ["a b", "x"], ["", "x"], ["1st", "x"], ["ok", "y".repeat(PLUGIN_FORM_MAX_VALUE + 10)]]);
    expect(Object.keys(body)).toEqual(["ok"]);
    expect((body.ok as string).length).toBe(PLUGIN_FORM_MAX_VALUE);
    expect(Object.getPrototypeOf(body)).toBe(Object.prototype);
    const many = pluginFormBody(Array.from({ length: PLUGIN_FORM_MAX_FIELDS + 50 }, (_, i) => [`f${i}`, "1"] as [string, string]));
    expect(Object.keys(many)).toHaveLength(PLUGIN_FORM_MAX_FIELDS);
  });

  test("fișierele verificate trec ca obiecte", () => {
    const file = { id: "abc123def456", kind: "image", url: "/plugins/acme.demo/media/abc123def456.webp" };
    expect(pluginFormBody([["image", file]])).toEqual({ image: file });
  });

  test("întoarcerea: doar o pagină a pluginului, pe aceeași origine", () => {
    const origin = "https://forum.example";
    expect(pluginFormReturn(`${origin}/admin/plugins/acme.demo/frames?saved=1`, origin, "acme.demo")).toBe("/admin/plugins/acme.demo/frames?saved=1");
    expect(pluginFormReturn(`${origin}/p/acme.demo`, origin, "acme.demo")).toBe("/p/acme.demo");
    expect(pluginFormReturn("https://evil.example/p/acme.demo", origin, "acme.demo")).toBeNull();
    expect(pluginFormReturn(`${origin}/admin/members`, origin, "acme.demo")).toBeNull();
    expect(pluginFormReturn(`${origin}/p/acme.demox`, origin, "acme.demo")).toBeNull();
    expect(pluginFormReturn(null, origin, "acme.demo")).toBeNull();
    expect(pluginFormReturn("not a url", origin, "acme.demo")).toBeNull();
  });
});
