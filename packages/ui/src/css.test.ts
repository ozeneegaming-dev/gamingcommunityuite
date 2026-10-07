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

  test("acp.css are shell-ul ACP (sidebar, bara de sus, antetul de pagină), tema luminoasă și reduced-motion", () => {
    const css = read("./acp.css");
    for (const cls of [".gcs-acpSide", ".gcs-acpSide--collapsed", ".gcs-acpNav__link--active", ".gcs-acpTop", ".gcs-acpPageHead", ".gcs-acpKpi", ".gcs-acpWidget__header", ".gcs-switch"]) {
      expect(css).toContain(cls);
    }
    expect(css).toContain('.gcs-acp[data-theme="light"]');
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});
