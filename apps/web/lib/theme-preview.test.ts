import { describe, expect, test } from "vitest";
import { designClass, isPreviewReadyMessage, isStudioApplyMessage, previewKeyFor, siteAreaFor, STUDIO_MESSAGE_SOURCE } from "./theme-preview";

describe("previzualizarea editorului vizual", () => {
  test("cheia vine din parametru (validată) sau din cookie, dar doar pentru un document din iframe", () => {
    expect(previewKeyFor("default", undefined, "document")).toBe("default");
    expect(previewKeyFor("Bad Key", "default", "iframe")).toBeNull();
    expect(previewKeyFor(null, "neon", "iframe")).toBe("neon");
    expect(previewKeyFor(null, "neon", "document")).toBeNull();
    expect(previewKeyFor(null, "neon", null)).toBeNull();
    expect(previewKeyFor(null, "../x", "iframe")).toBeNull();
    expect(previewKeyFor(null, undefined, "iframe")).toBeNull();
  });

  test("mesajele au forma așteptată (altfel sunt ignorate)", () => {
    const ok = { source: STUDIO_MESSAGE_SOURCE, type: "apply", css: "a{}", mode: "light", logo: { text: "", slogan: "" } };
    expect(isStudioApplyMessage(ok)).toBe(true);
    expect(isStudioApplyMessage({ ...ok, mode: "sepia" })).toBe(false);
    expect(isStudioApplyMessage({ ...ok, css: 1 })).toBe(false);
    expect(isStudioApplyMessage({ ...ok, logo: null })).toBe(false);
    // Editorul de CSS din ACP trimite doar CSS-ul.
    expect(isStudioApplyMessage({ source: STUDIO_MESSAGE_SOURCE, type: "apply", css: "a{}" })).toBe(true);
    expect(isStudioApplyMessage("x")).toBe(false);
    expect(isPreviewReadyMessage({ source: "gcs-theme-preview", type: "ready", path: "/" })).toBe(true);
    expect(isPreviewReadyMessage({ source: "other", type: "ready" })).toBe(false);
  });
});

describe("designul temei pe paginile site-ului", () => {
  test("zona cererii: ACP-ul și editoarele lui sunt `admin`, restul `site`", () => {
    expect(siteAreaFor("/admin")).toBe("admin");
    expect(siteAreaFor("/admin/theme-editor/nova")).toBe("admin");
    expect(siteAreaFor("/administratori")).toBe("site");
    expect(siteAreaFor("/")).toBe("site");
    expect(siteAreaFor("/forum/1-general")).toBe("site");
  });

  test("clasa designului: doar Nova are una; mesajul editorului poate purta designul", () => {
    expect(designClass("nova")).toBe("gcs-nova");
    expect(designClass("classic")).toBeNull();
    expect(designClass(undefined)).toBeNull();
    const ok = { source: STUDIO_MESSAGE_SOURCE, type: "apply", css: "a{}" };
    expect(isStudioApplyMessage({ ...ok, preset: "nova" })).toBe(true);
    expect(isStudioApplyMessage({ ...ok, preset: "classic" })).toBe(true);
    expect(isStudioApplyMessage({ ...ok, preset: 'evil" onload=' })).toBe(false);
  });
});
