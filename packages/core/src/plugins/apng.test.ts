import { deflateSync } from "node:zlib";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { GcsValidationError } from "../errors";
import { APNG_BLEND, APNG_DISPOSE, apngDelayMs, composeApng, crc32, GcsApngError, isApng, pngChunk, type GcsApngLimits } from "./apng";
import { PLUGIN_ANIMATION_LIMITS, pluginUploadName, preparePluginMedia } from "./media";

// ─── Fișiere APNG mici, construite în test (RGBA 8 biți) ───

type Px = [number, number, number, number];
type TestFrame = { w: number; h: number; x?: number; y?: number; px: Px | ((x: number, y: number) => Px); delay?: [number, number]; dispose?: number; blend?: number };

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function u32(...values: number[]): Buffer {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => b.writeUInt32BE(v, i * 4));
  return b;
}

/** Datele comprimate ale unei imagini RGBA (filtrul 0 pe fiecare rând). */
function idat(f: Pick<TestFrame, "w" | "h" | "px">): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < f.h; y++) {
    const row = Buffer.alloc(1 + f.w * 4);
    for (let x = 0; x < f.w; x++) Buffer.from(typeof f.px === "function" ? f.px(x, y) : f.px).copy(row, 1 + x * 4);
    rows.push(row);
  }
  return deflateSync(Buffer.concat(rows));
}

function ihdr(w: number, h: number): Buffer {
  return Buffer.concat([u32(w, h), Buffer.from([8, 6, 0, 0, 0])]);
}

/** Un APNG: `hidden` = o imagine implicită care nu face parte din animație (IDAT fără fcTL înainte). */
function apng(width: number, height: number, frames: TestFrame[], opts: { plays?: number; hidden?: Px } = {}): Buffer {
  const parts = [SIG, pngChunk("IHDR", ihdr(width, height)), pngChunk("acTL", u32(frames.length, opts.plays ?? 0))];
  let seq = 0;
  if (opts.hidden) parts.push(pngChunk("IDAT", idat({ w: width, h: height, px: opts.hidden })));
  frames.forEach((f, i) => {
    const [num, den] = f.delay ?? [1, 10];
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0);
    fctl.writeUInt32BE(f.w, 4);
    fctl.writeUInt32BE(f.h, 8);
    fctl.writeUInt32BE(f.x ?? 0, 12);
    fctl.writeUInt32BE(f.y ?? 0, 16);
    fctl.writeUInt16BE(num, 20);
    fctl.writeUInt16BE(den, 22);
    fctl[24] = f.dispose ?? APNG_DISPOSE.none;
    fctl[25] = f.blend ?? APNG_BLEND.source;
    parts.push(pngChunk("fcTL", fctl));
    if (i === 0 && !opts.hidden) parts.push(pngChunk("IDAT", idat(f)));
    else parts.push(pngChunk("fdAT", Buffer.concat([u32(seq++), idat(f)])));
  });
  parts.push(pngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

const LIMITS: GcsApngLimits = { maxFrames: 50, maxSide: 64, maxPixels: 10_000, timeBudgetMs: 10_000 };
const RED: Px = [255, 0, 0, 255];
const GREEN: Px = [0, 255, 0, 255];
const CLEAR: Px = [0, 0, 0, 0];

/** Pixelul (x, y) al cadrului `i` din animația compusă. */
const pixel = (anim: { width: number; height: number; rgba: Buffer }, i: number, x: number, y: number) => {
  const at = (i * anim.width * anim.height + y * anim.width + x) * 4;
  return [...anim.rgba.subarray(at, at + 4)];
};

const fileCode = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof GcsApngError) return e.code;
    return e instanceof GcsValidationError ? e.fields.file : String(e);
  }
};

describe("APNG: citirea și compunerea cadrelor", () => {
  test("CRC-ul bucăților e cel din specificația PNG", () => {
    expect(crc32(Buffer.from("IEND"))).toBe(0xae426082);
  });

  test("decalajul, amestecul OVER și eliberarea BACKGROUND / PREVIOUS se aplică pe pânză", async () => {
    const file = apng(4, 4, [
      { w: 4, h: 4, px: RED, delay: [1, 10] },
      // Albastru pe jumătate transparent peste roșu, la (1,1), apoi zona se golește.
      { w: 2, h: 2, x: 1, y: 1, px: [0, 0, 255, 128], blend: APNG_BLEND.over, dispose: APNG_DISPOSE.background, delay: [20, 1000] },
      // Verde la (0,0), apoi pânza revine la starea dinainte (PREVIOUS).
      { w: 1, h: 1, px: GREEN, dispose: APNG_DISPOSE.previous, delay: [0, 0] },
      { w: 1, h: 1, x: 3, y: 3, px: [0, 0, 0, 0], blend: APNG_BLEND.over, delay: [3, 0] },
    ], { plays: 2 });
    expect(isApng(file)).toBe(true);
    const anim = await composeApng(file, LIMITS);
    expect(anim).toMatchObject({ width: 4, height: 4, frames: 4, loop: 2 });
    expect(anim.delays).toEqual([100, 20, 100, 30]);
    expect(pixel(anim, 0, 2, 2)).toEqual(RED);
    // OVER: a = 128 + 255·127/255 = 255; r = 255·127/255 = 127, b = 255·128/255 = 128.
    expect(pixel(anim, 1, 1, 1)).toEqual([127, 0, 128, 255]);
    expect(pixel(anim, 1, 0, 0)).toEqual(RED);
    // Cadrul 3: zona cadrului 2 e goală (BACKGROUND), verdele e la (0,0).
    expect(pixel(anim, 2, 1, 1)).toEqual(CLEAR);
    expect(pixel(anim, 2, 0, 0)).toEqual(GREEN);
    expect(pixel(anim, 2, 3, 3)).toEqual(RED);
    // Cadrul 4: verdele a dispărut (PREVIOUS), iar un pixel transparent cu OVER nu șterge nimic.
    expect(pixel(anim, 3, 0, 0)).toEqual(RED);
    expect(pixel(anim, 3, 3, 3)).toEqual(RED);
  });

  test("SOURCE înlocuiește pixelii (și cu transparență); PREVIOUS pe primul cadru = BACKGROUND", async () => {
    const file = apng(2, 2, [
      { w: 2, h: 2, px: RED, dispose: APNG_DISPOSE.previous },
      { w: 1, h: 1, px: CLEAR, blend: APNG_BLEND.source },
    ]);
    const anim = await composeApng(file, LIMITS);
    expect(pixel(anim, 0, 1, 1)).toEqual(RED);
    // Primul cadru s-a șters după afișare: al doilea pornește de pe o pânză goală.
    expect(pixel(anim, 1, 1, 1)).toEqual(CLEAR);
    expect(pixel(anim, 1, 0, 0)).toEqual(CLEAR);
  });

  test("imaginea implicită fără fcTL nu face parte din animație", async () => {
    const file = apng(2, 2, [{ w: 2, h: 2, px: GREEN }, { w: 2, h: 2, px: RED }], { hidden: [9, 9, 9, 255] });
    const anim = await composeApng(file, LIMITS);
    expect(anim.frames).toBe(2);
    expect(pixel(anim, 0, 0, 0)).toEqual(GREEN);
    expect(pixel(anim, 1, 0, 0)).toEqual(RED);
  });

  test("durata cadrelor: numitorul 0 înseamnă sutimi, sub 11 ms devine 100 ms", () => {
    expect(apngDelayMs(1, 10)).toBe(100);
    expect(apngDelayMs(5, 0)).toBe(50);
    expect(apngDelayMs(0, 100)).toBe(100);
    expect(apngDelayMs(1, 1000)).toBe(100);
    expect(apngDelayMs(40, 1000)).toBe(40);
  });

  test("limitele: prea multe cadre, pânza sau pixelii prea mari, timpul depășit", async () => {
    const frames = (n: number) => Array.from({ length: n }, () => ({ w: 2, h: 2, px: RED }));
    expect(await fileCode(composeApng(apng(2, 2, frames(6)), { ...LIMITS, maxFrames: 5 }))).toBe("too_many_frames");
    expect(await fileCode(composeApng(apng(80, 2, frames(1)), LIMITS))).toBe("animation_too_large");
    expect(await fileCode(composeApng(apng(40, 40, frames(8)), LIMITS))).toBe("animation_too_large");
    expect(await fileCode(composeApng(apng(2, 2, frames(3)), { ...LIMITS, timeBudgetMs: -1 }))).toBe("processing_timeout");
  });

  test("fișierele stricate sunt refuzate, fără să citească în afara bufferului", async () => {
    const good = apng(2, 2, [{ w: 2, h: 2, px: RED }, { w: 2, h: 2, px: GREEN }]);
    // Trunchiat la jumătatea unei bucăți.
    expect(await fileCode(composeApng(good.subarray(0, good.length - 30), LIMITS))).toBe("invalid_image");
    // Lungimea unei bucăți mai mare decât fișierul.
    const huge = Buffer.from(good);
    huge.writeUInt32BE(0x7ffffff0, 8);
    expect(await fileCode(composeApng(huge, LIMITS))).toBe("invalid_image");
    // Fără semnătură PNG.
    expect(await fileCode(composeApng(Buffer.from("not a png at all"), LIMITS))).toBe("invalid_image");
    // Datele unui cadru stricate (zlib invalid).
    const at = good.lastIndexOf(Buffer.from("fdAT"));
    const corrupt = Buffer.from(good);
    corrupt.fill(0x41, at + 8, at + 20);
    expect(await fileCode(composeApng(corrupt, LIMITS))).toBe("invalid_image");
    // fcTL prea scurt.
    const short = Buffer.concat([SIG, pngChunk("IHDR", ihdr(2, 2)), pngChunk("acTL", u32(1, 0)), pngChunk("fcTL", Buffer.alloc(10)), pngChunk("IEND", Buffer.alloc(0))]);
    expect(await fileCode(composeApng(short, LIMITS))).toBe("invalid_image");
    // acTL fără niciun cadru.
    const empty = Buffer.concat([SIG, pngChunk("IHDR", ihdr(2, 2)), pngChunk("acTL", u32(0, 0)), pngChunk("IEND", Buffer.alloc(0))]);
    expect(await fileCode(composeApng(empty, LIMITS))).toBe("invalid_image");
  });
});

// ─── Recodarea pentru pluginuri: animațiile rămân animate ───

const declAnimated = { image: { maxMb: 2, maxSide: 256, animated: true }, quotaMb: 10 };
const declStill = { image: { maxMb: 2, maxSide: 256, animated: false }, quotaMb: 10 };

/** Un GIF animat mic, făcut cu sharp din cadre de culori diferite. */
async function gif(colors: Px[], opts: { delay: number[]; loop: number; size?: number }): Promise<Buffer> {
  const size = opts.size ?? 8;
  const raw = Buffer.concat(colors.map((c) => Buffer.alloc(size * size * 4).fill(Buffer.from(c))));
  return sharp(raw, { raw: { width: size, height: size * colors.length, channels: 4, pageHeight: size } }).gif({ delay: opts.delay, loop: opts.loop }).toBuffer();
}

const isAnimatedWebp = (b: Buffer) => b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP" && b.includes(Buffer.from("ANIM"));

describe("recodarea imaginilor animate", () => {
  test("APNG → WebP animat: cadrele, duratele și buclele se păstrează", async () => {
    const file = apng(16, 16, [
      { w: 16, h: 16, px: RED, delay: [1, 10] },
      { w: 16, h: 16, px: GREEN, delay: [25, 100] },
      { w: 16, h: 16, px: [0, 0, 255, 255], delay: [3, 10] },
    ], { plays: 3 });
    const out = await preparePluginMedia(file, declAnimated);
    expect(out).toMatchObject({ kind: "image", mime: "image/webp", ext: "webp", width: 16, height: 16, frames: 3 });
    expect(isAnimatedWebp(out.bytes)).toBe(true);
    const meta = await sharp(out.bytes, { animated: true }).metadata();
    expect(meta.pages).toBe(3);
    expect(meta.delay).toEqual([100, 250, 300]);
    expect(meta.loop).toBe(3);
    // Fișierul salvat e recodat, nu cel trimis.
    expect(out.bytes.equals(file)).toBe(false);
  });

  test("APNG mai mare decât latura maximă: fiecare cadru se micșorează, animația rămâne", async () => {
    const file = apng(40, 20, [{ w: 40, h: 20, px: RED }, { w: 40, h: 20, px: GREEN }]);
    const out = await preparePluginMedia(file, { image: { maxMb: 2, maxSide: 20, animated: true }, quotaMb: 10 });
    expect(out).toMatchObject({ width: 20, height: 10, frames: 2 });
    expect(isAnimatedWebp(out.bytes)).toBe(true);
  });

  test("fără animații declarate, APNG-ul devine imaginea lui statică", async () => {
    const file = apng(8, 8, [{ w: 8, h: 8, px: RED }, { w: 8, h: 8, px: GREEN }]);
    const out = await preparePluginMedia(file, declStill);
    expect(out.frames).toBe(1);
    expect(isAnimatedWebp(out.bytes)).toBe(false);
  });

  test("GIF animat → WebP animat; duratele 0 devin 100 ms, ca în browsere", async () => {
    const file = await gif([RED, GREEN, [0, 0, 255, 255]], { delay: [0, 50, 200], loop: 4 });
    const out = await preparePluginMedia(file, declAnimated);
    expect(out.frames).toBe(3);
    expect(isAnimatedWebp(out.bytes)).toBe(true);
    const meta = await sharp(out.bytes, { animated: true }).metadata();
    expect(meta.delay).toEqual([100, 50, 200]);
    expect(meta.loop).toBe(4);
  });

  test("GIF cu prea multe cadre e refuzat cu motivul lui", async () => {
    const many = await gif(Array.from({ length: PLUGIN_ANIMATION_LIMITS.maxFrames + 1 }, (_, i) => (i % 2 ? RED : GREEN)), { delay: [100], loop: 0, size: 2 });
    expect((await sharp(many, { animated: true }).metadata()).pages).toBe(PLUGIN_ANIMATION_LIMITS.maxFrames + 1);
    expect(await fileCode(preparePluginMedia(many, declAnimated))).toBe("too_many_frames");
  });

  test("PNG static și GIF cu un cadru rămân imagini statice", async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } }).png().toBuffer();
    expect(isApng(png)).toBe(false);
    const still = await preparePluginMedia(png, declAnimated);
    expect(still.frames).toBe(1);
    expect(isAnimatedWebp(still.bytes)).toBe(false);
    const one = await preparePluginMedia(await gif([RED], { delay: [100], loop: 0 }), declAnimated);
    expect(one.frames).toBe(1);
    expect(isAnimatedWebp(one.bytes)).toBe(false);
  });

  test("numele original al fișierului: fără cale și fără caractere de control", () => {
    expect(pluginUploadName("C:\\poze\\rama 1.png")).toBe("rama 1.png");
    expect(pluginUploadName("../../etc/passwd")).toBe("passwd");
    expect(pluginUploadName("a\u0000b\u202Ec.png")).toBe("a b c.png");
    expect(pluginUploadName("")).toBeNull();
    expect(pluginUploadName(42)).toBeNull();
    expect([...pluginUploadName(`${"x".repeat(300)}.png`)!].length).toBe(120);
  });
});
