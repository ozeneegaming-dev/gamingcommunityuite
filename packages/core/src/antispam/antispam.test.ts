import { describe, expect, test } from "vitest";
import { countImages, normalizeAnswer } from "./index";
import { extractHosts, extractUrls, findPhishing, parseDomainList, phishingVerdict } from "./phishing";
import { createPowChallenge, parsePowToken, POW_TTL_MS, solvePow, verifyPowToken } from "./pow";
import { leadingZeroBits, powToken } from "./powShared";

const SECRET = "secret-de-test";

describe("captcha proof-of-work", () => {
  test("leadingZeroBits numără biții de zero de la început", () => {
    expect(leadingZeroBits(new Uint8Array([0, 0, 0x0f, 0xff]))).toBe(20);
    expect(leadingZeroBits(new Uint8Array([0x80]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0x01]))).toBe(7);
  });

  test("o soluție corectă trece o singură verificare de formă; dificultatea e limitată la 8–24", () => {
    const now = 1_800_000_000_000;
    const c = createPowChallenge(SECRET, 10, now);
    expect(c.difficulty).toBe(10);
    expect(c.expiresAt).toBe(now + POW_TTL_MS);
    expect(createPowChallenge(SECRET, 2, now).difficulty).toBe(8);
    expect(createPowChallenge(SECRET, 99, now).difficulty).toBe(24);
    const token = solvePow(c);
    expect(verifyPowToken(SECRET, token, now + 1000)).toEqual({ ok: true, challenge: c.challenge, expiresAt: c.expiresAt });
  });

  test("refuză: alt secret, dificultatea scăzută, expirat, munca nefăcută, forma greșită", () => {
    const now = 1_800_000_000_000;
    const c = createPowChallenge(SECRET, 12, now);
    const token = solvePow(c);
    expect(verifyPowToken("alt-secret", token, now)).toMatchObject({ ok: false, reason: "signature" });
    // Dificultatea scrisă în provocare e semnată: coborâtă la 8, semnătura nu mai bate.
    const parsed = parsePowToken(token)!;
    const weaker = token.replace(`.${parsed.difficulty}.`, ".8.");
    expect(verifyPowToken(SECRET, weaker, now)).toMatchObject({ ok: false, reason: "signature" });
    expect(verifyPowToken(SECRET, token, c.expiresAt + 1)).toMatchObject({ ok: false, reason: "expired" });
    // Un nonce care nu face munca cerută (căutăm unul care nu are biții de zero).
    let bad = 0;
    while (verifyPowToken(SECRET, powToken(c, bad), now).ok) bad++;
    expect(verifyPowToken(SECRET, powToken(c, bad), now)).toMatchObject({ ok: false, reason: "work" });
    expect(verifyPowToken(SECRET, "nu-e-un-token", now)).toMatchObject({ ok: false, reason: "malformed" });
    expect(verifyPowToken(SECRET, `${c.challenge}.${c.signature}.-1`, now)).toMatchObject({ ok: false, reason: "malformed" });
  });
});

describe("anti-phishing", () => {
  test("domeniile oficiale și site-urile cunoscute ale comunității sunt curate", () => {
    for (const host of ["steamcommunity.com", "store.steampowered.com", "www.steamcommunity.com", "s.team", "discord.gg", "discord.gift", "steamdb.info", "steamgifts.com", "github.com", "google.com", "forum.test"]) {
      expect(phishingVerdict(host), host).toBeNull();
    }
  });

  test("lista livrată și imitațiile (litere înlocuite, cratime, momeli, subdomenii) sunt prinse", () => {
    expect(phishingVerdict("steamcommunlty.com")).toBe("listed");
    expect(phishingVerdict("sub.steamcommunlty.com")).toBe("listed");
    for (const host of [
      "steamcornmunity.com",
      "stearncommunity.net",
      "steamcomunity.org",
      "steamcommunity-gift.ru",
      "steamcommunity.com.verify-login.ru",
      "steampowerred.com",
      "store-steampovered.com",
      "steam-trade-offer.xyz",
      "free-steam-skins.top",
      "discord-nitro-gift.com",
      "dlscordapp.com",
    ]) {
      expect(phishingVerdict(host), host).toBe("lookalike");
    }
  });

  test("listele din ACP: blocate (și subdomeniile) și permise mereu", () => {
    const lists = { blocked: parseDomainList("*.rau.example\n@altul.example, https://al-treilea.example/cale"), allowed: parseDomainList("steam-trade-offer.xyz") };
    expect(lists.blocked).toEqual(["rau.example", "altul.example", "al-treilea.example"]);
    expect(phishingVerdict("x.rau.example", lists)).toBe("listed");
    expect(phishingVerdict("steam-trade-offer.xyz", lists)).toBeNull();
  });

  test("domeniile din text: linkuri, `www.`, domenii fără http și HTML; emailurile nu contează", () => {
    const text = 'Vezi https://steamcornmunity.com/gift?id=1, www.exemplu.ro și steamcommunlty.com/trade. Scrie-mi la ion@steamcornmunity.com <a href="http://link.test/a">x</a>';
    expect(extractUrls(text)).toEqual(["http://link.test/a", "https://steamcornmunity.com/gift?id=1", "http://www.exemplu.ro"]);
    expect(extractHosts(text).sort()).toEqual(["exemplu.ro", "link.test", "steamcommunlty.com", "steamcornmunity.com"].sort());
    expect(findPhishing(text)).toBe("steamcornmunity.com");
    expect(findPhishing("salut, joci azi pe config.cfg?")).toBeNull();
  });
});

describe("utilitare", () => {
  test("normalizeAnswer ignoră literele mari, diacriticele, spațiile și punctuația de la capete", () => {
    expect(normalizeAnswer("  Counter-Strike   2! ")).toBe("counter-strike 2");
    expect(normalizeAnswer("ȘTEFAN cel Mare.")).toBe("stefan cel mare");
    expect(normalizeAnswer("???")).toBe("");
  });

  test("countImages numără imaginile din HTML", () => {
    expect(countImages('<p><img src="a"><IMG src="b"></p><p>imagine</p>')).toBe(2);
  });
});

describe("SHA-256 de rezervă (browser fără Web Crypto)", () => {
  test("dă același rezultat ca Node pentru texte de lungimi diferite", async () => {
    const { createHash } = await import("node:crypto");
    const { sha256 } = await import("./powShared");
    for (const text of ["", "abc", "x".repeat(55), "y".repeat(56), "z".repeat(64), "ș".repeat(200)]) {
      const bytes = new TextEncoder().encode(text);
      expect(Buffer.from(sha256(bytes)).toString("hex"), String(text.length)).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
  });
});
