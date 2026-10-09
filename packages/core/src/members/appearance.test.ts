import { describe, expect, test } from "vitest";
import {
  appearanceBannerStyle,
  appearanceCardStyle,
  appearanceMediaRef,
  appearanceText,
  appearanceThemeVars,
  compileAppearanceCss,
  mergeAppearances,
  parseMemberAppearance,
  type GcsMemberAppearance,
} from "./appearance";

const KEY = "gcs.vip_studio";
const parse = (raw: unknown) => parseMemberAppearance(raw, { pluginKey: KEY });
const errors = (raw: unknown) => {
  const r = parse(raw);
  return r.ok ? {} : r.errors;
};

describe("aspectul membrilor: validarea", () => {
  test("o formă completă validă se normalizează", () => {
    const r = parse({
      name: { fill: { colors: ["#ff0044", "#7a5cff"], angle: 135.4, animation: "flow", speed: "fast" }, effect: "shimmer", glow: "#ffffff", bold: true },
      banner: { fill: { colors: ["#111111"] }, text: "#ffcc00", label: "  VIP   Gold  " },
      frame: { image: `/plugins/${KEY}/assets/frames/ember.png`, scale: 136, x: 0, y: -2 },
      card: { image: `/plugins/${KEY}/media/ck2l0a1b2c3d4e5f.webp`, x: 40, y: 60, dim: 30 },
      flair: { icon: `/plugins/${KEY}/assets/weapons/rifle.png`, label: "Pușca de asalt" },
      profile: {
        background: { image: `/plugins/${KEY}/media/ck2l0a1b2c3d4e5f.webp`, video: `/plugins/${KEY}/media/ck2l0a1b2c3d4e5g.webm` },
        quote: { text: "Joc  pentru\nechipă." },
        theme: { key: "carbon", accent: "#22d3ee", surface: "#0b1220", glow: true },
        song: { title: "Tema mea", youtube: "dQw4w9WgXcQ", autoplayMuted: false },
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toEqual({ fill: { colors: ["#FF0044", "#7A5CFF"], angle: 135, animation: "flow", speed: "fast" }, effect: "shimmer", glow: "#FFFFFF", bold: true });
    expect(r.value.banner?.label).toBe("VIP Gold");
    expect(r.value.profile?.quote?.text).toBe("Joc pentru echipă.");
    expect(r.value.profile?.song).toEqual({ title: "Tema mea", youtube: "dQw4w9WgXcQ", autoplayMuted: false });
  });

  test("injecțiile CSS și HTML în culori, chei și efecte sunt refuzate", () => {
    expect(errors({ name: { fill: { colors: ["red;}body{display:none"] } } })).toEqual({ "name.fill.colors.0": "invalid_color" });
    expect(errors({ name: { fill: { colors: ["#FFF"] } } })).toEqual({ "name.fill.colors.0": "invalid_color" });
    expect(errors({ name: { fill: { colors: ["#FF0000"] }, effect: "url(x)" } })).toEqual({ "name.effect": "invalid_choice" });
    expect(errors({ banner: { fill: { colors: ["#FF0000"], animation: "spin;position:fixed" } } })).toEqual({ "banner.fill.animation": "invalid_choice" });
    expect(errors({ name: { fill: { colors: ["#FF0000"] }, css: "color:red" } })).toEqual({ "name.css": "unknown_key" });
    expect(errors({ profile: { theme: { key: "x}{", accent: "#FF0000" } } })).toEqual({ "profile.theme.key": "invalid_key" });
    expect(errors({ style: "x" })).toEqual({ "(root).style": "unknown_key" });
    expect(errors({ name: { fill: { colors: [] } } })).toEqual({ "name.fill.colors": "invalid_color" });
    expect(errors({ name: { fill: { colors: ["#000000", "#000000", "#000000", "#000000", "#000000", "#000000"] } } })).toEqual({ "name.fill.colors": "invalid_color" });
  });

  test("numerele în afara intervalelor sunt refuzate", () => {
    const frame = (over: Record<string, unknown>) => ({ frame: { image: `/plugins/${KEY}/assets/f.png`, ...over } });
    expect(errors(frame({ scale: 400 }))).toEqual({ "frame.scale": "invalid_range" });
    expect(errors(frame({ x: "1" }))).toEqual({ "frame.x": "invalid_range" });
    expect(errors({ card: { image: `/plugins/${KEY}/assets/c.webp`, dim: 95 } })).toEqual({ "card.dim": "invalid_range" });
    expect(errors({ name: { fill: { colors: ["#FF0000"], angle: Number.NaN } } })).toEqual({ "name.fill.angle": "invalid_range" });
  });

  test("fișierele: doar ale pluginului care publică, de tipul potrivit", () => {
    for (const image of [
      "https://evil.example/a.png",
      "/plugins/acme.other/assets/a.png",
      `/plugins/${KEY}/assets/../../acme.other/assets/a.png`,
      `/plugins/${KEY}/assets/a.svg`,
      `/plugins/${KEY}/assets/a.png?x=1`,
      `/plugins/${KEY}/assets/a.png")`,
      `/plugins/${KEY}/media/short.webp`,
      `/plugins/${KEY}/media/ck2l0a1b2c3d4e5f.mp4`,
      "/files/abc",
    ]) {
      expect([image, errors({ frame: { image } })]).toEqual([image, { "frame.image": "invalid_media" }]);
    }
    expect(appearanceMediaRef(`/plugins/${KEY}/media/ck2l0a1b2c3d4e5f.mp3`, KEY, "audio")).not.toBeNull();
    expect(appearanceMediaRef(`/plugins/${KEY}/media/ck2l0a1b2c3d4e5f.mp3`, KEY, "video")).toBeNull();
    expect(errors({ profile: { background: { video: `/plugins/${KEY}/media/ck2l0a1b2c3d4e5f.webm` } } })).toEqual({ "profile.background.image": "invalid_media" });
    expect(errors({ profile: { song: { title: "X", youtube: "abc" } } })).toEqual({ "profile.song.youtube": "invalid_id" });
    expect(errors({ profile: { song: { title: "X" } } })).toEqual({ "profile.song": "required" });
  });

  test("textele: fără caractere de control sau de direcție, cu limită", () => {
    expect(appearanceText(`a${String.fromCharCode(0x202e)}b${String.fromCharCode(0)}c`, 10)).toBe("a b c");
    expect(appearanceText("   ", 10)).toBeNull();
    expect(appearanceText("x".repeat(201), 200)).toBeNull();
    expect(errors({ profile: { quote: { text: "x".repeat(201) } } })).toEqual({ "profile.quote.text": "invalid_text" });
    expect(errors({ flair: { icon: `/plugins/${KEY}/assets/w.png` } })).toEqual({ "flair.label": "required" });
  });

  test("mai multe pluginuri: primul în ordinea priorității câștigă fiecare câmp", () => {
    const a: GcsMemberAppearance = { name: { fill: { colors: ["#111111"] } }, profile: { quote: { text: "A" } } };
    const b: GcsMemberAppearance = { name: { fill: { colors: ["#222222"] } }, banner: { fill: { colors: ["#333333"] } }, profile: { quote: { text: "B" }, theme: { key: "t", accent: "#444444" } } };
    expect(mergeAppearances([a, b])).toEqual({ name: a.name, banner: b.banner, profile: { quote: { text: "A" }, theme: { key: "t", accent: "#444444" } } });
  });
});

describe("aspectul membrilor: CSS-ul", () => {
  test("numele: per user, cu gradient, animație și oprire sub reduced-motion", () => {
    const css = compileAppearanceCss([{ userId: "u1", appearance: { name: { fill: { colors: ["#FF0044", "#7A5CFF"] }, effect: "shimmer" } } }]);
    expect(css).toContain(':is(.gcs-root,#gcs-names) :is(.gcs-userLink[data-user-id="u1"],[data-name-user="u1"])');
    // Culorile ca variabile; gradientul le folosește prin cernelurile temei (închise automat pe tema deschisă).
    expect(css).toContain("--nfx-c1:#FF0044;--nfx-c2:#7A5CFF;--nfx-cyc:gcsNfxCycle2;--nfx-cyg:currentColor;--nfx-grad:linear-gradient(90deg,var(--nfx-i1),var(--nfx-i2),var(--nfx-i1))");
    expect(css).toContain("animation:gcsNfxFlow calc(3.6s*var(--nfx-sp,1)) linear infinite");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });

  test("validarea: efectele noi și cheia unui stil CSS al pluginului", () => {
    expect(parse({ name: { fill: { colors: ["#FF0000"] }, effect: "razor", style: "flacara_mea" } }).ok).toBe(true);
    expect(errors({ name: { fill: { colors: ["#FF0000"] }, style: "Flacără" } })).toEqual({ "name.style": "invalid_key" });
    expect(errors({ banner: { fill: { colors: ["#FF0000"] }, style: "a b" } })).toEqual({ "banner.style": "invalid_key" });
    // Clasa o pune doar nucleul.
    expect(errors({ name: { fill: { colors: ["#FF0000"] }, styleClass: "gcs-x" } })).toEqual({ "name.styleClass": "unknown_key" });
  });

  test("combinarea: stilul CSS primește clasa pluginului care l-a publicat; banner-ul cu stil nu are stil inline", () => {
    const merged = mergeAppearances([{ banner: { fill: { colors: ["#111111"] }, style: "aur" } }, { name: { fill: { colors: ["#222222"] }, style: "neon" } }], ["acme.one", "gcs.vip_studio"]);
    expect(merged.banner?.styleClass).toBe("gcs-bannerStyle--acme-one--aur");
    expect(merged.name?.styleClass).toBe("gcs-nameStyle--gcs-vip_studio--neon");
    expect(appearanceBannerStyle(merged.banner!)).toEqual({});
  });

  test("rama: imaginea pluginului peste avatar, rama clasică ascunsă", () => {
    const css = compileAppearanceCss([{ userId: "u2", appearance: { frame: { image: `/plugins/${KEY}/assets/frames/ember.png`, scale: 140, y: -4 } } }]);
    expect(css).toContain(`.gcs-avatar[data-avatar-user="u2"]::after{content:"";position:absolute;inset:-20%;background:url("/plugins/${KEY}/assets/frames/ember.png")`);
    expect(css).toContain("translate(0%,-4%)");
    expect(css).toContain('.gcs-avatarFrame:has(>.gcs-avatar[data-avatar-user="u2"])::before{display:none}');
  });

  test("id-urile nesigure sunt ignorate; fără aspect, fără CSS", () => {
    expect(compileAppearanceCss([{ userId: '"]{}body{x', appearance: { name: { fill: { colors: ["#FF0000"] } } } }])).toBe("");
    expect(compileAppearanceCss([])).toBe("");
  });

  test("banner-ul, cardul și tema: doar valori validate", () => {
    expect(appearanceBannerStyle({ fill: { colors: ["#123456"] } })).toMatchObject({ backgroundColor: "#123456", color: "#FFFFFF" });
    expect(appearanceBannerStyle({ fill: { colors: ["#123456", "#654321"], animation: "flow" }, text: "#000000" })).toMatchObject({
      backgroundImage: "linear-gradient(90deg,#123456,#654321,#123456)",
      backgroundSize: "200% 100%",
      color: "#000000",
      animation: "gcsFxFlow 4s linear infinite",
    });
    expect(appearanceCardStyle({ image: `/plugins/${KEY}/assets/c.webp`, x: 10, y: 90, dim: 50 })).toEqual({
      backgroundImage: `linear-gradient(rgba(0,0,0,0.5),rgba(0,0,0,0.5)),url("/plugins/${KEY}/assets/c.webp")`,
      backgroundSize: "cover",
      backgroundPosition: "10% 90%",
    });
    expect(appearanceThemeVars({ key: "carbon", accent: "#22D3EE" })).toMatchObject({ "--gcs-accent": "#22D3EE" });
  });
});
