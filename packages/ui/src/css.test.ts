import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

describe("CSS-ul design system-ului", () => {
  test("tokens.css conține exact tokenurile din macheta aprobată", () => {
    const css = read("./tokens.css");
    const expected = {
      "--gcs-bg": "#0B0C10",
      "--gcs-surface": "#14161C",
      "--gcs-surface2": "#1B1E26",
      "--gcs-border": "#262A34",
      "--gcs-text": "#ECEDF1",
      "--gcs-muted": "#A1A7B4",
      "--gcs-accent": "#D62839",
      "--gcs-accentInk": "#FF6B74",
      "--gcs-ok": "#3DDC97",
      "--gcs-warn": "#F4B740",
    };
    for (const [name, value] of Object.entries(expected)) expect(css).toContain(`${name}: ${value};`);
  });

  test("base.css are clasele din machetă și oprește animațiile la prefers-reduced-motion", () => {
    const css = read("./base.css");
    for (const cls of [".gcs-btn", ".gcs-card", ".gcs-badge", ".gcs-avatarFrame"]) {
      expect(css).toContain(cls);
    }
    expect(css.match(/prefers-reduced-motion: reduce/g)).toHaveLength(1);
  });

  test("badges.css are insigna, starea blocată, „+N”, grila profilului, editorul din ACP și tema deschisă", () => {
    const css = read("./badges.css");
    for (const cls of [".gcs-badgeArt", ".gcs-badgeArt--locked", ".gcs-badgeArt__more", ".gcs-badgeTip", ".gcs-badgeGrid__item--locked", ".gcs-badgeStage", ".gcs-badgeChoice"]) {
      expect(css).toContain(cls);
    }
    expect(css).toContain('[data-theme="light"]');
    expect(css).toContain('[data-theme="auto"]');
  });

  test("acp.css are shell-ul ACP (bara de iconițe, coloana a doua, bara de sus, antetul de pagină), tema luminoasă și reduced-motion", () => {
    const css = read("./acp.css");
    for (const cls of [".gcs-acpSide", ".gcs-acpRail__item--tab", ".gcs-acpRail__item--current", ".gcs-acpCol__link--active", ".gcs-acpShell--collapsed", ".gcs-skipLink", ".gcs-acpTop", ".gcs-acpPageHead", ".gcs-acpKpi", ".gcs-acpWidget__header", ".gcs-switch"]) {
      expect(css).toContain(cls);
    }
    expect(css).toContain('.gcs-acp[data-theme="light"]');
    expect(css).toContain("prefers-reduced-motion: reduce");
  });

  describe("nova.css: designul Nova (specul 2026-10-10-tema-nova)", () => {
    const css = read("./nova.css").replace(/\/\*[\s\S]*?\*\//g, "");
    /** Lista unui selector, despărțită doar la virgulele din afara parantezelor (`:is(a, b)` rămâne întreg). */
    const splitTop = (list: string) => {
      const out: string[] = [];
      let depth = 0;
      let cur = "";
      for (const ch of list) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === "," && depth === 0) {
          out.push(cur.trim());
          cur = "";
        } else cur += ch;
      }
      out.push(cur.trim());
      return out;
    };
    /** Selectorii fiecărei reguli (și din `@media`). */
    const selectors = [...css.matchAll(/(?:^|[{};])\s*([^{}@;]+)\{/g)].flatMap((m) => splitTop(m[1]!)).filter((s) => s && !/^(from|to|\d+%)$/.test(s));

    test("totul e sub `.gcs-nova` (designul clasic și ACP-ul nu sunt atinse)", () => {
      const outside = selectors.filter((s) => !s.includes(".gcs-nova") && s !== ".gcs-collapseToggle");
      expect(outside).toEqual([]);
      expect(css).not.toMatch(/\.gcs-acp/);
    });

    test("plăcile de moderare au culorile cerute; mișcarea redusă oprește transformările", () => {
      for (const [tone, color] of [["feature", "#2ecc71"], ["move", "#3498db"], ["hide", "#e67e22"], ["delete", "#e74c3c"]]) {
        expect(css).toMatch(new RegExp(`\\.gcs-modTile\\[data-tone="${tone}"\\] \\{\\s*--gcs-tone: ${color};`));
      }
      expect(css).toMatch(/\.gcs-modTile \{[^}]*--gcs-tone: #9b59b6;/);
      expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.gcs-nova \{[^}]*--gcs-hover-scale: 1;[^}]*--gcs-ease: 0s;/);
    });

    test("varianta luminoasă își are variabilele (și în modul „auto” cu sistemul luminos)", () => {
      expect(css).toContain('html.gcs-nova[data-theme="light"]');
      expect(css).toMatch(/prefers-color-scheme: light\) \{\s*html\.gcs-nova\[data-theme="auto"\]/);
    });
  });

  describe("titles.css: fiecare titlu pe banda lui (specul 2026-10-07-antete-titluri)", () => {
    const css = read("./titles.css");
    /** Selectorii fiecărei reguli care dă fundalul benzii (`--gcs-box-header-bg`). */
    const banded = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => /background:[^;]*var\(--gcs-box-header-bg, var\(--gcs-surface2\)\)/.test(body!))
      .flatMap(([, selectors]) => selectors!.replace(/\/\*[\s\S]*?\*\//g, "").split(",").map((s) => s.trim()));

    test("toate tipurile de titlu din inventar primesc fundalul benzii (cu rezerva `surface2`)", () => {
      const inventory = [
        ".gcs-titleBand",
        ".gcs-category__header",
        ".gcs-topicList__header",
        ".gcs-statsPanel__head",
        ".gcs-chat__head",
        ".gcs-notifPanel__head",
        ".gcs-replyBox__title",
        ".gcs-sideCard > .gcs-sideCard__title",
        ".gcs-poll > .gcs-poll__question",
        ".gcs-vipPlan > .gcs-vipPlan__head",
        ".gcs-rules > .gcs-rules__head",
        ".gcs-searchResult > .gcs-searchResult__title",
        ".gcs-settingsCard > * > .gcs-settingsTitle:first-child",
        ".gcs-dialog .gcs-dialog__title",
        ".gcs-chat__dialog > h2:first-child",
        ".gcs-authModal .gcs-modal__header",
        ".gcs-stream__dayTitle",
        ".gcs-modMenu__summary",
        ".gcs-onlineBlock__title",
        ".gcs-legendBlock > .gcs-legendBlock__title",
        ".gcs-settingsFieldset > .gcs-settingsTitle",
        ".gcs-settingsFieldset > legend",
        ".gcs-chat__emojiHead",
        ".gcs-settingsSubtitle",
        ".gcs-badgeGrid__section",
        ".gcs-chatRooms__title",
        ".gcs-siteHeader .gcs-dropdown__heading",
        ".gcs-staffGroup__title",
        ".gcs-pageHeader",
        ".gcs-serverCard > .gcs-serverCard__head",
        ".gcs-clanCard > .gcs-clanCard__head",
        ".gcs-clanRoster__role",
      ];
      expect(inventory.filter((s) => !banded.includes(s))).toEqual([]);
    });

    test("panoul de statistici își pune gradientul de accent peste bandă, iar profilul are banda sub copertă", () => {
      expect(css).toMatch(/\.gcs-statsPanel__head \{\s*background:\s*linear-gradient\([^;]*\),\s*var\(--gcs-box-header-bg, var\(--gcs-surface2\)\);/);
      expect(css).toMatch(/\.gcs-profileHeader__main \{\s*background: linear-gradient\(to bottom, transparent 76px, var\(--gcs-box-header-bg, var\(--gcs-surface2\)\) 76px\);/);
    });

    test("panoul de antet al paginii are chenarul casetelor și bara de accent; banda casetelor nu are accent nou", () => {
      const panel = css.match(/\.gcs-pageHeader \{([^}]*)\}/)![1]!;
      expect(panel).toContain("box-shadow: inset 3px 0 0 var(--gcs-accent);");
      expect(panel).toContain("border: var(--gcs-box-border-w, 1px) solid var(--gcs-box-border, var(--gcs-border));");
      const band = css.match(/\.gcs-stream__dayTitle \{([^}]*)\}/)![1]!;
      expect(band).not.toContain("--gcs-accent");
    });

    test("ACP-ul nu e atins: nicio regulă a stratului titlurilor nu țintește clasele ACP", () => {
      expect(css).not.toMatch(/\.gcs-acp/);
    });
  });
});
