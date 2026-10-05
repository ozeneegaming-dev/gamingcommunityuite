import { describe, expect, test } from "vitest";
import { embedIframeSrc, parseEmbedUrl } from "./embeds";

describe("parseEmbedUrl", () => {
  test.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", { provider: "youtube", id: "dQw4w9WgXcQ" }],
    ["https://youtu.be/dQw4w9WgXcQ?t=42", { provider: "youtube", id: "dQw4w9WgXcQ" }],
    ["https://youtube.com/shorts/dQw4w9WgXcQ", { provider: "youtube", id: "dQw4w9WgXcQ" }],
    ["https://www.twitch.tv/videos/123456789", { provider: "twitch", id: "video:123456789" }],
    ["https://clips.twitch.tv/FunnyClipSlug-abc", { provider: "twitch", id: "clip:FunnyClipSlug-abc" }],
    ["https://www.twitch.tv/redline/clip/FunnyClipSlug-abc", { provider: "twitch", id: "clip:FunnyClipSlug-abc" }],
    ["https://www.twitch.tv/redline_tv", { provider: "twitch", id: "channel:redline_tv" }],
    ["https://medal.tv/games/cs2/clips/abcDEF123/xyz", { provider: "medal", id: "abcDEF123" }],
    ["https://medal.tv/clip/abcDEF123", { provider: "medal", id: "abcDEF123" }],
    ["https://i.imgur.com/abc.png", { provider: "image", id: "https://i.imgur.com/abc.png" }],
  ])("%s", (url, expected) => {
    expect(parseEmbedUrl(url)).toEqual(expected);
  });

  test.each([
    "javascript:alert(1)",
    "http://www.youtube.com/watch?v=dQw4w9WgXcQ&x=<script>",
    "https://evil.example/youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=short",
    "http://i.imgur.com/abc.png",
    "https://example.com/page.html",
    "nu e un url",
  ])("refuză %s", (url) => {
    expect(parseEmbedUrl(url)).toBeNull();
  });
});

describe("embedIframeSrc", () => {
  test("YouTube folosește youtube-nocookie", () => {
    expect(embedIframeSrc({ provider: "youtube", id: "dQw4w9WgXcQ" }, "forum.example")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
  });

  test("Twitch primește parent = host-ul site-ului", () => {
    expect(embedIframeSrc({ provider: "twitch", id: "clip:Abc-1" }, "forum.example")).toBe(
      "https://clips.twitch.tv/embed?clip=Abc-1&parent=forum.example",
    );
    expect(embedIframeSrc({ provider: "twitch", id: "video:123" }, "forum.example")).toBe(
      "https://player.twitch.tv/?video=123&parent=forum.example&autoplay=false",
    );
  });

  test("un id invalid (injectat în JSON) → null", () => {
    expect(embedIframeSrc({ provider: "youtube", id: "x\"><script>" }, "forum.example")).toBeNull();
    expect(embedIframeSrc({ provider: "twitch", id: "channel:a&parent=evil.com" }, "forum.example")).toBeNull();
  });
});
