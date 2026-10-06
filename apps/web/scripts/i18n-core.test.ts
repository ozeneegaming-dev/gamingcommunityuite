import { describe, expect, test } from "vitest";
import { argumentNames, flatten, isValidTranslation, translateMessages, unflatten, type GcsHtmlTranslator } from "./i18n-core";

/** Un „traducător” fals: pune textul cu majuscule (jetoanele `ZQX0`… rămân la fel, ca la LibreTranslate). */
const upper: GcsHtmlTranslator = async (texts) => texts.map((t) => t.toUpperCase());

describe("traducerea mesajelor ICU", () => {
  test("argumentele, numerele și apostrofurile rămân; textul se traduce", async () => {
    const [a, b, c] = await translateMessages(["Hi, {name}!", "{count, number} posts by {user}", "Who's online"], "de", upper);
    expect(a).toBe("HI, {name}!");
    expect(b).toBe("{count, number} POSTS BY {user}");
    expect(c).toBe("WHO'S ONLINE");
  });

  test("pluralul se reconstruiește pe categoriile limbii țintă (rusă: one, few, many, other), cu #", async () => {
    const [ru] = await translateMessages(["{count, plural, one {# new post} other {# new posts}} today"], "ru", upper);
    expect(ru).toBe("{count, plural, one {# NEW POST} few {# NEW POSTS} many {# NEW POSTS} other {# NEW POSTS}} TODAY");
    const [de] = await translateMessages(["{count, plural, =0 {none} one {# item} other {# items}}"], "de", upper);
    expect(de).toBe("{count, plural, =0 {NONE} one {# ITEM} other {# ITEMS}}");
  });

  test("HTML-ul din mesaje (email) se păstrează, iar caracterele speciale se decodează", async () => {
    const [html] = await translateMessages(["<p>Hi, {name}!</p><p>Tom & Jerry</p>"], "fr", upper);
    expect(html).toBe("<p>HI, {name}!</p><p>TOM & JERRY</p>");
  });

  test("un traducător care pierde sau dublează un argument → null (rămâne în engleză)", async () => {
    const drops: GcsHtmlTranslator = async (texts) => texts.map((t) => t.replace("ZQX0", ""));
    const doubles: GcsHtmlTranslator = async (html) => html.map((h) => h + h);
    expect(await translateMessages(["Sent to {email}"], "es", drops)).toEqual([null]);
    expect(await translateMessages(["Sent to {email}"], "es", doubles)).toEqual([null]);
  });

  test("mesajele doar cu argumente nu se trimit la traducător", async () => {
    let calls = 0;
    const counting: GcsHtmlTranslator = async (html) => {
      calls += html.length;
      return html;
    };
    expect(await translateMessages(["{name}"], "de", counting)).toEqual(["{name}"]);
    expect(calls).toBe(0);
  });
});

describe("utilitare", () => {
  test("argumentNames și isValidTranslation", () => {
    expect(argumentNames("{a} și {b, plural, one {# x {c}} other {#}}")).toEqual(["a", "b", "c"]);
    expect(isValidTranslation("Hi {name}", "Salut {name}", "ro")).toBe(true);
    expect(isValidTranslation("Hi {name}", "Salut {nume}", "ro")).toBe(false);
    expect(isValidTranslation("Hi {name}", "Salut {name", "ro")).toBe(false);
  });

  test("flatten / unflatten păstrează ordinea sursei", () => {
    const flat = flatten({ a: { b: "1", c: { d: "2" } }, e: "3" });
    expect(flat).toEqual({ "a.b": "1", "a.c.d": "2", e: "3" });
    expect(JSON.stringify(unflatten(flat, ["e", "a.b", "a.c.d"]))).toBe('{"e":"3","a":{"b":"1","c":{"d":"2"}}}');
  });
});

describe("finisarea", () => {
  test("„…” se restaurează și spațiile din interiorul tag-urilor dispar", async () => {
    const { polish } = await import("./i18n-core");
    expect(polish("Write a message…", "Schreibe eine Nachricht..")).toBe("Schreibe eine Nachricht…");
    expect(polish("<p>Hi</p>", "<p> Hallo </p>")).toBe("<p>Hallo</p>");
    expect(polish("Hi", "Hallo.")).toBe("Hallo.");
  });
});

describe("textul de rezervă", () => {
  test("adaptPlurals pune categoriile limbii țintă pe textul netradus", async () => {
    const { adaptPlurals } = await import("./i18n-core");
    expect(adaptPlurals("{n, plural, one {# topic} other {# topics}}", "es")).toBe("{n, plural, one {# topic} many {# topics} other {# topics}}");
    expect(adaptPlurals("Hi {name}", "ru")).toBe("Hi {name}");
  });
});
