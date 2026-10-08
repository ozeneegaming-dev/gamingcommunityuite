import { describe, expect, test } from "vitest";
import { notificationText } from "../notifications/emails";
import { clanSlug, cleanLine, normalizeClanName, normalizeLinks, normalizeTag, tagError, tagInk } from "./text";

describe("tagul și numele clanului", () => {
  test("normalizarea: fără diacritice, cu litere mari (tag) sau mici (nume), fără caractere invizibile", () => {
    expect(normalizeTag("ștf")).toBe("STF");
    expect(normalizeTag("R\u200BLX")).toBe("RLX");
    expect(normalizeClanName("  Ștefănești   Elite ")).toBe("stefanesti elite");
    expect(cleanLine("Red\u202ELynx\u0007")).toBe("RedLynx");
  });

  test("lungimea și caracterele după opțiuni", () => {
    const opts = { min: 2, max: 5, charset: "alnum" as const };
    expect(tagError("", opts)).toBe("required");
    expect(tagError("A", opts)).toBe("too_short");
    expect(tagError("ABCDEF", opts)).toBe("too_long");
    expect(tagError("A-B", opts)).toBe("invalid_chars");
    expect(tagError("A-B", { ...opts, charset: "alnum_symbols" })).toBeNull();
    expect(tagError("Ж7", { ...opts, charset: "unicode" })).toBeNull();
    expect(tagError("A B", { ...opts, charset: "unicode" })).toBe("invalid_chars");
  });

  test("slug-ul și culoarea textului plăcuței (contrastul mai mare)", () => {
    expect(clanSlug("Red Lynx Elite")).toBe("red-lynx-elite");
    expect(clanSlug("Жар")).toBe("clan");
    expect(tagInk("#D62839")).toBe("#FFFFFF");
    expect(tagInk("#F4B740")).toBe("#0B0C10");
    expect(tagInk("#000000")).toBe("#FFFFFF");
  });
});

describe("linkurile", () => {
  test("doar https, fără date de autentificare, pe domeniile fiecărui tip", () => {
    const { links, errors } = normalizeLinks({
      discord: "https://discord.com/invite/abc123",
      steam: "https://steamcommunity.com/groups/gcs_clan",
      youtube: "https://www.youtube.com/@gcs",
      twitch: "https://twitch.tv/gcs_tv",
      website: "https://user:pass@clan.example.com",
    });
    expect(links).toEqual({
      discord: "https://discord.com/invite/abc123",
      steam: "https://steamcommunity.com/groups/gcs_clan",
      youtube: "https://www.youtube.com/@gcs",
      twitch: "https://twitch.tv/gcs_tv",
    });
    expect(errors).toEqual({ "links.website": "invalid_url" });
    expect(normalizeLinks({ discord: "https://discord.gg.evil.example/x" }).errors).toEqual({ "links.discord": "invalid_url" });
    expect(normalizeLinks({ website: "" }).links).toEqual({});
  });
});

describe("textele notificărilor", () => {
  test("invitația, cererile adunate, schimbările de apartenență și aprobarea", () => {
    expect(notificationText({ type: "clans.invite", actors: ["Ana"], count: 1, title: "[RLX] Red Lynx" }, "ro")).toBe("Ana te-a invitat în clanul „[RLX] Red Lynx”");
    expect(notificationText({ type: "clans.request", actors: ["Bob"], count: 3, title: "[RLX] Red Lynx" }, "en")).toBe("3 new requests to join the clan “[RLX] Red Lynx”");
    expect(notificationText({ type: "clans.membership", actors: [], count: 1, title: "[RLX] Red Lynx", data: { kind: "kicked" } }, "ro")).toBe("Ai fost scos din clanul „[RLX] Red Lynx”");
    expect(notificationText({ type: "clans.membership", actors: [], count: 1, title: "X", data: { kind: "leader" } }, "en")).toBe("You are now the leader of the clan “X”");
    expect(notificationText({ type: "clans.review", actors: [], count: 1, title: "Red Lynx", data: { kind: "rejected", reason: "Nume nepotrivit" } }, "ro")).toBe(
      "Clanul tău „Red Lynx” a fost respins: Nume nepotrivit",
    );
  });
});
