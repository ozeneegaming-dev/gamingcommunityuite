import { describe, expect, test } from "vitest";
import { isPreviewReadyMessage, isStudioApplyMessage, previewKeyFor, STUDIO_MESSAGE_SOURCE } from "./theme-preview";

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
    expect(isStudioApplyMessage("x")).toBe(false);
    expect(isPreviewReadyMessage({ source: "gcs-theme-preview", type: "ready", path: "/" })).toBe(true);
    expect(isPreviewReadyMessage({ source: "other", type: "ready" })).toBe(false);
  });
});
