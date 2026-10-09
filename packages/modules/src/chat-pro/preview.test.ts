import { describe, expect, test } from "vitest";
import { parseLinkPreview } from "./preview";

describe("previzualizarea linkurilor", () => {
  test("og:title înaintea lui <title>, entitățile decodate, numele site-ului", () => {
    const html = `<html><head><title>Fallback</title><meta property="og:site_name" content="Comunitatea X"><meta content="Turneu &amp; premii &#8211; 2026" property="og:title"></head></html>`;
    expect(parseLinkPreview("https://ex.com/t/1", html)).toEqual({ url: "https://ex.com/t/1", host: "ex.com", title: "Turneu & premii – 2026", site: "Comunitatea X" });
  });

  test("doar <title>, spațiile strânse; fără titlu → null", () => {
    expect(parseLinkPreview("https://ex.com", "<title>\n  Pagina   mea \n</title>")).toMatchObject({ title: "Pagina mea", site: null });
    expect(parseLinkPreview("https://ex.com", "<p>nimic</p>")).toBeNull();
  });
});
