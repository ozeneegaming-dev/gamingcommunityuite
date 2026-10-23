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
      const outside = selectors.filter((s) => !s.includes(".gcs-nova"));
      expect(outside).toEqual([]);
      expect(css).not.toMatch(/\.gcs-acp/);
    });

    test("plăcile de moderare (ale sistemului, în orice temă) au culorile cerute; mișcarea redusă oprește transformările", () => {
      const sys = read("./system-ui.css").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const [tone, color] of [["feature", "#2ecc71"], ["move", "#3498db"], ["hide", "#e67e22"], ["delete", "#e74c3c"]]) {
        expect(sys).toMatch(new RegExp(`\\.gcs-modTile\\[data-tone="${tone}"\\] \\{\\s*--gcs-tone: ${color};`));
      }
      expect(sys).toMatch(/\.gcs-modTile \{[^}]*--gcs-tone: #9b59b6;/);
      expect(sys).toMatch(/prefers-reduced-motion: reduce\) \{\s*:root \{[^}]*--gcs-hover-scale: 1;[^}]*--gcs-ease: 0s;/);
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

describe("sweep.css: sweep-ul și hover-ul butoanelor, în orice temă", () => {
  const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
  const css = strip(read("./sweep.css"));
  const SWEPT = [
    "gcs-sweep",
    "gcs-btn",
    "gcs-iconBtn",
    "gcs-headerIcon",
    "gcs-userMenu__trigger",
    "gcs-seg",
    "gcs-tab",
    "gcs-pagination__link",
    "gcs-segLink",
    "gcs-settingsNav__link",
    "gcs-toggleLink",
    "gcs-chip",
    "gcs-dropdown__item",
    "gcs-mentionList__item",
  ];
  /** Lista unui selector, despărțită la virgulele din afara parantezelor. */
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
  /** Ultimul compus al unui selector (elementul țintit); combinatorii din paranteze nu contează. */
  const target = (sel: string) => {
    let depth = 0;
    let start = 0;
    for (let i = 0; i < sel.length; i++) {
      const ch = sel[i]!;
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (depth === 0 && /[\s>+~]/.test(ch)) start = i + 1;
    }
    return sel.slice(start);
  };

  test("e comun: nu depinde de `.gcs-nova`, acoperă toate butoanele, tab-urile, cipurile și itemii meniurilor", () => {
    expect(css).not.toContain("gcs-nova");
    for (const cls of SWEPT) expect(css).toMatch(new RegExp(`\\.${cls}(?![\\w-])`));
  });

  test("stratul: imagine de fundal 0% → 100% de la stânga; intrarea cu recul, ieșirea ease-out, 1,2 s", () => {
    expect(css).toMatch(/background-image: linear-gradient\(var\(--gcs-sweep, rgb\(255 255 255 \/ 0\.08\)\)/);
    expect(css).toContain("background-position: left center;");
    expect(css).toMatch(/background-size: 0% 100%;\s*transition:\s*background-size 1\.2s ease-out/);
    expect(css).toMatch(/:is\(:hover, :focus-visible\):not\(:disabled\) \{\s*background-size: 100% 100%;\s*transition:\s*background-size 1\.2s cubic-bezier\(0\.52, 1\.64, 0\.37, 0\.66\)/);
  });

  test("„reduced motion” oprește sweep-ul", () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{[\s\S]*background-image: none;\s*transition: none;/);
  });

  test("se încarcă pentru toate temele, după designul Nova; nova.css și base.css nu mai au propriul sweep", () => {
    const globals = read("../../../apps/web/app/globals.css");
    const at = (f: string) => globals.indexOf(`@import "@gcs/ui/${f}";`);
    expect(at("nova.css")).toBeGreaterThan(-1);
    expect(at("sweep.css")).toBeGreaterThan(at("nova.css"));
    expect(strip(read("./nova.css"))).not.toContain("background-size: 0% 100%");
    expect(strip(read("./base.css"))).not.toContain(".gcs-sweep");
  });

  test("temele reglează doar culoarea: 8% alb pe întunecat, 7% din culoarea textului pe luminos (și în ACP)", () => {
    const themes = strip(read("./themes.css"));
    expect(themes).toMatch(/:root \{[^}]*--gcs-sweep: rgb\(255 255 255 \/ 0\.08\);/);
    expect(themes).toMatch(/\[data-theme="light"\] \{[^}]*--gcs-sweep: color-mix\(in srgb, var\(--gcs-text\) 7%, transparent\);/);
    expect(themes).toMatch(/\[data-theme="auto"\] \{[^}]*--gcs-sweep: color-mix\(in srgb, var\(--gcs-text\) 7%, transparent\);/);
    expect(strip(read("./acp.css"))).toMatch(/\.gcs-acp\[data-theme="light"\] \{[^}]*--gcs-sweep: color-mix\(in srgb, var\(--gcs-text\) 7%, transparent\);/);
  });

  test("numele simple (aproape albe) urmează textul temei pe luminos, inclusiv în ACP; antetul închis Nova le păstrează", () => {
    const themes = strip(read("./themes.css"));
    expect(themes).toMatch(/\[data-theme="light"\] \{[^}]*--gcs-name-plain: var\(--gcs-text\);/);
    expect(themes).toMatch(/\[data-theme="auto"\] \{[^}]*--gcs-name-plain: var\(--gcs-text\);/);
    expect(themes).not.toMatch(/:root \{[^}]*--gcs-name-plain/);
    const acp = strip(read("./acp.css"));
    expect(acp).toMatch(/\.gcs-acp\[data-theme="light"\] \{[^}]*--gcs-name-plain: var\(--gcs-text\);/);
    expect(acp).toMatch(/\.gcs-acp \{[^}]*--gcs-name-plain: initial;/);
    expect(strip(read("./nova.css"))).toMatch(/\.gcs-nova \.gcs-siteHeader \.gcs-userMenu__trigger \{[^}]*--gcs-name-plain: initial;/);
  });

  test("nicio regulă de hover a elementelor cu sweep nu folosește `background:` (ar șterge stratul)", () => {
    const re = new RegExp(`\\.(${SWEPT.join("|")})(?![\\w]|-[\\w])`);
    const files = ["base.css", "controls.css", "forum.css", "community.css", "profile.css", "acp.css", "nova.css", "groups-pro.css", "layout.css", "widgets.css", "system-ui.css", "header-menus.css"];
    const bad: string[] = [];
    for (const f of files) {
      for (const m of strip(read(`./${f}`)).matchAll(/([^{}@;]+)\{([^{}]*)\}/g)) {
        if (!/(^|[;\s])background\s*:/.test(m[2]!)) continue;
        for (const sel of splitTop(m[1]!)) {
          const t = target(sel);
          if (re.test(t) && /:hover|:focus/.test(t)) bad.push(`${f}: ${sel}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("antetul pe telefon", () => {
  test("vizitatorii: „Înregistrare / Autentificare” doar cu iconițe sub 768 px (textul rămâne pentru cititoarele de ecran)", () => {
    const css = read("./header-menus.css");
    const mobile = css.slice(css.indexOf("@media (max-width: 767px)"));
    expect(mobile).toMatch(/\.gcs-hb__authText \{[^}]*clip: rect\(0 0 0 0\)/);
    expect(mobile).toMatch(/\.gcs-hb__authOr \{\s*display: none;/);
    expect(css).toMatch(/\[data-device="mobile"\] \.gcs-hb__authText \{[^}]*position: absolute/);
  });
});
