import { describe, expect, test } from "vitest";
import { FOOTER_MAX_COLUMNS, SOCIAL_NETWORKS, footerConfigError, footerRichText, isFooterHref, normalizeFooterConfig, type GcsFooterConfig } from "./footer";

const valid: GcsFooterConfig = {
  about: { title: "Pe scurt despre", accent: "Comunitatea mea", text: "**Comunitatea mea** e locul gamerilor.\nIntră și **joacă**.", cta: { label: "Cunoaște echipa", href: "/staff", icon: "fa-solid fa-shield-halved" } },
  columns: [
    { title: "Merită", accent: "văzut", links: [{ label: "Forum", href: "/forum", icon: "fa-solid fa-comments" }] },
    { title: "Serverele", accent: "noastre", links: [{ label: "Discord", href: "https://discord.gg/abc", icon: "fa-brands fa-discord" }] },
  ],
  bottom: { privacy: "/p/confidentialitate", contact: "mailto:contact@example.com", cookies: "", language: true, unread: true, theme: true },
};

describe("subsolul: configurația din ACP", () => {
  test("o configurație completă e validă; `null` = valorile implicite", () => {
    expect(footerConfigError(valid)).toBeNull();
    expect(footerConfigError(null)).toBeNull();
  });

  test("refuză structurile greșite, prea multe coloane, linkurile și iconițele nesigure", () => {
    expect(footerConfigError("text")).toBe("invalid");
    expect(footerConfigError({ ...valid, columns: Array.from({ length: FOOTER_MAX_COLUMNS + 1 }, () => valid.columns[0]) })).toBe("too_many");
    expect(footerConfigError({ ...valid, about: { ...valid.about, cta: { label: "x", href: "javascript:alert(1)", icon: "fa-solid fa-x" } } })).toBe("invalid_url");
    expect(footerConfigError({ ...valid, columns: [{ ...valid.columns[0]!, links: [{ label: "x", href: "//evil.example", icon: "fa-solid fa-x" }] }] })).toBe("invalid_url");
    expect(footerConfigError({ ...valid, columns: [{ ...valid.columns[0]!, links: [{ label: "x", href: "/a", icon: "<svg>" }] }] })).toBe("invalid_icon");
    expect(footerConfigError({ ...valid, about: { ...valid.about, text: "x".repeat(1001) } })).toBe("too_long");
    expect(footerConfigError({ ...valid, bottom: { ...valid.bottom, privacy: "ftp://x" } })).toBe("invalid_url");
    expect(footerConfigError({ ...valid, columns: [{ ...valid.columns[0]!, links: Array.from({ length: 13 }, () => valid.columns[0]!.links[0]) }] })).toBe("too_many");
  });

  test("adresele permise: căi interne, https/http, mailto; nu `//`, `javascript:` sau `data:`", () => {
    for (const ok of ["/forum", "/p/despre?x=1", "https://discord.gg/x", "http://example.com", "mailto:a@b.ro"]) expect(isFooterHref(ok), ok).toBe(true);
    for (const bad of ["", "//evil", "javascript:alert(1)", "data:text/html,x", "forum", " /x"]) expect(isFooterHref(bad), bad).toBe(false);
  });

  test("normalizarea păstrează doar câmpurile cunoscute și taie spațiile", () => {
    const out = normalizeFooterConfig({ ...valid, about: { ...valid.about, title: "  Despre  ", extra: 1 }, columns: [{ ...valid.columns[0]!, title: " Merită " }] } as never);
    expect(out.about.title).toBe("Despre");
    expect(out.columns[0]!.title).toBe("Merită");
    expect(Object.keys(out.about).sort()).toEqual(["accent", "cta", "text", "title"]);
  });
});

describe("subsolul: textul „Despre” cu cuvinte evidențiate", () => {
  test("`**cuvânt**` devine evidențiat, rândul nou devine întrerupere", () => {
    expect(footerRichText("**GCS** e aici.\nVino **acum**!")).toEqual([
      { text: "GCS", hl: true },
      { text: " e aici.", hl: false },
      { br: true },
      { text: "Vino ", hl: false },
      { text: "acum", hl: true },
      { text: "!", hl: false },
    ]);
  });

  test("marcajele neînchise rămân text; HTML-ul rămâne text (fără interpretare)", () => {
    expect(footerRichText("a **b")).toEqual([{ text: "a **b", hl: false }]);
    expect(footerRichText("<b>x</b>")).toEqual([{ text: "<b>x</b>", hl: false }]);
  });
});

describe("rețelele sociale", () => {
  test("toate cele cerute, fiecare cu setarea, iconița și culoarea ei", () => {
    expect(SOCIAL_NETWORKS.map((n) => n.key)).toEqual(["facebook", "instagram", "tiktok", "youtube", "x", "twitch", "kick", "steam", "github", "discord"]);
    for (const n of SOCIAL_NETWORKS) {
      expect(n.setting).toBe(`social.${n.key}`);
      expect(n.icon).toMatch(/^fa-(brands|solid) fa-[a-z0-9-]+$/);
      expect(n.color).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});
